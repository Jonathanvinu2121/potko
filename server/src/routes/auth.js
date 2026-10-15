const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const crypto = require('crypto');
const { signToken, loginLimiter, startSession, deviceName, clientIp } = require('../auth');
const { createRestaurant } = require('../restaurants');
const { permissionsOf, discountLimit } = require('../permissions');
const { settingsOf } = require('../settings');
const { audit } = require('../orders');

const router = express.Router();

const ROLE_LABELS = { admin: 'an Admin', manager: 'a Manager', cashier: 'a Cashier', chef: 'a Chef', waiter: 'a Waiter' };

// What the app is allowed to know about a user (never the hashes).
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  login_id: u.login_id,
  role: u.role,
  restaurant_id: u.restaurant_id,
  phone: u.phone,
  email: u.email,
  discount_limit_pct: u.discount_limit_pct,
  discount_limit: discountLimit(u),
  can_collect_payment: u.can_collect_payment,
  payment_access: u.payment_access,
  access: u.access || {},
  permissions: permissionsOf(u),
  terminals: u.terminals || [],
  image_id: u.image_id,
  active: u.active,
  has_pin: !!u.pin_hash,
  created_at: u.created_at,
  last_login_at: u.last_login_at,
});

// A user row with the kitchen terminals they are assigned to.
const USER_SELECT = `
  SELECT u.*, COALESCE((SELECT json_agg(ut.terminal_id) FROM user_terminals ut WHERE ut.user_id = u.id), '[]') AS terminals
    FROM users u`;

const publicRestaurant = (r) => ({ id: r.id, name: r.name, settings: settingsOf(r.settings), profile: r.profile || {} });

// POST /auth/login { loginId, password, role, otp? }
// When the restaurant has switched on one-time codes for this role, the password alone answers
// 401 "otp_required"; the user then types the code a manager or admin generated for them.
router.post('/login', async (req, res) => {
  const loginId = String(req.body?.loginId || '').trim();
  const password = String(req.body?.password || '');
  const role = req.body?.role;
  const otp = String(req.body?.otp || '').trim();
  if (!loginId || !password) throw new AppError(400, 'missing_fields', 'Enter your ID and password');

  const key = loginId.toLowerCase();
  const wait = loginLimiter.lockedFor(key);
  if (wait) throw new AppError(429, 'locked', 'Too many wrong tries', { retryAfter: wait });

  const fail = (code, message) => {
    const locked = loginLimiter.fail(key);
    if (locked) throw new AppError(429, 'locked', 'Too many wrong tries', { retryAfter: locked });
    throw new AppError(401, code, message);
  };

  const { rows } = await db.query(`${USER_SELECT} WHERE lower(u.login_id) = $1 AND u.active AND u.deleted_at IS NULL`, [key]);
  const user = rows[0];
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) fail('wrong_credentials', 'Wrong ID or password');

  // The role picked on the first screen must be the user's real role. A cashier works in the
  // manager's workspace, so "Manager" on the first screen lets them in too.
  const sameDesk = role === 'manager' && user.role === 'cashier';
  if (role && role !== user.role && !sameDesk) {
    throw new AppError(403, 'wrong_role', `This ID is not ${ROLE_LABELS[role] || 'that role'}`);
  }

  const restaurant = (await db.query('SELECT id, name, settings, profile FROM restaurants WHERE id = $1', [user.restaurant_id])).rows[0];
  if ((settingsOf(restaurant.settings).otp_roles || []).includes(user.role)) {
    if (!otp) throw new AppError(401, 'otp_required', 'Enter the one-time code from your manager');
    const code = await db.query('SELECT code_hash FROM login_otps WHERE user_id = $1 AND expires_at > now()', [user.id]);
    const match = code.rows[0] ? await bcrypt.compare(otp, code.rows[0].code_hash) : false;
    if (!match) fail('wrong_otp', 'Wrong or expired code. Ask your manager for a new one.');
    await db.query('DELETE FROM login_otps WHERE user_id = $1', [user.id]); // a code works once
  }
  loginLimiter.clear(key);

  const sessionId = await startSession(db, user, req);
  await audit(db, { restaurantId: user.restaurant_id, userId: user.id, action: 'session.login', entity: 'user', entityId: user.id, new: { device: deviceName(req.headers['user-agent']) } });

  res.json({ token: signToken(user, sessionId), user: publicUser(user), restaurant: publicRestaurant(restaurant) });
});

// ---------- First-run set-up ----------
// A server handed to a client starts empty. The first person to open the app sets up the
// restaurant and becomes its admin; after that the set-up is closed for good. It needs the setup
// code that the person who installed the server put in its settings (SETUP_CODE), so a stranger
// who finds the server first cannot claim it.

const restaurantCount = async () => Number((await db.query('SELECT count(*)::int AS n FROM restaurants')).rows[0].n);
const sameCode = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// GET /auth/setup — needed: no restaurant yet; ready: a setup code is configured on the server.
router.get('/setup', async (req, res) => {
  res.json({ needed: (await restaurantCount()) === 0, ready: !!process.env.SETUP_CODE });
});

// POST /auth/setup { setupCode, restaurantName, adminName, loginId, password, pin }
// Creates the restaurant and its admin, and signs the admin in (same answer as /auth/login).
router.post('/setup', async (req, res) => {
  const key = `setup:${clientIp(req)}`;
  const wait = loginLimiter.lockedFor(key);
  if (wait) throw new AppError(429, 'locked', 'Too many wrong tries', { retryAfter: wait });
  if (!process.env.SETUP_CODE) throw new AppError(503, 'setup_not_ready', 'This server is not ready for set-up yet. Ask the person who gave you the app for the setup code.');
  if ((await restaurantCount()) > 0) throw new AppError(409, 'setup_done', 'This restaurant is already set up. Sign in instead.');
  if (!sameCode(String(req.body?.setupCode || '').trim(), process.env.SETUP_CODE.trim())) {
    const locked = loginLimiter.fail(key);
    if (locked) throw new AppError(429, 'locked', 'Too many wrong tries', { retryAfter: locked });
    throw new AppError(403, 'wrong_setup_code', 'Wrong setup code');
  }
  const made = await db.tx(async (client) => {
    // One set-up at a time: a second one waits here, then finds the restaurant and stops.
    await client.query('LOCK TABLE restaurants IN EXCLUSIVE MODE');
    const n = (await client.query('SELECT count(*)::int AS n FROM restaurants')).rows[0].n;
    if (n > 0) throw new AppError(409, 'setup_done', 'This restaurant is already set up. Sign in instead.');
    const result = await createRestaurant(client, req.body || {});
    await audit(client, { restaurantId: result.restaurantId, userId: result.userId, action: 'restaurant.setup', entity: 'restaurant', entityId: result.restaurantId, new: { name: result.restaurantName, admin: result.adminName } });
    return result;
  });
  loginLimiter.clear(key);
  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1`, [made.userId]);
  const user = rows[0];
  const restaurant = (await db.query('SELECT id, name, settings, profile FROM restaurants WHERE id = $1', [made.restaurantId])).rows[0];
  const sessionId = await startSession(db, user, req);
  await audit(db, { restaurantId: user.restaurant_id, userId: user.id, action: 'session.login', entity: 'user', entityId: user.id, new: { device: deviceName(req.headers['user-agent']) } });
  res.status(201).json({ token: signToken(user, sessionId), user: publicUser(user), restaurant: publicRestaurant(restaurant) });
});

// ---------- Developer mode ----------
// Signing in as any person without typing an ID and password, to make testing quick. It exists
// only on a test server on the developer's own computer:
//   - it needs DEV_LOGIN=1 in the server's environment,
//   - it is always off on a hosted server (NODE_ENV=production, or Render),
//   - it is refused for requests that arrive through a tunnel or proxy (a shared public link),
//     unless DEV_LOGIN=public was set on purpose.
function devAllowed(req) {
  const flag = process.env.DEV_LOGIN;
  if (flag !== '1' && flag !== 'public') return false;
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) return false;
  if (flag === 'public') return true;
  return !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray'];
}

// GET /auth/dev — is developer mode on, and who can be signed in as.
router.get('/dev', async (req, res) => {
  if (!devAllowed(req)) return res.json({ enabled: false });
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.role, u.login_id
       FROM users u
      WHERE u.active AND u.deleted_at IS NULL
      ORDER BY u.restaurant_id, array_position(ARRAY['admin', 'manager', 'cashier', 'waiter', 'chef'], u.role), u.name
      LIMIT 40`
  );
  res.json({ enabled: true, users: rows });
});

// POST /auth/dev-login { userId }
router.post('/dev-login', async (req, res) => {
  if (!devAllowed(req)) throw new AppError(404, 'not_found', 'No such endpoint');
  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1 AND u.active AND u.deleted_at IS NULL`, [Number(req.body?.userId)]);
  const user = rows[0];
  if (!user) throw new AppError(404, 'no_user', 'No such person');
  const restaurant = (await db.query('SELECT id, name, settings, profile FROM restaurants WHERE id = $1', [user.restaurant_id])).rows[0];
  const sessionId = await startSession(db, user, req);
  await audit(db, { restaurantId: user.restaurant_id, userId: user.id, action: 'session.login', entity: 'user', entityId: user.id, new: { device: deviceName(req.headers['user-agent']), developer_mode: true } });
  res.json({ token: signToken(user, sessionId), user: publicUser(user), restaurant: publicRestaurant(restaurant) });
});

module.exports = router;
module.exports.publicUser = publicUser;
module.exports.publicRestaurant = publicRestaurant;
module.exports.USER_SELECT = USER_SELECT;
