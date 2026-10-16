// Staff: the list, a person's profile (assignments, sessions, performance, activity) and the
// actions on it. Who may do what is decided here, on the server.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { forgetUser, endSessions } = require('../auth');
const { requirePerm, can, readOverrides, PERMISSIONS, PRESETS } = require('../permissions');
const ws = require('../ws/events');
const { audit } = require('../orders');
const { publicUser, USER_SELECT } = require('./auth');
const { outranks, visibleTo, PAYMENT_LEVELS } = require('../permissions');

const router = express.Router();
const view = requirePerm('staff.view', 'staff.manage');
const manage = requirePerm('staff.manage');
const ROLES = ['admin', 'manager', 'cashier', 'chef', 'waiter'];
const SENIOR = ['admin', 'manager']; // only someone with staff.admin may add or change these
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

function readPassword(value) {
  const password = String(value ?? '');
  if (password.length < 6) throw bad('The password needs at least 6 characters');
  return bcrypt.hash(password, 10);
}
function readPin(value) {
  const pin = String(value ?? '');
  if (!/^\d{4}$/.test(pin)) throw bad('The PIN is 4 digits');
  return bcrypt.hash(pin, 10);
}
function readLimit(value) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw bad('The discount limit is between 0 and 100');
  return pct;
}
function readContact(body, out) {
  if (body.phone !== undefined) {
    out.phone = text(body.phone, 20) || null;
    if (out.phone && !/^[+0-9][0-9 -]{5,19}$/.test(out.phone)) throw bad('Check the phone number');
  }
  if (body.email !== undefined) {
    out.email = text(body.email, 80) || null;
    if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw bad('Check the email address');
  }
  if (body.image_id !== undefined) out.image_id = Number.isInteger(body.image_id) ? body.image_id : null;
}
const taken = (err) => (err.code === '23505' ? new AppError(409, 'id_taken', 'Another person already uses that Staff ID') : err);

// A waiter's areas and tables, checked against what the restaurant really has.
//   { areas: { "<areaId>": { mode: 'all' } | { mode: 'tables', tables: [ids], from?, to? } } }
// An empty object means every area and table.
async function readAccess(restaurantId, input) {
  const areas = input?.areas;
  if (!areas || typeof areas !== 'object' || Object.keys(areas).length === 0) return {};
  const known = await db.query(
    `SELECT a.id, COALESCE((SELECT json_agg(t.id) FROM tables t WHERE t.area_id = a.id AND NOT t.archived AND t.parent_table_id IS NULL), '[]') AS tables
       FROM dining_areas a WHERE a.restaurant_id = $1 AND a.deleted_at IS NULL`,
    [restaurantId]
  );
  const out = {};
  for (const [key, rule] of Object.entries(areas)) {
    const area = known.rows.find((a) => a.id === Number(key));
    if (!area) throw bad('One of the chosen dining areas no longer exists');
    if (rule?.mode === 'tables') {
      const ids = [...new Set((Array.isArray(rule.tables) ? rule.tables : []).map(Number))].filter((id) => area.tables.includes(id));
      if (ids.length === 0) throw bad('Choose at least one table in each area that is limited to specific tables');
      out[area.id] = { mode: 'tables', tables: ids, ...(Number.isInteger(rule.from) && Number.isInteger(rule.to) ? { from: rule.from, to: rule.to } : {}) };
    } else {
      out[area.id] = { mode: 'all' };
    }
  }
  return { areas: out };
}

async function readTerminals(restaurantId, input) {
  const ids = [...new Set((Array.isArray(input) ? input : []).map(Number))].filter(Number.isInteger);
  if (ids.length === 0) throw bad('Assign the chef to at least one kitchen');
  const { rows } = await db.query('SELECT id FROM kitchen_terminals WHERE restaurant_id = $1 AND id = ANY($2::int[])', [restaurantId, ids]);
  if (rows.length !== ids.length) throw bad('One of the chosen terminals no longer exists');
  return ids;
}

async function setTerminals(q, userId, ids) {
  await q.query('DELETE FROM user_terminals WHERE user_id = $1', [userId]);
  if (ids.length) await q.query('INSERT INTO user_terminals (user_id, terminal_id) SELECT $1, unnest($2::int[])', [userId, ids]);
}

// "Ground Floor · 5 tables", "Chinese Terminal, Grill Terminal", "All floors".
async function assignments(restaurantId) {
  const areas = (await db.query(
    `SELECT a.id, a.name, a.floor_id, f.name AS floor_name,
            (SELECT count(*)::int FROM tables t WHERE t.area_id = a.id AND NOT t.archived AND t.parent_table_id IS NULL) AS tables
       FROM dining_areas a JOIN floors f ON f.id = a.floor_id
      WHERE a.restaurant_id = $1 AND a.deleted_at IS NULL ORDER BY f.sort, f.id, a.sort, a.id`,
    [restaurantId]
  )).rows;
  const terminals = (await db.query('SELECT id, name FROM kitchen_terminals WHERE restaurant_id = $1 ORDER BY sort, id', [restaurantId])).rows;
  const tables = (await db.query('SELECT id, label, area_id FROM tables WHERE restaurant_id = $1 AND NOT archived AND parent_table_id IS NULL ORDER BY sort, id', [restaurantId])).rows;
  return {
    areas,
    terminals,
    tables,
    summary(user) {
      if (user.role === 'chef') return terminals.filter((t) => (user.terminals || []).includes(t.id)).map((t) => t.name).join(', ') || 'No kitchen assigned';
      if (user.role === 'cashier') return 'Billing & payments';
      if (user.role !== 'waiter') return 'All floors';
      const rules = user.access?.areas;
      if (!rules || Object.keys(rules).length === 0) return 'All floors';
      const parts = Object.entries(rules).map(([id, rule]) => {
        const area = areas.find((a) => a.id === Number(id));
        if (!area) return null;
        return rule.mode === 'tables' ? `${area.name} · ${rule.tables.length} table${rule.tables.length === 1 ? '' : 's'}` : area.name;
      }).filter(Boolean);
      return parts.join(', ') || 'All floors';
    },
  };
}

const LAST_SEEN = `(SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)`;

// GET /users — the restaurant's staff with who is online now and what each is assigned to.
router.get('/', view, async (req, res) => {
  const { restaurantId } = req.user;
  const { rows } = await db.query(
    `${USER_SELECT.replace('FROM users u', `, ${LAST_SEEN} AS last_seen_at FROM users u`)}
      WHERE u.restaurant_id = $1 AND u.deleted_at IS NULL
      ORDER BY u.active DESC, array_position(ARRAY['admin', 'manager', 'cashier', 'waiter', 'chef'], u.role), u.name`,
    [restaurantId]
  );
  const info = await assignments(restaurantId);
  const online = ws.onlineUsers(restaurantId);
  res.json({
    // Only the people this person may see: themself and the roles below their own.
    users: rows.filter((u) => visibleTo(req.user, u)).map((u) => ({ ...publicUser(u), online: online.has(u.id), last_seen_at: u.last_seen_at, assignment: info.summary(u) })),
    areas: info.areas,
    terminals: info.terminals,
    tables: info.tables,
    permissions: PERMISSIONS,
    presets: PRESETS,
  });
});

// Work done in a period. Cancelled, removed and voided dishes and cancelled orders do not count.
async function performance(restaurantId, user, from, to) {
  const args = [restaurantId, user.id, from, to];
  if (user.role === 'chef') {
    const { rows } = await db.query(
      `SELECT count(*)::int AS items_prepared,
              count(DISTINCT i.kot_id)::int AS tickets_completed,
              round(avg(extract(epoch FROM (i.ready_at - i.created_at)) / 60)::numeric, 1) AS avg_prep_minutes
         FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.restaurant_id = $1 AND i.ready_by = $2 AND i.ready_at >= $3 AND i.ready_at < $4
          AND i.status IN ('ready', 'delivered')`,
      args
    );
    return rows[0];
  }
  const taken = await db.query(
    `SELECT count(*)::int AS orders_taken,
            count(*) FILTER (WHERE o.status IN ('delivered', 'paid', 'closed'))::int AS orders_served,
            COALESCE(sum(o.total) FILTER (WHERE o.paid_at IS NOT NULL), 0) AS sales_handled
       FROM orders o
      WHERE o.restaurant_id = $1 AND o.waiter_id = $2 AND o.created_at >= $3 AND o.created_at < $4
        AND o.status NOT IN ('cancelled', 'merged')`,
    args
  );
  const paid = await db.query(
    `SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) AS payments_collected,
            count(*) FILTER (WHERE p.kind = 'payment')::int AS payments
       FROM payments p
      WHERE p.restaurant_id = $1 AND p.created_by = $2 AND p.created_at >= $3 AND p.created_at < $4 AND p.status = 'successful'`,
    args
  );
  return { ...taken.rows[0], ...paid.rows[0] };
}

// GET /users/:id?from=&to= — one person: profile, assignments, sessions, performance and activity.
router.get('/:id', view, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1 AND u.restaurant_id = $2 AND u.deleted_at IS NULL`, [id, restaurantId]);
  const user = rows[0];
  if (!user || !visibleTo(req.user, user)) throw new AppError(404, 'no_user', 'No such person');

  const to = Number.isNaN(Date.parse(req.query.to)) ? new Date() : new Date(req.query.to);
  const from = Number.isNaN(Date.parse(req.query.from)) ? new Date(to.getTime() - 30 * 86400000) : new Date(req.query.from);

  const info = await assignments(restaurantId);
  const sessions = (await db.query(
    `SELECT id, device, ip, created_at, last_seen_at, ended_at, end_reason FROM sessions
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`,
    [id]
  )).rows;
  const live = ws.onlineSessions(id);
  // What happened to the account: sign-ins and sign-outs, and every change someone made to it.
  const activity = (await db.query(
    `SELECT l.id, l.action, l.at, l.old, l.new, l.reason, a.name AS by_name, a.role AS by_role, l.user_id
       FROM audit_logs l LEFT JOIN users a ON a.id = l.user_id
      WHERE l.restaurant_id = $1 AND l.entity = 'user' AND l.entity_id = $2
      ORDER BY l.id DESC LIMIT 40`,
    [restaurantId, id]
  )).rows;

  const access = user.access?.areas || {};
  res.json({
    user: { ...publicUser(user), assignment: info.summary(user), online: ws.onlineUsers(restaurantId).has(id) },
    areas: info.areas,
    terminals: info.terminals,
    tables: info.tables,
    // The same assignment spelled out with names, for the profile and the review step.
    assigned: {
      areas: Object.keys(access).length === 0
        ? info.areas.map((a) => ({ id: a.id, name: a.name, mode: 'all' }))
        : Object.entries(access).map(([areaId, rule]) => ({
            id: Number(areaId),
            name: info.areas.find((a) => a.id === Number(areaId))?.name,
            mode: rule.mode,
            tables: rule.mode === 'tables' ? rule.tables.map((t) => info.tables.find((x) => x.id === t)?.label).filter(Boolean) : null,
          })).filter((a) => a.name),
      everywhere: Object.keys(access).length === 0,
      terminals: (user.terminals || []).map((t) => info.terminals.find((x) => x.id === t)).filter(Boolean),
    },
    sessions: sessions.map((s) => ({ ...s, online: live.has(s.id) })),
    performance: { from, to, ...(await performance(restaurantId, user, from, to)) },
    activity,
  });
});

// GET /users/:id/orders — the latest orders this person handled (waiter) for their profile.
router.get('/:id/orders', view, async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.id, o.number, o.type, o.status, o.total, o.created_at, o.paid_at, o.customer_name, o.car_number, t.label AS table_label,
            (SELECT COALESCE(sum(i.qty), 0)::int FROM order_items i WHERE i.order_id = o.id AND i.status NOT IN ('unavailable', 'removed', 'cancelled')) AS item_count
       FROM orders o LEFT JOIN tables t ON t.id = o.table_id
      WHERE o.restaurant_id = $1 AND o.waiter_id = $2 AND o.status <> 'merged'
      ORDER BY o.created_at DESC LIMIT 40`,
    [req.user.restaurantId, Number(req.params.id)]
  );
  res.json({ orders: rows });
});

// Only an admin-level person may add or change managers and admins, or anyone's permissions.
// Everyone else changes only the roles below their own.
function checkAuthority(req, role, body) {
  if (SENIOR.includes(role) && !can(req.user, 'staff.admin')) throw new AppError(403, 'forbidden', 'Only an admin can add or change managers and admins');
  if (req.user.role !== 'admin' && !outranks(req.user, { role })) throw new AppError(403, 'forbidden', 'You can only add or change the roles below your own');
  if (body.permissions !== undefined && !can(req.user, 'staff.admin')) {
    const keys = Object.keys(body.permissions || {});
    const onlyPrices = keys.length > 0 && keys.every((k) => MANAGER_SETS.includes(k)) && ['waiter', 'cashier'].includes(role);
    if (!onlyPrices) throw new AppError(403, 'forbidden', 'Only an admin can change permissions');
  }
}
// The switches a manager may set for the roles below them (the rest are the admin's).
const MANAGER_SETS = ['prices.view'];

// The waiter's payment level from the app: payment_access (take | close | none), or the older
// yes/no can_collect_payment. undefined = not sent.
function readLevel(body) {
  if (body.payment_access !== undefined) {
    if (!PAYMENT_LEVELS.includes(body.payment_access)) throw bad('Choose a payment permission');
    return body.payment_access;
  }
  if (body.can_collect_payment !== undefined) return body.can_collect_payment !== false ? 'take' : 'close';
  return undefined;
}

// POST /users { name, login_id, password, role, phone?, email?, discount_limit_pct?, pin?,
//               access?, can_collect_payment?, terminals?, permissions? }
router.post('/', manage, async (req, res) => {
  const body = req.body || {};
  const { restaurantId } = req.user;
  const name = text(body.name, 60);
  const loginId = text(body.login_id, 60);
  if (!name) throw bad('Enter a name');
  if (!/^[A-Za-z0-9._@+-]{3,60}$/.test(loginId)) throw bad('A Staff ID is 3 to 60 letters, digits, dots or dashes. An email address works too.');
  if (!ROLES.includes(body.role)) throw bad('Choose a role');
  checkAuthority(req, body.role, body);

  const contact = {};
  readContact(body, contact);
  const passwordHash = await readPassword(body.password);
  const pinHash = body.pin ? await readPin(body.pin) : null;
  const limit = body.discount_limit_pct === undefined ? 3 : readLimit(body.discount_limit_pct);
  const access = body.role === 'waiter' ? await readAccess(restaurantId, body.access) : {};
  const terminals = body.role === 'chef' ? await readTerminals(restaurantId, body.terminals) : [];
  const permissions = readOverrides(body.role, body.permissions);
  const level = body.role === 'waiter' ? readLevel(body) ?? 'take' : 'take';
  const collect = level === 'take';

  const created = await db.tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (restaurant_id, name, login_id, password_hash, pin_hash, role, discount_limit_pct, phone, email, image_id,
                          access, permissions, can_collect_payment, payment_access)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [restaurantId, name, loginId, passwordHash, pinHash, body.role, limit, contact.phone ?? null, contact.email ?? null, contact.image_id ?? null,
        JSON.stringify(access), JSON.stringify(permissions), collect, level]
    );
    await setTerminals(client, rows[0].id, terminals);
    await audit(client, {
      restaurantId, userId: req.user.id, action: 'user.add', entity: 'user', entityId: rows[0].id,
      new: { name, login_id: loginId, role: body.role, access, terminals, payment_access: level, permissions },
    });
    return rows[0].id;
  }).catch((err) => { throw taken(err); });

  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1`, [created]);
  res.status(201).json({ user: publicUser(rows[0]) });
});

// PATCH /users/:id — any of the fields above, plus active.
router.patch('/:id', manage, async (req, res) => {
  const body = req.body || {};
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const found = await db.query(`${USER_SELECT} WHERE u.id = $1 AND u.restaurant_id = $2 AND u.deleted_at IS NULL`, [id, restaurantId]);
  const before = found.rows[0];
  if (!before) throw new AppError(404, 'no_user', 'No such person');
  const role = body.role === undefined ? before.role : body.role;
  if (!ROLES.includes(role)) throw bad('Choose a role');
  checkAuthority(req, before.role, body);
  checkAuthority(req, role, body);

  const set = {};
  const changes = {};
  if (body.name !== undefined) { set.name = text(body.name, 60); if (!set.name) throw bad('Enter a name'); changes.name = set.name; }
  if (body.login_id !== undefined && text(body.login_id, 60) !== before.login_id) {
    set.login_id = text(body.login_id, 60);
    if (!/^[A-Za-z0-9._@+-]{3,60}$/.test(set.login_id)) throw bad('A Staff ID is 3 to 60 letters, digits, dots or dashes');
    changes.login_id = set.login_id;
  }
  if (role !== before.role) { set.role = role; changes.role = role; }
  if (body.active !== undefined && (body.active === true) !== before.active) { set.active = body.active === true; changes.active = set.active; }
  if (body.discount_limit_pct !== undefined) { set.discount_limit_pct = readLimit(body.discount_limit_pct); if (set.discount_limit_pct !== before.discount_limit_pct) changes.discount_limit_pct = set.discount_limit_pct; }
  if (body.password) { set.password_hash = await readPassword(body.password); changes.password = 'reset'; }
  if (body.pin) { set.pin_hash = await readPin(body.pin); changes.pin = 'set'; }
  readContact(body, set);
  for (const key of ['phone', 'email', 'image_id']) if (set[key] !== undefined && set[key] !== before[key]) changes[key] = set[key];
  if (role === 'waiter' && (body.access !== undefined || set.role)) {
    const access = await readAccess(restaurantId, body.access);
    set.access = JSON.stringify(access);
    changes.access = access;
  }
  const level = role === 'waiter' ? readLevel(body) : null;
  if (level && level !== before.payment_access) {
    set.payment_access = level;
    set.can_collect_payment = level === 'take';
    changes.payment_access = level;
  }
  if (body.permissions !== undefined || set.role) {
    // A changed role starts from its preset; otherwise only the switches sent change.
    const permissions = readOverrides(role, set.role ? (body.permissions ?? {}) : { ...(before.permissions || {}), ...(body.permissions || {}) });
    set.permissions = JSON.stringify(permissions);
    changes.permissions = permissions;
  }
  let terminals = null;
  if (role === 'chef' && (body.terminals !== undefined || set.role)) {
    terminals = await readTerminals(restaurantId, body.terminals);
    changes.terminals = terminals;
  } else if (set.role && before.role === 'chef') {
    terminals = [];
  }

  // Nobody can lock themselves out, and a restaurant always keeps an admin.
  if (id === req.user.id && (set.active === false || set.role)) {
    throw new AppError(409, 'self', 'You cannot deactivate yourself or change your own role');
  }
  if (before.role === 'admin' && (set.active === false || (set.role && set.role !== 'admin'))) {
    const others = await db.query(`SELECT 1 FROM users WHERE restaurant_id = $1 AND role = 'admin' AND active AND deleted_at IS NULL AND id <> $2 LIMIT 1`, [restaurantId, id]);
    if (!others.rows[0]) throw new AppError(409, 'last_admin', 'This is the only admin. Make someone else an admin first.');
  }

  const cols = Object.keys(set);
  await db.tx(async (client) => {
    if (cols.length) {
      await client.query(`UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => set[c])]);
    }
    if (terminals) await setTerminals(client, id, terminals);
    if (Object.keys(changes).length) {
      await audit(client, {
        restaurantId, userId: req.user.id, action: 'user.edit', entity: 'user', entityId: id,
        old: { name: before.name, role: before.role, active: before.active, discount_limit_pct: before.discount_limit_pct, access: before.access, terminals: before.terminals, can_collect_payment: before.can_collect_payment, permissions: before.permissions },
        new: changes,
      });
    }
  }).catch((err) => { throw taken(err); });

  // Deactivated, moved to another role, or password reset: every session is ended and their
  // screens are signed out now. Any other change reaches their screens within seconds.
  forgetUser(id);
  if (set.active === false || set.role || set.password_hash) {
    const reason = set.password_hash ? 'credential_reset' : 'revoked';
    await endSessions(db, { userId: id, except: id === req.user.id ? req.user.sessionId : null, reason });
    ws.kick(id, { exceptSession: id === req.user.id ? req.user.sessionId : null });
  } else {
    ws.toUser(restaurantId, id, 'me.updated', {});
  }
  const { rows } = await db.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
  res.json({ user: publicUser(rows[0]) });
});

// POST /users/:id/logout { sessionId? } — end one session of this person, or all of them.
router.post('/:id/logout', manage, async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.query('SELECT role FROM users WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [id, req.user.restaurantId]);
  if (!found.rows[0]) throw new AppError(404, 'no_user', 'No such person');
  checkAuthority(req, found.rows[0].role, {});
  const sessionId = req.body?.sessionId ? String(req.body.sessionId) : null;
  const ended = await endSessions(db, { userId: id, sessionId, reason: 'revoked' });
  ws.kick(id, { sessionId });
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: sessionId ? 'session.revoke' : 'session.revoke_all', entity: 'user', entityId: id, new: { ended } });
  res.json({ ok: true, ended });
});

// DELETE /users/:id — the person can no longer sign in and leaves the staff list.
// Their name stays on the orders, payments and reports they were part of.
router.delete('/:id', manage, async (req, res) => {
  const id = Number(req.params.id);
  const { restaurantId } = req.user;
  const found = await db.query('SELECT * FROM users WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [id, restaurantId]);
  const before = found.rows[0];
  if (!before) throw new AppError(404, 'no_user', 'No such person');
  checkAuthority(req, before.role, {});
  if (id === req.user.id) throw new AppError(409, 'self', 'You cannot delete yourself');
  if (before.role === 'admin') {
    const others = await db.query(`SELECT 1 FROM users WHERE restaurant_id = $1 AND role = 'admin' AND active AND deleted_at IS NULL AND id <> $2 LIMIT 1`, [restaurantId, id]);
    if (!others.rows[0]) throw new AppError(409, 'last_admin', 'This is the only admin. Make someone else an admin first.');
  }
  const open = await db.query(`SELECT count(*)::int AS n FROM orders WHERE waiter_id = $1 AND status NOT IN ('closed', 'cancelled', 'merged')`, [id]);
  if (open.rows[0].n > 0) throw new AppError(409, 'has_orders', `${before.name} still has ${open.rows[0].n} open order${open.rows[0].n === 1 ? '' : 's'}. Close them first.`);

  await db.tx(async (client) => {
    // The login ID is freed for someone else; the name stays for history.
    await client.query(`UPDATE users SET deleted_at = now(), active = false, login_id = left('deleted-' || id || '-' || login_id, 60) WHERE id = $1`, [id]);
    await client.query('UPDATE tables SET locked_by = NULL, locked_at = NULL, status = \'free\' WHERE locked_by = $1 AND status = \'occupied\'', [id]);
    await endSessions(client, { userId: id, reason: 'deleted' });
    await audit(client, { restaurantId, userId: req.user.id, action: 'user.delete', entity: 'user', entityId: id, old: { name: before.name, role: before.role, login_id: before.login_id } });
  });
  ws.kick(id);
  res.json({ ok: true });
});

// POST /users/:id/otp — a manager or admin makes a one-time login code for someone.
// No SMS: the code is read out or shown to the person, who types it at login. Valid for 10 minutes.
router.post('/:id/otp', view, async (req, res) => {
  const id = Number(req.params.id);
  const found = await db.query('SELECT id, name, role FROM users WHERE id = $1 AND restaurant_id = $2 AND active AND deleted_at IS NULL', [id, req.user.restaurantId]);
  if (!found.rows[0] || !visibleTo(req.user, found.rows[0])) throw new AppError(404, 'no_user', 'No such person');
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
