const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');
const db = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and set a long random value.');
  process.exit(1);
}

const signToken = (user) =>
  jwt.sign({ uid: user.id, rid: user.restaurant_id, role: user.role, name: user.name }, SECRET, { expiresIn: '12h' });

// Throws if the token is missing, forged or expired.
function verifyToken(token) {
  const p = jwt.verify(token, SECRET);
  return { id: p.uid, restaurantId: p.rid, role: p.role, name: p.name };
}

// A token is good for 12 hours, but it stops working the moment its owner is deactivated or
// given another role. The answer is remembered for 30 seconds so most requests cost no extra query.
const checked = new Map(); // user id -> { ok, at }
async function stillValid(user) {
  const hit = checked.get(user.id);
  if (hit && Date.now() - hit.at < 30000) return hit.ok;
  const { rows } = await db.query('SELECT role, active FROM users WHERE id = $1 AND restaurant_id = $2', [user.id, user.restaurantId]);
  const ok = !!rows[0] && rows[0].active && rows[0].role === user.role;
  checked.set(user.id, { ok, at: Date.now() });
  return ok;
}
// Call when a user is changed, so the next request re-reads them at once.
const forgetUser = (userId) => checked.delete(userId);

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    req.user = verifyToken(token);
  } catch {
    return next(new AppError(401, 'unauthorized', 'Please sign in again'));
  }
  if (!(await stillValid(req.user))) return next(new AppError(401, 'unauthorized', 'Please sign in again'));
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new AppError(403, 'forbidden', 'Your role cannot do this'));

// Login rate limit: 5 wrong tries for one login ID, then locked for 1 minute.
const MAX_TRIES = 5;
const LOCK_MS = 60 * 1000;
const attempts = new Map(); // login id (lowercase) -> { fails, lockedUntil, at }

const loginLimiter = {
  // Seconds left on the lock, or 0 when the ID may try again.
  lockedFor(key) {
    const a = attempts.get(key);
    if (!a || !a.lockedUntil) return 0;
    const left = a.lockedUntil - Date.now();
    if (left <= 0) {
      attempts.delete(key);
      return 0;
    }
    return Math.ceil(left / 1000);
  },
  // Records a wrong try. Returns the lock time in seconds if this try caused a lock, else 0.
  fail(key) {
    const a = attempts.get(key) || { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    a.at = Date.now();
    if (a.fails >= MAX_TRIES) a.lockedUntil = Date.now() + LOCK_MS;
    attempts.set(key, a);
    return a.lockedUntil ? LOCK_MS / 1000 : 0;
  },
  clear(key) {
    attempts.delete(key);
  },
};

// Forget stale entries so the map cannot grow without limit.
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, a] of attempts) if (a.at < cutoff) attempts.delete(key);
}, 5 * 60 * 1000).unref();

module.exports = { signToken, verifyToken, stillValid, forgetUser, requireAuth, requireRole, loginLimiter };
