const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { requireRole } = require('../auth');
const { audit } = require('../orders');
const { publicUser } = require('./auth');

const router = express.Router();

// GET /me — the signed-in user and their restaurant, read fresh from the database.
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, r.name AS restaurant_name, r.settings AS restaurant_settings
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.id = $1 AND u.restaurant_id = $2 AND u.active`,
    [req.user.id, req.user.restaurantId]
  );
  const user = rows[0];
  if (!user) throw new AppError(401, 'unauthorized', 'Please sign in again');
  res.json({
    user: publicUser(user),
    restaurant: { id: user.restaurant_id, name: user.restaurant_name, settings: user.restaurant_settings },
  });
});

// POST /me/pin { password, pin } — a manager or admin sets the PIN they approve requests with.
// The password is asked again so nobody can change the PIN on an unattended screen.
router.post('/pin', requireRole('manager', 'admin'), async (req, res) => {
  const pin = String(req.body?.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new AppError(400, 'bad_pin', 'The PIN must be 4 to 6 digits');
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(String(req.body?.password || ''), rows[0].password_hash);
  if (!ok) throw new AppError(403, 'wrong_password', 'Wrong password');
  await db.query('UPDATE users SET pin_hash = $1 WHERE id = $2', [await bcrypt.hash(pin, 10), req.user.id]);
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: 'pin.set', entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

module.exports = router;
