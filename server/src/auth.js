const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');
const db = require('./db');
const { permissionsOf, discountLimit } = require('./permissions');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and set a long random value.');
  process.exit(1);
}

// The token names the person, their role and the session (one sign-in on one device).
const signToken = (user, sessionId) =>
  jwt.sign({ uid: user.id, rid: user.restaurant_id, role: user.role, name: user.name, sid: sessionId }, SECRET, { expiresIn: '12h' });

// Throws if the token is missing, forged or expired.
function verifyToken(token) {
  const p = jwt.verify(token, SECRET);
  return { id: p.uid, restaurantId: p.rid, role: p.role, name: p.name, sessionId: p.sid || null };
}

// A token is good for 12 hours, but it stops working the moment its owner is deactivated, given
// another role, or the session is ended (log out, "log out all devices", password reset).
// The answer is remembered for 30 seconds so most requests cost no extra query.
// On success the person's current permissions and assignments are put on `user`.
const checked = new Map(); // "userId:sessionId" -> { ok, at, extra }
async function stillValid(user) {
  const key = `${user.id}:${user.sessionId || ''}`;
  let hit = checked.get(key);
  if (!hit || Date.now() - hit.at > 30000) {
    const { rows } = await db.query(
      `SELECT u.role, u.active, u.name, u.permissions, u.access, u.can_collect_payment, u.payment_access, u.discount_limit_pct,
              COALESCE((SELECT json_agg(ut.terminal_id) FROM user_terminals ut WHERE ut.user_id = u.id), '[]') AS terminals,
              (SELECT s.ended_at FROM sessions s WHERE s.id = $3) AS session_ended,
              ($3::text IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.id = $3 AND s.user_id = u.id)) AS session_known
         FROM users u WHERE u.id = $1 AND u.restaurant_id = $2`,
      [user.id, user.restaurantId, user.sessionId]
    );
    const row = rows[0];
    const ok = !!row && row.active && row.role === user.role && row.session_known && !row.session_ended;
    hit = {
      ok,
      at: Date.now(),
      extra: ok
        ? { name: row.name, perms: permissionsOf(row), access: row.access || {}, terminals: row.terminals, discountLimit: discountLimit(row) }
        : null,
    };
    checked.set(key, hit);
  }
  if (hit.ok) Object.assign(user, hit.extra);
  return hit.ok;
}
// Call when a user or one of their sessions changes, so the next request re-reads them at once.
function forgetUser(userId) {
  for (const key of checked.keys()) if (key.startsWith(`${userId}:`)) checked.delete(key);
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  // Downloads opened by the browser (templates, error reports) cannot set a header, so they pass ?token=.
  const token = header.startsWith('Bearer ') ? header.slice(7) : typeof req.query.token === 'string' ? req.query.token : null;
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

// ---- Sessions ----

// A short, human name for the device from its User-Agent: "Android phone", "Windows browser".
function deviceName(userAgent = '') {
  const ua = String(userAgent);
  // The installed app's requests come from the phone's network library, not from a browser.
  if (/okhttp|Dalvik/i.test(ua)) return 'Android app';
  if (/CFNetwork|Darwin/i.test(ua)) return 'iPhone app';
  const system = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : null;
  return system ? `${system} browser` : 'Unknown device';
}

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, '').slice(0, 60);

async function startSession(q, user, req) {
  const id = crypto.randomBytes(18).toString('base64url');
  await q.query('INSERT INTO sessions (id, user_id, restaurant_id, device, ip) VALUES ($1, $2, $3, $4, $5)', [
    id,
    user.id,
    user.restaurant_id,
    deviceName(req.headers['user-agent']),
    clientIp(req),
  ]);
  await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return id;
}

// Ends one session, or all of a person's sessions (optionally keeping one). Returns how many ended.
async function endSessions(q, { userId, sessionId = null, except = null, reason }) {
  const { rowCount } = await q.query(
    `UPDATE sessions SET ended_at = now(), end_reason = $4, last_seen_at = now()
      WHERE user_id = $1 AND ended_at IS NULL
        AND ($2::text IS NULL OR id = $2) AND ($3::text IS NULL OR id <> $3)`,
    [userId, sessionId, except, reason]
  );
  forgetUser(userId);
  return rowCount;
}

// Wrong-try limiter, used for the login and for the approval PIN.
// 5 wrong tries lock the key; each further lock is longer: 1 minute, 5 minutes, then 15 minutes.
const MAX_TRIES = 5;
const LOCKS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const attempts = new Map(); // key -> { fails, locks, lockedUntil, at }

const loginLimiter = {
  // Seconds left on the lock, or 0 when the key may try again.
  lockedFor(key) {
    const a = attempts.get(key);
    if (!a || !a.lockedUntil) return 0;
    const left = a.lockedUntil - Date.now();
    if (left <= 0) {
      a.lockedUntil = 0;
      a.fails = 0;
      return 0;
    }
    return Math.ceil(left / 1000);
  },
  // Records a wrong try. Returns the lock time in seconds if this try caused a lock, else 0.
  fail(key) {
    const a = attempts.get(key) || { fails: 0, locks: 0, lockedUntil: 0 };
    a.fails += 1;
    a.at = Date.now();
    let locked = 0;
    if (a.fails >= MAX_TRIES) {
      const ms = LOCKS_MS[Math.min(a.locks, LOCKS_MS.length - 1)];
      a.lockedUntil = Date.now() + ms;
      a.locks += 1;
      locked = ms / 1000;
    }
    attempts.set(key, a);
    return locked;
  },
  // Tries left before the next lock.
  left(key) {
    return Math.max(0, MAX_TRIES - (attempts.get(key)?.fails || 0));
  },
  clear(key) {
    attempts.delete(key);
  },
};

// Forget stale entries so the map cannot grow without limit.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, a] of attempts) if (a.at < cutoff) attempts.delete(key);
}, 5 * 60 * 1000).unref();

module.exports = { signToken, verifyToken, stillValid, forgetUser, requireAuth, requireRole, loginLimiter, startSession, endSessions, deviceName, clientIp };
