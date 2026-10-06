// Manager and admin endpoints that are too small for a file each:
// restaurant settings, tables, order history, the daily report and the audit log.
const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requireRole } = require('../auth');
const { ORDER_SELECT, audit } = require('../orders');
const { TABLE_SELECT, getTable } = require('../tables');
const { APPROVAL_SELECT } = require('../approvals');
const ws = require('../ws/events');

const router = express.Router();
const admin = requireRole('admin');
const managers = requireRole('manager', 'admin');
const ROLES = ['admin', 'manager', 'chef', 'waiter'];
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

// PATCH /restaurant { name?, payment_at?, otp_roles? } — admin only. Pushed to every screen.
router.patch('/restaurant', admin, async (req, res) => {
  const body = req.body || {};
  const { restaurantId } = req.user;
  const before = (await db.query('SELECT name, settings FROM restaurants WHERE id = $1', [restaurantId])).rows[0];
  const name = body.name === undefined ? before.name : text(body.name, 60);
  if (!name) throw bad('Enter the restaurant name');
  const settings = { ...before.settings };
  if (body.payment_at !== undefined) {
    if (!['waiter', 'counter'].includes(body.payment_at)) throw bad('Payment is taken by the waiter or at the counter');
    settings.payment_at = body.payment_at;
  }
  if (body.otp_roles !== undefined) {
    if (!Array.isArray(body.otp_roles) || body.otp_roles.some((r) => !ROLES.includes(r))) throw bad('Unknown role');
    // The admin is left out on purpose: nobody else could make a code to let a locked-out admin back in.
    settings.otp_roles = [...new Set(body.otp_roles)].filter((r) => r !== 'admin');
  }
  const { rows } = await db.query('UPDATE restaurants SET name = $1, settings = $2 WHERE id = $3 RETURNING id, name, settings', [
    name,
    JSON.stringify(settings),
    restaurantId,
  ]);
  await audit(db, { restaurantId, userId: req.user.id, action: 'restaurant.edit', entity: 'restaurant', entityId: restaurantId, old: before, new: { name, settings } });
  ws.toRestaurant(restaurantId, 'restaurant.updated', rows[0]);
  res.json({ restaurant: rows[0] });
});

// POST /tables { label, seats }
router.post('/tables', managers, async (req, res) => {
  const label = text(req.body?.label, 12);
  const seats = Number(req.body?.seats ?? 4);
  if (!label) throw bad('Give the table a name, for example T7');
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) throw bad('Seats is a number from 1 to 50');
  const { rows } = await db
    .query('INSERT INTO tables (restaurant_id, label, seats) VALUES ($1, $2, $3) RETURNING id', [req.user.restaurantId, label, seats])
    .catch((err) => { throw err.code === '23505' ? new AppError(409, 'label_taken', 'There is already a table with that name') : err; });
  const table = await getTable(db, req.user.restaurantId, rows[0].id);
  ws.toRestaurant(req.user.restaurantId, 'table.updated', table);
  res.status(201).json({ table });
});

// PATCH /tables/:id { label?, seats? }
router.patch('/tables/:id', managers, async (req, res) => {
  const id = Number(req.params.id);
  const before = await getTable(db, req.user.restaurantId, id);
  if (!before) throw new AppError(404, 'no_table', 'No such table');
  const label = req.body?.label === undefined ? before.label : text(req.body.label, 12);
  const seats = req.body?.seats === undefined ? before.seats : Number(req.body.seats);
  if (!label) throw bad('Give the table a name');
  if (!Number.isInteger(seats) || seats < 1 || seats > 50) throw bad('Seats is a number from 1 to 50');
  await db
    .query('UPDATE tables SET label = $1, seats = $2 WHERE id = $3', [label, seats, id])
    .catch((err) => { throw err.code === '23505' ? new AppError(409, 'label_taken', 'There is already a table with that name') : err; });
  const table = await getTable(db, req.user.restaurantId, id);
  ws.toRestaurant(req.user.restaurantId, 'table.updated', table);
  res.json({ table });
});

// GET /tables — every table with its live state.
router.get('/tables', async (req, res) => {
  const { rows } = await db.query(`${TABLE_SELECT} WHERE t.restaurant_id = $1 ORDER BY t.id`, [req.user.restaurantId]);
  res.json({ tables: rows });
});

// Reads ?from=&to= (ISO times). The app sends the start and end of its own day, so "today"
// means the restaurant's day and not the server's.
function readRange(query) {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw bad('Choose a day');
  return [from.toISOString(), to.toISOString()];
}

// GET /orders?from=&to=&status=&type= — order history for the manager (newest first, up to 200).
router.get('/orders', managers, async (req, res) => {
  const [from, to] = readRange(req.query);
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3
        AND ($4::text IS NULL OR o.status = $4) AND ($5::text IS NULL OR o.type = $5)
      ORDER BY o.created_at DESC
      LIMIT 200`,
    [req.user.restaurantId, from, to, req.query.status || null, req.query.type || null]
  );
  res.json({ orders: rows });
});

const AUDIT_SELECT = `SELECT l.*, u.name AS user_name, u.role AS user_role FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id`;

// GET /orders/:id — one order (open or closed) with everything that ever happened to it.
router.get('/orders/:id', managers, async (req, res) => {
  const id = Number(req.params.id);
  const order = (await db.query(`${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.id = $2`, [req.user.restaurantId, id])).rows[0];
  if (!order) throw new AppError(404, 'no_order', 'No such order');
  const trail = await db.query(
    `${AUDIT_SELECT}
      WHERE l.restaurant_id = $1
        AND ((l.entity = 'order' AND l.entity_id = $2)
          OR (l.entity = 'order_item' AND l.entity_id IN (SELECT id FROM order_items WHERE order_id = $2)))
      ORDER BY l.id`,
    [req.user.restaurantId, id]
  );
  const approvals = await db.query(`${APPROVAL_SELECT} WHERE a.restaurant_id = $1 AND a.order_id = $2 ORDER BY a.id`, [req.user.restaurantId, id]);
  res.json({ order, audit: trail.rows, approvals: approvals.rows });
});

// GET /reports/daily?from=&to= — sales, orders by type, top items, and the cancel and discount log.
router.get('/reports/daily', managers, async (req, res) => {
  const [from, to] = readRange(req.query);
  const args = [req.user.restaurantId, from, to];
  const paid = `o.restaurant_id = $1 AND o.status = 'closed' AND o.paid_at >= $2 AND o.paid_at < $3`;

  const sales = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(o.total), 0) AS total, COALESCE(sum(o.discount_amount), 0) AS discounts
       FROM orders o WHERE ${paid}`,
    args
  );
  const byMethod = await db.query(
    `SELECT o.payment_method AS method, count(*)::int AS orders, sum(o.total) AS total FROM orders o WHERE ${paid} GROUP BY 1 ORDER BY 3 DESC`,
    args
  );
  const byType = await db.query(
    `SELECT o.type, count(*)::int AS orders, sum(o.total) AS total FROM orders o WHERE ${paid} GROUP BY 1 ORDER BY 3 DESC`,
    args
  );
  const topItems = await db.query(
    `SELECT i.name_snapshot AS name, sum(i.qty)::int AS qty, sum(i.qty * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${paid} AND i.status = 'delivered'
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
    args
  );
  const open = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0) AS total FROM orders
      WHERE restaurant_id = $1 AND status NOT IN ('closed', 'cancelled')`,
    [req.user.restaurantId]
  );
  // Every cancel and discount of the day, approved, rejected or applied within a waiter's own limit.
  const log = await db.query(
    `${AUDIT_SELECT}
      WHERE l.restaurant_id = $1 AND l.at >= $2 AND l.at < $3
        AND (l.action LIKE 'cancel.%' OR l.action LIKE 'discount.%' OR l.action = 'item.unavailable')
      ORDER BY l.id DESC LIMIT 100`,
    args
  );
  res.json({ sales: sales.rows[0], byMethod: byMethod.rows, byType: byType.rows, topItems: topItems.rows, open: open.rows[0], log: log.rows });
});

// GET /audit?before=<id> — the full audit log, newest first, 100 at a time (admin only).
router.get('/audit', admin, async (req, res) => {
  const before = Number(req.query.before) || null;
  const { rows } = await db.query(
    `${AUDIT_SELECT} WHERE l.restaurant_id = $1 AND ($2::bigint IS NULL OR l.id < $2) ORDER BY l.id DESC LIMIT 100`,
    [req.user.restaurantId, before]
  );
  res.json({ entries: rows });
});

module.exports = router;
