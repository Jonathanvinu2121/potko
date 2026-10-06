const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { requireRole, forgetUser } = require('../auth');
const ws = require('../ws/events');
const { audit } = require('../orders');
const { publicUser } = require('./auth');

const router = express.Router();
const admin = requireRole('admin');
const managers = requireRole('manager', 'admin');
const ROLES = ['admin', 'manager', 'chef', 'waiter'];
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

function readPassword(value) {
  const password = String(value ?? '');
  if (password.length < 6) throw bad('The password needs at least 6 characters');
  return bcrypt.hash(password, 10);
}
function readPin(value) {
  const pin = String(value ?? '');
  if (!/^\d{4,6}$/.test(pin)) throw bad('The PIN must be 4 to 6 digits');
  return bcrypt.hash(pin, 10);
}
function readLimit(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw bad('The discount limit is between 0 and 100');
  return pct;
}
const taken = (err) => (err.code === '23505' ? new AppError(409, 'id_taken', 'Another person already uses that Staff ID') : err);

// GET /users — the restaurant's staff (managers can see, only an admin can change).
router.get('/', managers, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE restaurant_id = $1 ORDER BY active DESC, role, name', [req.user.restaurantId]);
  res.json({ users: rows.map(publicUser) });
});

// POST /users { name, login_id, password, role, discount_limit_pct?, pin? }
router.post('/', admin, async (req, res) => {
  const body = req.body || {};
  const name = text(body.name, 60);
  const loginId = text(body.login_id, 30);
  if (!name) throw bad('Enter a name');
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(loginId)) throw bad('A Staff ID is 3 to 30 letters, digits, dots or dashes');
  if (!ROLES.includes(body.role)) throw bad('Choose a role');
  const passwordHash = await readPassword(body.password);
  const pinHash = body.pin ? await readPin(body.pin) : null;
  const limit = body.discount_limit_pct === undefined ? 3 : readLimit(body.discount_limit_pct);

  const { rows } = await db
    .query(
      `INSERT INTO users (restaurant_id, name, login_id, password_hash, pin_hash, role, discount_limit_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.restaurantId, name, loginId, passwordHash, pinHash, body.role, limit]
    )
    .catch((err) => { throw taken(err); });
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: 'user.add', entity: 'user', entityId: rows[0].id, new: { name, login_id: loginId, role: body.role } });
  res.status(201).json({ user: publicUser(rows[0]) });
});

// PATCH /users/:id { name?, role?, active?, discount_limit_pct?, password?, pin? }
router.patch('/:id', admin, async (req, res) => {
  const body = req.body || {};
  const id = Number(req.params.id);
  const found = await db.query('SELECT * FROM users WHERE id = $1 AND restaurant_id = $2', [id, req.user.restaurantId]);
  const before = found.rows[0];
  if (!before) throw new AppError(404, 'no_user', 'No such person');

  const set = {};
  const changes = {};
  if (body.name !== undefined) { set.name = text(body.name, 60); if (!set.name) throw bad('Enter a name'); changes.name = set.name; }
  if (body.role !== undefined) { if (!ROLES.includes(body.role)) throw bad('Choose a role'); set.role = body.role; changes.role = body.role; }
  if (body.active !== undefined) { set.active = body.active === true; changes.active = set.active; }
  if (body.discount_limit_pct !== undefined) { set.discount_limit_pct = readLimit(body.discount_limit_pct); changes.discount_limit_pct = set.discount_limit_pct; }
  if (body.password) { set.password_hash = await readPassword(body.password); changes.password = 'reset'; }
  if (body.pin) { set.pin_hash = await readPin(body.pin); changes.pin = 'set'; }
  // An admin cannot lock themselves out of the admin screens.
  if (id === req.user.id && (set.active === false || (set.role && set.role !== 'admin'))) {
    throw new AppError(409, 'self', 'You cannot deactivate yourself or change your own role');
  }
  const cols = Object.keys(set);
  if (cols.length === 0) return res.json({ user: publicUser(before) });

  const { rows } = await db.query(
    `UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => set[c])]
  );
  await audit(db, {
    restaurantId: req.user.restaurantId, userId: req.user.id, action: 'user.edit', entity: 'user', entityId: id,
    old: { name: before.name, role: before.role, active: before.active, discount_limit_pct: before.discount_limit_pct }, new: changes,
  });
  // Deactivated, moved to another role, or password reset: their open screens are signed out now.
  if (set.active === false || set.role || set.password_hash) {
    forgetUser(id);
    if (id !== req.user.id) ws.kick(id);
  }
  res.json({ user: publicUser(rows[0]) });
});

// POST /users/:id/otp — a manager or admin makes a one-time login code for someone.
// No SMS: the code is read out or shown to the person, who types it at login. Valid for 10 minutes.
router.post('/:id/otp', managers, async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.query('SELECT id, name FROM users WHERE id = $1 AND restaurant_id = $2 AND active', [id, req.user.restaurantId]);
  if (!found.rows[0]) throw new AppError(404, 'no_user', 'No such person');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await db.query(
    `INSERT INTO login_otps (user_id, code_hash, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at`,
    [id, await bcrypt.hash(code, 10)]
  );
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: 'otp.generate', entity: 'user', entityId: id });
  res.json({ code, name: found.rows[0].name, validMinutes: 10 });
});

module.exports = router;
