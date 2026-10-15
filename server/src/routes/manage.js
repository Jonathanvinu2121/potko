// Manager and admin endpoints that are too small for a file each:
// restaurant profile and settings, the Overview numbers, order history, approvals history
// and the audit log.
const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm } = require('../permissions');
const { ORDER_SELECT, audit } = require('../orders');
const { APPROVAL_SELECT } = require('../approvals');
const { settingsOf, readSettings, readProfile, businessDayStart, currentService } = require('../settings');
const ws = require('../ws/events');
const { publicRestaurant } = require('./auth');

const router = express.Router();
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

// PATCH /restaurant { name?, profile?: { address, phone, email, gstin, footer, logo_image_id }, ...settings }
// Pushed to every screen, so the name in the header and on receipts changes at once.
router.patch('/restaurant', requirePerm('settings.manage'), async (req, res) => {
  const body = req.body || {};
  const { restaurantId } = req.user;
  const before = (await db.query('SELECT id, name, settings, profile FROM restaurants WHERE id = $1', [restaurantId])).rows[0];
  const name = body.name === undefined ? before.name : text(body.name, 60);
  if (!name) throw bad('Enter the restaurant name');
  const changes = readSettings(body);
  const settings = { ...before.settings, ...changes };
  const profile = body.profile === undefined ? before.profile : readProfile(body.profile || {}, before.profile);

  const { rows } = await db.query(
    'UPDATE restaurants SET name = $1, settings = $2, profile = $3 WHERE id = $4 RETURNING id, name, settings, profile',
    [name, JSON.stringify(settings), JSON.stringify(profile), restaurantId]
  );
  await audit(db, {
    restaurantId, userId: req.user.id, action: 'restaurant.edit', entity: 'restaurant', entityId: restaurantId,
    old: { name: before.name, profile: before.profile, settings: Object.fromEntries(Object.keys(changes).map((k) => [k, before.settings[k]])) },
    new: { name, profile: body.profile === undefined ? undefined : profile, settings: changes },
  });
  const restaurant = publicRestaurant(rows[0]);
  ws.toRestaurant(restaurantId, 'restaurant.updated', restaurant);
  res.json({ restaurant });
});

// Reads ?from=&to= (ISO times).
function readRange(query) {
  const from = new Date(query.from);
  const to = new Date(query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw bad('Choose a day');
  return [from.toISOString(), to.toISOString()];
}

// Sales of paid bills in a period. Net sales is the value after discounts and before tax,
// with refunds taken off (the tax share of a refund is left out in the same proportion).
const KPI_SQL = `
  SELECT count(*)::int AS orders,
         COALESCE(sum(o.guests), 0)::int AS guests,
         COALESCE(sum(o.taxable), 0) AS net_before_refunds,
         COALESCE(sum(o.total), 0) AS billed,
         COALESCE(sum(o.discount_amount), 0) AS discounts,
         COALESCE(sum(o.tax_total), 0) AS tax
    FROM orders o
   WHERE o.restaurant_id = $1 AND o.paid_at >= $2 AND o.paid_at < $3 AND o.status IN ('paid', 'closed')`;
const REFUND_SQL = `
  SELECT COALESCE(sum(p.amount), 0) AS refunds,
         COALESCE(sum(CASE WHEN o.total > 0 THEN p.amount * o.taxable / o.total ELSE p.amount END), 0) AS refunds_net
    FROM payments p JOIN orders o ON o.id = p.order_id
   WHERE p.restaurant_id = $1 AND p.kind = 'refund' AND p.status = 'successful' AND p.created_at >= $2 AND p.created_at < $3`;

async function kpis(restaurantId, from, to) {
  const args = [restaurantId, from, to];
  const sales = (await db.query(KPI_SQL, args)).rows[0];
  const refunds = (await db.query(REFUND_SQL, args)).rows[0];
  const net = Math.round((sales.net_before_refunds - refunds.refunds_net) * 100) / 100;
  return {
    orders: sales.orders,
    guests: sales.guests,
    net_sales: net,
    average_order: sales.orders > 0 ? Math.round((net / sales.orders) * 100) / 100 : 0,
    discounts: sales.discounts,
    tax: sales.tax,
    refunds: refunds.refunds,
  };
}

// GET /overview — the service running now and today's numbers (the restaurant's own business
// day and time zone). `previous` is the day before up to the same time of day, so a comparison
// is like for like; the app shows it only when there is something to compare with.
router.get('/overview', requirePerm('overview.view'), async (req, res) => {
  const { restaurantId } = req.user;
  const settings = settingsOf((await db.query('SELECT settings FROM restaurants WHERE id = $1', [restaurantId])).rows[0].settings);
  const now = new Date();
  const start = businessDayStart(settings, now);
  const prevStart = businessDayStart(settings, now, -1);
  const prevEnd = new Date(prevStart.getTime() + (now.getTime() - start.getTime()));
  res.json({
    now: now.toISOString(),
    day_start: start.toISOString(),
    timezone: settings.timezone,
    service: currentService(settings, now),
    today: await kpis(restaurantId, start, now),
    previous: await kpis(restaurantId, prevStart, prevEnd),
  });
});

// GET /orders?from=&to=&status=&type= — order history for the manager (newest first, up to 200).
router.get('/orders', requirePerm('orders.view'), async (req, res) => {
  const [from, to] = readRange(req.query);
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3 AND o.status <> 'merged'
        AND ($4::text IS NULL OR o.status = $4) AND ($5::text IS NULL OR o.type = $5)
      ORDER BY o.created_at DESC
      LIMIT 200`,
    [req.user.restaurantId, from, to, req.query.status || null, req.query.type || null]
  );
  res.json({ orders: rows });
});

const AUDIT_SELECT = `SELECT l.*, u.name AS user_name, COALESCE(l.actor_role, u.role) AS user_role FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id`;

// GET /orders/:id — one order (open or closed) with everything that ever happened to it.
router.get('/orders/:id', requirePerm('orders.view'), async (req, res) => {
  const id = Number(req.params.id);
  const order = (await db.query(`${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.id = $2`, [req.user.restaurantId, id])).rows[0];
  if (!order) throw new AppError(404, 'no_order', 'No such order');
  const trail = await db.query(
    `${AUDIT_SELECT}
      WHERE l.restaurant_id = $1
        AND ((l.entity = 'order' AND l.entity_id = $2)
          OR (l.refs ->> 'order_id')::int = $2
          OR (l.refs -> 'order_ids') @> to_jsonb($2::int)
          OR (l.entity = 'order_item' AND l.entity_id IN (SELECT id FROM order_items WHERE order_id = $2)))
      ORDER BY l.id`,
    [req.user.restaurantId, id]
  );
  const approvals = await db.query(`${APPROVAL_SELECT} WHERE a.restaurant_id = $1 AND a.order_id = $2 ORDER BY a.id`, [req.user.restaurantId, id]);
  const kots = await db.query(
    `SELECT k.id, k.number, k.sent_at, k.table_label, t.name AS terminal_name, s.name AS sent_by_name
       FROM kots k JOIN kitchen_terminals t ON t.id = k.terminal_id LEFT JOIN users s ON s.id = k.sent_by
      WHERE k.restaurant_id = $1 AND k.id IN (SELECT kot_id FROM order_items WHERE order_id = $2)
      ORDER BY k.number`,
    [req.user.restaurantId, id]
  );
  res.json({ order, audit: trail.rows, approvals: approvals.rows, kots: kots.rows });
});

// GET /approvals?status=decided — requests decided in the last 24 hours, newest first, to show
// under the ones still waiting. (The waiting ones come live through /sync.)
router.get('/approvals', requirePerm('approvals.decide', 'orders.view'), async (req, res) => {
  const { rows } = await db.query(
    `${APPROVAL_SELECT}
      WHERE a.restaurant_id = $1 AND a.status <> 'pending' AND a.decided_at > now() - interval '24 hours'
      ORDER BY a.decided_at DESC LIMIT 50`,
    [req.user.restaurantId]
  );
  res.json({ approvals: rows });
});

// GET /approvals/:id — one request with the order it is about, for the approval screen.
router.get('/approvals/:id', requirePerm('approvals.decide', 'orders.view'), async (req, res) => {
  const approval = (await db.query(`${APPROVAL_SELECT} WHERE a.restaurant_id = $1 AND a.id = $2`, [req.user.restaurantId, Number(req.params.id)])).rows[0];
  if (!approval) throw new AppError(404, 'no_approval', 'No such request');
  const order = (await db.query(`${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.id = $2`, [req.user.restaurantId, approval.order_id])).rows[0];
  res.json({ approval, order });
});

// GET /audit?before=<id>&entity=&q= — the full audit log, newest first, 100 at a time.
router.get('/audit', requirePerm('audit.view'), async (req, res) => {
  const before = Number(req.query.before) || null;
  const entity = req.query.entity ? String(req.query.entity) : null;
  const { rows } = await db.query(
    `${AUDIT_SELECT}
      WHERE l.restaurant_id = $1 AND ($2::bigint IS NULL OR l.id < $2) AND ($3::text IS NULL OR l.entity = $3)
      ORDER BY l.id DESC LIMIT 100`,
    [req.user.restaurantId, before, entity]
  );
  res.json({ entries: rows });
});

module.exports = router;
module.exports.kpis = kpis;
