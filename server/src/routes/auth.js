const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { signToken, loginLimiter } = require('../auth');

const router = express.Router();

const ROLE_LABELS = { admin: 'an Admin', manager: 'a Manager', chef: 'a Chef', waiter: 'a Waiter' };

// What the app is allowed to know about a user (never the hashes).
const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  login_id: u.login_id,
  role: u.role,
  restaurant_id: u.restaurant_id,
  discount_limit_pct: u.discount_limit_pct,
  active: u.active,
  has_pin: !!u.pin_hash,
});

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

  const { rows } = await db.query(
    `SELECT u.*, r.name AS restaurant_name, r.settings AS restaurant_settings
       FROM users u JOIN restaurants r ON r.id = u.restaurant_id
      WHERE lower(u.login_id) = $1 AND u.active`,
    [key]
  );
  const user = rows[0];
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) fail('wrong_credentials', 'Wrong ID or password');

  // The role picked on the first screen must be the user's real role.
  if (role && role !== user.role) {
    throw new AppError(403, 'wrong_role', `This ID is not ${ROLE_LABELS[role] || 'that role'}`);
  }

  if ((user.restaurant_settings.otp_roles || []).includes(user.role)) {
    if (!otp) throw new AppError(401, 'otp_required', 'Enter the one-time code from your manager');
    const code = await db.query('SELECT code_hash FROM login_otps WHERE user_id = $1 AND expires_at > now()', [user.id]);
    const match = code.rows[0] ? await bcrypt.compare(otp, code.rows[0].code_hash) : false;
    if (!match) fail('wrong_otp', 'Wrong or expired code. Ask your manager for a new one.');
    await db.query('DELETE FROM login_otps WHERE user_id = $1', [user.id]); // a code works once
  }
  loginLimiter.clear(key);

  res.json({
    token: signToken(user),
    user: publicUser(user),
    restaurant: { id: user.restaurant_id, name: user.restaurant_name, settings: user.restaurant_settings },
  });
});

module.exports = router;
module.exports.publicUser = publicUser;
