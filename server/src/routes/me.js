const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { endSessions, loginLimiter } = require('../auth');
const { requirePerm } = require('../permissions');
const { audit } = require('../orders');
const ws = require('../ws/events');
const { publicUser, publicRestaurant, USER_SELECT } = require('./auth');

const router = express.Router();
const note = (req, action, extra = {}) => audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action, entity: 'user', entityId: req.user.id, ...extra });

// GET /me — the signed-in user and their restaurant, read fresh from the database.
router.get('/', async (req, res) => {
  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1 AND u.restaurant_id = $2 AND u.active`, [req.user.id, req.user.restaurantId]);
  const user = rows[0];
  if (!user) throw new AppError(401, 'unauthorized', 'Please sign in again');
  const restaurant = (await db.query('SELECT id, name, settings, profile FROM restaurants WHERE id = $1', [user.restaurant_id])).rows[0];
  res.json({ user: publicUser(user), restaurant: publicRestaurant(restaurant), sessionId: req.user.sessionId });
});

// POST /me/pin { currentPin | password, pin } — set or change the PIN used to approve requests.
// Changing a PIN needs the current one. Someone who forgot it (or never had one) proves who
// they are with their account password instead.
// GET /me/getting-started — how far a new restaurant's set-up has got, for the Getting started
// card on the Overview: tables, dishes, waiters, and chefs assigned to a kitchen.
router.get('/getting-started', requirePerm('tables.manage', 'menu.manage', 'staff.manage'), async (req, res) => {
  const { restaurantId } = req.user;
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*)::int FROM tables WHERE restaurant_id = $1 AND NOT archived AND parent_table_id IS NULL) AS tables,
       (SELECT count(*)::int FROM menu_items WHERE restaurant_id = $1 AND deleted_at IS NULL) AS dishes,
       (SELECT count(*)::int FROM users WHERE restaurant_id = $1 AND role = 'waiter' AND deleted_at IS NULL) AS waiters,
       (SELECT count(DISTINCT ut.user_id)::int FROM user_terminals ut JOIN users u ON u.id = ut.user_id
         WHERE u.restaurant_id = $1 AND u.role = 'chef' AND u.deleted_at IS NULL) AS chefs`,
    [restaurantId]
  );
  res.json(rows[0]);
});

router.post('/pin', requirePerm('approvals.decide', 'refunds.issue'), async (req, res) => {
  const pin = String(req.body?.pin || '');
  if (!/^\d{4}$/.test(pin)) throw new AppError(400, 'bad_pin', 'The PIN is 4 digits');
  const key = `pin:${req.user.id}`;
  const wait = loginLimiter.lockedFor(key);
  if (wait) throw new AppError(429, 'pin_locked', `Too many wrong tries. Try again in ${wait} seconds.`, { retryAfter: wait });

  const { rows } = await db.query('SELECT password_hash, pin_hash FROM users WHERE id = $1', [req.user.id]);
  const byPin = req.body?.currentPin !== undefined && req.body.currentPin !== '';
  if (byPin && !rows[0].pin_hash) throw new AppError(409, 'no_pin', 'You have no PIN yet. Enter your password to set one.');
  const ok = byPin
    ? await bcrypt.compare(String(req.body.currentPin), rows[0].pin_hash)
    : await bcrypt.compare(String(req.body?.password || ''), rows[0].password_hash);
  if (!ok) {
    loginLimiter.fail(key);
    throw new AppError(403, byPin ? 'wrong_pin' : 'wrong_password', byPin ? 'The current PIN is wrong' : 'Wrong password');
  }
  loginLimiter.clear(key);
  if (rows[0].pin_hash && (await bcrypt.compare(pin, rows[0].pin_hash))) throw new AppError(400, 'same_pin', 'The new PIN is the same as the current one');
  await db.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [await bcrypt.hash(pin, 10), req.user.id]);
  await note(req, 'pin.set');
  res.json({ ok: true });
});

// POST /me/password { current, password } — change my own password. Other devices are signed out.
router.post('/password', async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 6) throw new AppError(400, 'bad_input', 'The password needs at least 6 characters');
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(String(req.body?.current || ''), rows[0].password_hash);
  if (!ok) throw new AppError(403, 'wrong_password', 'The current password is wrong');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), req.user.id]);
  const ended = await endSessions(db, { userId: req.user.id, except: req.user.sessionId, reason: 'credential_reset' });
  ws.kick(req.user.id, { exceptSession: req.user.sessionId });
  await note(req, 'password.change', { new: { other_sessions_ended: ended } });
  res.json({ ok: true, ended });
});

// GET /me/sessions — where I am signed in, newest first.
router.get('/sessions', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, device, ip, created_at, last_seen_at, ended_at, end_reason FROM sessions
      WHERE user_id = $1 ORDER BY (ended_at IS NULL) DESC, created_at DESC LIMIT 20`,
    [req.user.id]
  );
  const live = ws.onlineSessions(req.user.id);
  res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.user.sessionId, online: live.has(s.id) })) });
});

// POST /me/sessions/:id/logout — sign out one of my other devices.
router.post('/sessions/:id/logout', async (req, res) => {
  const sessionId = String(req.params.id);
  if (sessionId === String(req.user.sessionId)) throw new AppError(400, 'this_device', 'To leave this device, use Sign Out');
  const ended = await endSessions(db, { userId: req.user.id, sessionId, reason: 'revoked' });
  if (!ended) throw new AppError(404, 'no_session', 'That device is already signed out');
  ws.kick(req.user.id, { sessionId });
  await note(req, 'session.revoke', { new: { ended } });
  res.json({ ok: true, ended });
});

// POST /me/logout — sign out on this device.
router.post('/logout', async (req, res) => {
  if (req.user.sessionId) await endSessions(db, { userId: req.user.id, sessionId: req.user.sessionId, reason: 'logout' });
  await note(req, 'session.logout');
  res.json({ ok: true });
});

// POST /me/logout-all { keepThis? } — sign out everywhere. With keepThis, every device but this one.
router.post('/logout-all', async (req, res) => {
  const keep = req.body?.keepThis === true ? req.user.sessionId : null;
  const ended = await endSessions(db, { userId: req.user.id, except: keep, reason: 'revoked' });
  ws.kick(req.user.id, { exceptSession: keep });
  await note(req, 'session.logout_all', { new: { ended } });
  res.json({ ok: true, ended });
});

module.exports = router;
