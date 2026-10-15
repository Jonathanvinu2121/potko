// Reports. Every number is added up here on the server, over the restaurant's own business days
// in its own time zone, from bills that were actually paid.
//
// Definitions used everywhere (the app shows them next to the numbers):
//   Gross sales  the menu value of what was sold on paid bills, before discounts and tax
//   Net sales    paid bills after discounts and before tax, with refunds taken off
//   Collected    money taken, by payment method, less refunds
// Cancelled, removed and voided dishes and cancelled orders are never counted as sales or as work done.
const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm } = require('../permissions');
const { settingsOf, businessDayStart, zoneParts, zoneTime } = require('../settings');
const { kpis } = require('./manage');

const router = express.Router();
router.use(requirePerm('reports.view'));
const bad = (message) => new AppError(400, 'bad_input', message);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');

const RANGES = { today: 1, '7d': 7, '30d': 30, '3m': 90, '1y': 365 };
const LABELS = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', '3m': 'Last 3 months', '1y': 'Last year' };

// Turns ?range=today|7d|30d|3m|1y or ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD into the exact
// period, the equal period just before it, and the size of the steps a trend chart should use.
async function readPeriod(req) {
  const settings = settingsOf((await db.query('SELECT settings FROM restaurants WHERE id = $1', [req.user.restaurantId])).rows[0].settings);
  const zone = settings.timezone;
  const [h, m] = settings.day_start.split(':').map(Number);
  const now = new Date();
  const today = businessDayStart(settings, now);
  const range = String(req.query.range || 'today');
  let from;
  let to;
  let label;
  if (range === 'custom') {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.query.from || ''));
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.query.to || ''));
    if (!a || !b) throw bad('Choose the first and last day');
    from = zoneTime(zone, +a[1], +a[2], +a[3], h, m);
    to = zoneTime(zone, +b[1], +b[2], +b[3] + 1, h, m);
    if (!(to > from)) throw bad('The last day is before the first day');
    if (to - from > 400 * 86400000) throw bad('Choose a period of up to 13 months');
    label = a[0] === b[0] ? a[0] : `${a[0]} to ${b[0]}`;
  } else {
    const days = RANGES[range];
    if (!days) throw bad('Unknown period');
    from = businessDayStart(settings, now, -(days - 1));
    to = new Date(today.getTime() + 86400000);
    label = LABELS[range];
  }
  const days = Math.max(1, Math.round((to - from) / 86400000));
  const unit = days <= 1 ? 'hour' : days <= 31 ? 'day' : days <= 92 ? 'week' : 'month';
  return {
    settings, zone, range, label, days, unit, now,
    from, to,
    prevFrom: new Date(from.getTime() - (to - from)),
    prevTo: from,
    offsetMinutes: h * 60 + m,
  };
}

// SQL for the bucket a time falls in, on the restaurant's clock. Days, weeks and months follow
// the business day (a 1 am bill belongs to the evening before); hours are plain clock hours.
function bucketSql(column, unit) {
  // ($5 is named in both forms so the same list of values fits either query.)
  if (unit === 'hour') return `to_char(date_trunc('hour', (${column} AT TIME ZONE $4) + make_interval(mins => $5 * 0)), 'YYYY-MM-DD HH24:00')`;
  return `to_char(date_trunc('${unit}', (${column} AT TIME ZONE $4) - make_interval(mins => $5)), 'YYYY-MM-DD')`;
}

// Every hour of the day so far, or every day of the period, so quiet times show as zero.
function emptyBuckets(period) {
  const keys = [];
  const p = zoneParts(period.from, period.zone);
  if (period.unit === 'hour') {
    const end = Math.min(period.to.getTime(), period.now.getTime());
    for (let t = period.from.getTime(); t < end; t += 3600000) {
      const q = zoneParts(new Date(t), period.zone);
      keys.push(`${q.year}-${pad(q.month)}-${pad(q.day)} ${pad(q.hour)}:00`);
    }
  } else if (period.unit === 'day') {
    for (let d = 0; d < period.days; d += 1) {
      const day = new Date(Date.UTC(p.year, p.month - 1, p.day + d));
      keys.push(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`);
    }
  }
  return keys;
}

function fill(period, rows, blank) {
  const keys = emptyBuckets(period);
  if (keys.length === 0) return rows;
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  return [...new Set([...keys, ...rows.map((r) => r.bucket)])].sort().map((bucket) => byKey.get(bucket) || { bucket, ...blank });
}

const head = (period) => ({ range: period.range, label: period.label, from: period.from, to: period.to, unit: period.unit, days: period.days, timezone: period.zone });
const PAID = `o.restaurant_id = $1 AND o.paid_at >= $2 AND o.paid_at < $3 AND o.status IN ('paid', 'closed')`;

// GET /reports/overview — the headline numbers, the same numbers for the period before (only
// offered when that period had sales to compare with), and the trend.
router.get('/overview', async (req, res) => {
  const period = await readPeriod(req);
  const { restaurantId } = req.user;
  const args = [restaurantId, period.from, period.to];
  const current = await kpis(restaurantId, period.from, period.to);
  const before = await kpis(restaurantId, period.prevFrom, period.prevTo);
  const sold = (await db.query(
    `SELECT COALESCE(sum(i.qty), 0)::int AS items FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${PAID} AND i.status = 'delivered'`,
    args
  )).rows[0];
  // Table turnover: parties served per table per day, counted only from table orders.
  const turns = (await db.query(
    `SELECT count(*)::int AS parties,
            (SELECT count(*)::int FROM tables t WHERE t.restaurant_id = $1 AND t.active AND NOT t.archived AND t.parent_table_id IS NULL) AS tables
       FROM orders o WHERE ${PAID} AND o.type = 'dine_in' AND o.parent_order_id IS NULL`,
    args
  )).rows[0];
  const trend = (await db.query(
    `SELECT ${bucketSql('o.paid_at', period.unit)} AS bucket, count(*)::int AS orders, COALESCE(sum(o.taxable), 0) AS net_sales
       FROM orders o WHERE ${PAID} GROUP BY 1 ORDER BY 1`,
    [...args, period.zone, period.offsetMinutes]
  )).rows;
  res.json({
    period: head(period),
    kpis: { ...current, items_sold: sold.items, table_turnover: turns.tables > 0 ? round2(turns.parties / turns.tables / period.days) : null },
    // No made-up growth: without sales in the period before there is nothing to compare with.
    previous: before.orders > 0 ? before : null,
    trend: fill(period, trend, { orders: 0, net_sales: 0 }),
  });
});

// GET /reports/sales — revenue step by step, by payment method, by order type and over time.
router.get('/sales', async (req, res) => {
  const period = await readPeriod(req);
  const { restaurantId } = req.user;
  const args = [restaurantId, period.from, period.to];
  const totals = (await db.query(
    `SELECT count(*)::int AS orders,
            COALESCE(sum(o.subtotal), 0) AS gross, COALESCE(sum(o.discount_amount), 0) AS discounts,
            COALESCE(sum(o.service_charge), 0) AS service_charge, COALESCE(sum(o.taxable), 0) AS taxable,
            COALESCE(sum(o.tax_total), 0) AS tax, COALESCE(sum(o.round_off), 0) AS round_off, COALESCE(sum(o.total), 0) AS billed
       FROM orders o WHERE ${PAID}`,
    args
  )).rows[0];
  const current = await kpis(restaurantId, period.from, period.to);
  const byMethod = (await db.query(
    `SELECT p.method,
            count(*) FILTER (WHERE p.kind = 'payment')::int AS payments,
            COALESCE(sum(p.amount) FILTER (WHERE p.kind = 'payment'), 0) AS amount,
            COALESCE(sum(p.amount) FILTER (WHERE p.kind = 'refund'), 0) AS refunds
       FROM payments p
      WHERE p.restaurant_id = $1 AND p.created_at >= $2 AND p.created_at < $3 AND p.status = 'successful'
      GROUP BY 1 ORDER BY 3 DESC`,
    args
  )).rows;
  const byType = (await db.query(
    `SELECT o.type, count(*)::int AS orders, COALESCE(sum(o.taxable), 0) AS net_sales, COALESCE(sum(o.total), 0) AS billed
       FROM orders o WHERE ${PAID} GROUP BY 1 ORDER BY 3 DESC`,
    args
  )).rows;
  const trend = (await db.query(
    `SELECT ${bucketSql('o.paid_at', period.unit)} AS bucket, count(*)::int AS orders,
            COALESCE(sum(o.subtotal), 0) AS gross, COALESCE(sum(o.discount_amount), 0) AS discounts,
            COALESCE(sum(o.taxable), 0) AS net_sales, COALESCE(sum(o.tax_total), 0) AS tax
       FROM orders o WHERE ${PAID} GROUP BY 1 ORDER BY 1`,
    [...args, period.zone, period.offsetMinutes]
  )).rows;
  const taxLines = (await db.query(
    `SELECT line ->> 'label' AS label, sum((line ->> 'amount')::numeric) AS amount
       FROM orders o, jsonb_array_elements(o.tax_lines) AS line
      WHERE ${PAID} GROUP BY 1 ORDER BY 1`,
    args
  )).rows;
  res.json({
    period: head(period),
    totals: { ...totals, refunds: current.refunds, net_sales: current.net_sales, collected: round2(byMethod.reduce((sum, r) => sum + r.amount - r.refunds, 0)) },
    by_method: byMethod,
    by_type: byType,
    tax_lines: taxLines,
    trend: fill(period, trend, { orders: 0, gross: 0, discounts: 0, net_sales: 0, tax: 0 }),
  });
});

// GET /reports/menu — what sells and what does not, in the chosen period.
router.get('/menu', async (req, res) => {
  const period = await readPeriod(req);
  const { restaurantId } = req.user;
  const args = [restaurantId, period.from, period.to];
  const sold = (await db.query(
    `SELECT i.menu_item_id AS id, max(i.name_snapshot) AS name, m.code, c.name AS category,
            sum(i.qty)::int AS qty, sum(i.qty * i.unit_price) AS revenue
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN menu_items m ON m.id = i.menu_item_id
       JOIN categories c ON c.id = m.category_id
      WHERE ${PAID} AND i.status = 'delivered'
      GROUP BY i.menu_item_id, m.code, c.name`,
    args
  )).rows;
  // On the menu now, and not sold once in the period. Kept apart from "sold least".
  const never = (await db.query(
    `SELECT m.id, m.name, m.code, c.name AS category, m.available
       FROM menu_items m JOIN categories c ON c.id = m.category_id
      WHERE m.restaurant_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
                         WHERE i.menu_item_id = m.id AND ${PAID} AND i.status = 'delivered')
      ORDER BY c.sort, m.sort, m.id`,
    args
  )).rows;
  const categories = new Map();
  for (const row of sold) {
    const c = categories.get(row.category) || { category: row.category, qty: 0, revenue: 0, items: 0 };
    c.qty += row.qty;
    c.revenue = round2(c.revenue + row.revenue);
    c.items += 1;
    categories.set(row.category, c);
  }
  const by = (key, dir = -1) => (a, b) => dir * (a[key] - b[key]) || a.name.localeCompare(b.name);
  res.json({
    period: head(period),
    totals: { items_sold: sold.reduce((sum, r) => sum + r.qty, 0), revenue: round2(sold.reduce((sum, r) => sum + r.revenue, 0)), different_items: sold.length },
    top_by_qty: sold.slice().sort(by('qty')).slice(0, 10),
    top_by_revenue: sold.slice().sort(by('revenue')).slice(0, 10),
    least_ordered: sold.slice().sort(by('qty', 1)).slice(0, 10),
    never_ordered: never,
    categories: [...categories.values()].sort((a, b) => b.revenue - a.revenue),
  });
});

// GET /reports/orders — when orders come, how long the kitchen and the tables take, and the mix.
router.get('/orders', async (req, res) => {
  const period = await readPeriod(req);
  const { restaurantId } = req.user;
  const args = [restaurantId, period.from, period.to];
  // Orders are counted when they were taken, whether or not they are paid yet. Cancelled and merged ones are left out.
  const TAKEN = `o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3 AND o.status NOT IN ('cancelled', 'merged')`;
  const byHour = (await db.query(
    `SELECT extract(hour FROM o.created_at AT TIME ZONE $4)::int AS hour, count(*)::int AS orders
       FROM orders o WHERE ${TAKEN} GROUP BY 1 ORDER BY 1`,
    [...args, period.zone]
  )).rows;
  const byDay = (await db.query(
    `SELECT extract(isodow FROM (o.created_at AT TIME ZONE $4) - make_interval(mins => $5))::int AS day, count(*)::int AS orders
       FROM orders o WHERE ${TAKEN} GROUP BY 1 ORDER BY 1`,
    [...args, period.zone, period.offsetMinutes]
  )).rows;
  const byType = (await db.query(`SELECT o.type, count(*)::int AS orders FROM orders o WHERE ${TAKEN} GROUP BY 1 ORDER BY 2 DESC`, args)).rows;
  const counts = (await db.query(
    `SELECT count(*) FILTER (WHERE o.status NOT IN ('cancelled', 'merged'))::int AS orders,
            count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled
       FROM orders o WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3`,
    args
  )).rows[0];
  // Preparation time: from the dish reaching the kitchen to "ready". Dishes without both times
  // (older orders, or never cooked) are left out rather than guessed.
  const prep = (await db.query(
    `SELECT round(avg(extract(epoch FROM (i.ready_at - i.created_at)) / 60)::numeric, 1) AS minutes, count(*)::int AS dishes
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${TAKEN} AND i.ready_at IS NOT NULL AND i.status IN ('ready', 'delivered')`,
    args
  )).rows[0];
  // Table time: from the first dish sent to the bill being paid.
  const duration = (await db.query(
    `SELECT round(avg(extract(epoch FROM (o.paid_at - o.created_at)) / 60)::numeric, 0) AS minutes, count(*)::int AS tables
       FROM orders o WHERE ${TAKEN} AND o.type = 'dine_in' AND o.paid_at IS NOT NULL`,
    args
  )).rows[0];
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: byHour.find((r) => r.hour === hour)?.orders || 0 }));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => ({ day: name, orders: byDay.find((r) => r.day === i + 1)?.orders || 0 }));
  const peakHour = hours.slice().sort((a, b) => b.orders - a.orders)[0];
  const peakDay = days.slice().sort((a, b) => b.orders - a.orders)[0];
  res.json({
    period: head(period),
    totals: { orders: counts.orders, cancelled: counts.cancelled },
    peak_hour: peakHour.orders > 0 ? peakHour : null,
    peak_day: peakDay.orders > 0 && period.days > 1 ? peakDay : null,
    by_hour: hours,
    by_day: days,
    by_type: byType,
    prep: prep.dishes > 0 ? prep : null,
    table_time: duration.tables > 0 ? duration : null,
  });
});

// Hours signed in during the period, from session records (a session still open counts up to when it was last seen).
const HOURS_SQL = `
  SELECT s.user_id, round(sum(extract(epoch FROM (LEAST(COALESCE(s.ended_at, s.last_seen_at), $3::timestamptz) - GREATEST(s.created_at, $2::timestamptz))) / 3600)::numeric, 1) AS hours
    FROM sessions s
   WHERE s.restaurant_id = $1 AND s.created_at < $3 AND COALESCE(s.ended_at, s.last_seen_at) > $2
   GROUP BY 1`;

async function staffRows(restaurantId, from, to, onlyUser = null) {
  const args = [restaurantId, from, to];
  const people = (await db.query(
    `SELECT id, name, role, active, deleted_at IS NOT NULL AS deleted FROM users
      WHERE restaurant_id = $1 AND role IN ('waiter', 'chef', 'cashier', 'manager', 'admin') AND ($2::int IS NULL OR id = $2)`,
    [restaurantId, onlyUser]
  )).rows;
  const taken = (await db.query(
    `SELECT o.waiter_id AS id, count(*)::int AS orders_handled,
            count(*) FILTER (WHERE o.status IN ('delivered', 'paid', 'closed'))::int AS orders_served,
            COALESCE(sum(o.taxable) FILTER (WHERE o.paid_at IS NOT NULL), 0) AS sales_handled
       FROM orders o
      WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3 AND o.status NOT IN ('cancelled', 'merged')
      GROUP BY 1`,
    args
  )).rows;
  const paid = (await db.query(
    `SELECT p.created_by AS id, COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) AS payments_collected
       FROM payments p
      WHERE p.restaurant_id = $1 AND p.created_at >= $2 AND p.created_at < $3 AND p.status = 'successful'
      GROUP BY 1`,
    args
  )).rows;
  const cooked = (await db.query(
    `SELECT i.ready_by AS id, sum(i.qty)::int AS items_prepared, count(DISTINCT i.kot_id)::int AS tickets_completed,
            round(avg(extract(epoch FROM (i.ready_at - i.created_at)) / 60)::numeric, 1) AS avg_prep_minutes
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.restaurant_id = $1 AND i.ready_at >= $2 AND i.ready_at < $3 AND i.ready_by IS NOT NULL AND i.status IN ('ready', 'delivered')
      GROUP BY 1`,
    args
  )).rows;
  const hours = (await db.query(HOURS_SQL, args)).rows;
  const find = (list, id) => list.find((r) => r.id === id) || {};
  return people.map((p) => ({
    ...p,
    orders_handled: 0, orders_served: 0, sales_handled: 0, payments_collected: 0, items_prepared: 0, tickets_completed: 0, avg_prep_minutes: null,
    ...find(taken, p.id), ...find(paid, p.id), ...find(cooked, p.id),
    hours: hours.find((h) => h.user_id === p.id)?.hours ?? null,
  }));
}

// GET /reports/staff — waiters ranked by the sales they handled, chefs by dishes prepared.
// Hours signed in are shown next to each, so a short shift is not read as poor work.
router.get('/staff', async (req, res) => {
  const period = await readPeriod(req);
  const rows = await staffRows(req.user.restaurantId, period.from, period.to);
  const worked = (r) => r.orders_handled > 0 || r.payments_collected > 0 || r.items_prepared > 0;
  const keep = (r) => (r.deleted || !r.active ? worked(r) : true);
  res.json({
    period: head(period),
    waiters: rows.filter((r) => r.role === 'waiter' && keep(r)).sort((a, b) => b.sales_handled - a.sales_handled || b.orders_handled - a.orders_handled || a.name.localeCompare(b.name)),
    chefs: rows.filter((r) => r.role === 'chef' && keep(r)).sort((a, b) => b.items_prepared - a.items_prepared || a.name.localeCompare(b.name)),
    counter: rows.filter((r) => ['cashier', 'manager', 'admin'].includes(r.role) && r.payments_collected !== 0).sort((a, b) => b.payments_collected - a.payments_collected),
  });
});

// GET /reports/staff/:id — one person over the period: numbers, trend, what they did, hours.
router.get('/staff/:id', async (req, res) => {
  const period = await readPeriod(req);
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const [person] = await staffRows(restaurantId, period.from, period.to, id);
  if (!person) throw new AppError(404, 'no_user', 'No such person');
  const args = [restaurantId, period.from, period.to, period.zone, period.offsetMinutes, id];
  const trend = person.role === 'chef'
    ? (await db.query(
        `SELECT ${bucketSql('i.ready_at', period.unit)} AS bucket, sum(i.qty)::int AS value
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.restaurant_id = $1 AND i.ready_at >= $2 AND i.ready_at < $3 AND i.ready_by = $6 AND i.status IN ('ready', 'delivered')
          GROUP BY 1 ORDER BY 1`,
        args
      )).rows
    : (await db.query(
        `SELECT ${bucketSql('o.created_at', period.unit)} AS bucket, count(*)::int AS value
           FROM orders o
          WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.created_at < $3 AND o.waiter_id = $6 AND o.status NOT IN ('cancelled', 'merged')
          GROUP BY 1 ORDER BY 1`,
        args
      )).rows;
  const activity = (await db.query(
    `SELECT l.id, l.action, l.entity, l.entity_id, l.at, l.old, l.new, l.reason, l.refs
       FROM audit_logs l
      WHERE l.restaurant_id = $1 AND l.user_id = $4 AND l.at >= $2 AND l.at < $3
      ORDER BY l.id DESC LIMIT 60`,
    [restaurantId, period.from, period.to, id]
  )).rows;
  const sessions = (await db.query(
    `SELECT id, device, created_at, last_seen_at, ended_at FROM sessions
      WHERE user_id = $1 AND created_at < $3 AND COALESCE(ended_at, last_seen_at) > $2
      ORDER BY created_at DESC LIMIT 30`,
    [id, period.from, period.to]
  )).rows;
  res.json({
    period: head(period),
    person,
    trend_label: person.role === 'chef' ? 'Dishes prepared' : 'Orders taken',
    trend: fill(period, trend, { value: 0 }),
    activity,
    sessions,
  });
});

// GET /reports/daily?from=&to= — the short daily report of version 1, kept for apps not yet updated.
router.get('/daily', async (req, res) => {
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw bad('Choose a day');
  const args = [req.user.restaurantId, from.toISOString(), to.toISOString()];
  const sales = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(o.total), 0) AS total, COALESCE(sum(o.discount_amount), 0) AS discounts FROM orders o WHERE ${PAID}`,
    args
  );
  const byMethod = await db.query(`SELECT o.payment_method AS method, count(*)::int AS orders, sum(o.total) AS total FROM orders o WHERE ${PAID} GROUP BY 1 ORDER BY 3 DESC`, args);
  const byType = await db.query(`SELECT o.type, count(*)::int AS orders, sum(o.total) AS total FROM orders o WHERE ${PAID} GROUP BY 1 ORDER BY 3 DESC`, args);
  const topItems = await db.query(
    `SELECT i.name_snapshot AS name, sum(i.qty)::int AS qty, sum(i.qty * i.unit_price) AS total
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE ${PAID} AND i.status = 'delivered' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
    args
  );
  const open = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0) AS total FROM orders WHERE restaurant_id = $1 AND status NOT IN ('paid', 'closed', 'cancelled', 'merged')`,
    [req.user.restaurantId]
  );
  res.json({ sales: sales.rows[0], byMethod: byMethod.rows, byType: byType.rows, topItems: topItems.rows, open: open.rows[0], log: [] });
});

module.exports = router;
