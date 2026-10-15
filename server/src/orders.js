// Shared order queries and rules. An order always travels with its items, table and area,
// waiter name, payments, and any approval requests still waiting for a manager.
const { computeBill } = require('./bill');
const { settingsOf } = require('./settings');
const { markTables } = require('./tables');

const ORDER_SELECT = `
  SELECT o.*, t.area_id, t.parent_table_id, da.name AS area_name, da.floor_id, fl.name AS floor_name, u.name AS waiter_name,
         -- "T3", or "T3+T4" while T4 is joined to T3 for this party.
         t.label || COALESCE((SELECT string_agg('+' || j.label, '' ORDER BY j.sort, j.id)
                                FROM tables j WHERE j.joined_to_id = t.id AND NOT j.archived), '') AS table_label,
         COALESCE((SELECT json_agg(to_jsonb(i) || jsonb_build_object('kot_number', k.number) ORDER BY i.id)
                     FROM order_items i LEFT JOIN kots k ON k.id = i.kot_id WHERE i.order_id = o.id), '[]') AS items,
         COALESCE((SELECT json_agg(json_build_object('id', p.id, 'kind', p.kind, 'method', p.method, 'amount', p.amount,
                                                     'status', p.status, 'reference', p.reference, 'received', p.received,
                                                     'change_due', p.change_due, 'created_at', p.created_at,
                                                     'created_by', p.created_by, 'by_name', pu.name) ORDER BY p.id)
                     FROM payments p LEFT JOIN users pu ON pu.id = p.created_by WHERE p.order_id = o.id), '[]') AS payments,
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'type', a.type, 'order_item_id', a.order_item_id,
                                                     'payload', a.payload) ORDER BY a.id)
                     FROM approvals a WHERE a.order_id = o.id AND a.status = 'pending'), '[]') AS pending_approvals
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN dining_areas da ON da.id = t.area_id
    LEFT JOIN floors fl ON fl.id = da.floor_id
    JOIN users u ON u.id = o.waiter_id`;

// q is anything with .query(): the pool, or a client inside a transaction.
async function getOrder(q, restaurantId, orderId) {
  const { rows } = await q.query(`${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.id = $2`, [restaurantId, orderId]);
  return rows[0] || null;
}

// Every sensitive action leaves a row here: who did it (and as what), to which record, the
// before and after, the reason given, and the order, table or payment it touched.
function audit(q, { restaurantId, userId, action, entity, entityId, old = null, new: next = null, reason = null, refs = null }) {
  return q.query(
    `INSERT INTO audit_logs (restaurant_id, user_id, actor_role, action, entity, entity_id, old, new, reason, refs)
     VALUES ($1, $2, (SELECT role FROM users WHERE id = $2), $3, $4, $5, $6, $7, $8, $9)`,
    [restaurantId, userId, action, entity, entityId, old && JSON.stringify(old), next && JSON.stringify(next), reason, refs && JSON.stringify(refs)]
  );
}

// Dishes that are not (or no longer) being served. They are never cooked, delivered or charged.
const DEAD = ['unavailable', 'removed', 'cancelled'];
// Orders nothing more can be ordered on or changed: the bill is settled, or the order is over.
const SETTLED = ['paid', 'closed', 'cancelled', 'merged'];
// Orders that no longer hold a table.
const FINISHED = ['closed', 'cancelled', 'merged'];
const SETTLED_SQL = `('paid', 'closed', 'cancelled', 'merged')`;
const FINISHED_SQL = `('closed', 'cancelled', 'merged')`;

// An order's status is never set by hand: it always follows from its items.
function deriveOrderStatus(items) {
  const live = items.filter((i) => !DEAD.includes(i.status));
  if (live.length === 0) return items.some((i) => i.status === 'unavailable') ? 'new' : 'cancelled';
  const has = (...statuses) => live.some((i) => statuses.includes(i.status));
  const all = (...statuses) => live.every((i) => statuses.includes(i.status));
  if (has('sent')) return 'new'; // something still waits for the chef to accept or deny
  if (all('delivered')) return 'delivered';
  if (all('ready', 'delivered')) return 'ready';
  if (has('ready', 'delivered')) return 'partly_ready';
  if (has('preparing')) return 'preparing';
  return 'accepted';
}

// What the table card shows for each order status.
const TABLE_STATUS = {
  new: 'order_placed',
  accepted: 'order_placed',
  preparing: 'preparing',
  partly_ready: 'ready',
  ready: 'ready',
  delivered: 'all_delivered',
};

async function restaurantSettings(q, restaurantId) {
  const { rows } = await q.query('SELECT settings FROM restaurants WHERE id = $1', [restaurantId]);
  return settingsOf(rows[0]?.settings);
}

// The bill for an order as it stands, from its live lines and the restaurant's settings.
function billFor(order, settings) {
  const live = order.items.filter((i) => !DEAD.includes(i.status));
  return computeBill(live, {
    discountType: order.discount_type,
    discountValue: order.discount_value,
    // A service charge is for guests served at a table.
    serviceChargePct: order.type === 'dine_in' ? settings.service_charge_pct : 0,
    serviceTaxRate: settings.tax.rate,
    taxSplit: settings.tax.split,
    roundOff: settings.round_off,
    splitAdjust: order.split_adjust,
  });
}

// Gives a table back when its party has left. Tables that were joined to it are given back
// with it. A split part (T4.1) stays as a free part while another part of the same table is
// still in use; when every part is free, the parts are put away and the whole table (T4) is one
// free table again. Returns the ids of every table that changed.
async function releaseTable(q, tableId) {
  const { rows } = await q.query(
    `UPDATE tables SET status = 'free', locked_by = NULL, locked_at = NULL WHERE id = $1 RETURNING parent_table_id, restaurant_id`,
    [tableId]
  );
  const joined = await q.query(
    `UPDATE tables SET joined_to_id = NULL, status = 'free', locked_by = NULL, locked_at = NULL WHERE joined_to_id = $1 RETURNING id`,
    [tableId]
  );
  const touched = [tableId, ...joined.rows.map((r) => r.id)];
  const parentId = rows[0]?.parent_table_id;
  if (parentId) touched.push(...(await settleSplit(q, parentId)));
  if (rows[0]) markTables(rows[0].restaurant_id, touched);
  return touched;
}

// A split table none of whose parts is in use goes back to being one table.
async function settleSplit(q, parentId) {
  const parts = await q.query('SELECT id, status, locked_by FROM tables WHERE parent_table_id = $1 AND NOT archived', [parentId]);
  if (parts.rows.some((p) => p.status !== 'free' || p.locked_by)) return [];
  await q.query('UPDATE tables SET archived = true WHERE parent_table_id = $1 AND NOT archived', [parentId]);
  await q.query(`UPDATE tables SET status = 'free', locked_by = NULL, locked_at = NULL WHERE id = $1 AND status = 'split'`, [parentId]);
  return [...parts.rows.map((p) => p.id), parentId];
}

// Call after changing an order's items or discount. It recalculates the money, brings the order's
// status (and its table's) up to date, and returns the fresh order.
async function refreshOrder(q, restaurantId, orderId) {
  let order = await getOrder(q, restaurantId, orderId);
  if (!order || SETTLED.includes(order.status)) return order;

  const bill = billFor(order, await restaurantSettings(q, restaurantId));
  const pct = order.discount_type === 'pct' ? order.discount_value : bill.subtotal > 0 ? Math.round((bill.discount_amount / bill.subtotal) * 10000) / 100 : 0;
  await q.query(
    `UPDATE orders
        SET subtotal = $2, discount_amount = $3, discount_pct = $4, taxable = $5, tax_total = $6, tax_lines = $7,
            service_charge = $8, round_off = $9, total = $10
      WHERE id = $1`,
    [orderId, bill.subtotal, bill.discount_amount, pct, bill.taxable, bill.tax_total, JSON.stringify(bill.tax_lines), bill.service_charge, bill.round_off, bill.total]
  );
  Object.assign(order, bill, { discount_pct: pct });

  const status = deriveOrderStatus(order.items);
  if (status === 'cancelled') {
    // Every dish was removed or cancelled: the order is over and its table is free again.
    await q.query(`UPDATE orders SET status = 'cancelled', closed_at = now(), at_counter = false, bill_requested_at = NULL WHERE id = $1`, [orderId]);
    await q.query(`UPDATE approvals SET status = 'rejected', decided_at = now() WHERE order_id = $1 AND status = 'pending'`, [orderId]);
    if (order.table_id) await releaseTable(q, order.table_id);
    return getOrder(q, restaurantId, orderId);
  }
  if (status !== order.status) {
    await q.query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
    order.status = status;
  }
  if (order.table_id && TABLE_STATUS[status]) {
    // A table waiting for payment stays that way unless something new was ordered.
    await q.query(
      `UPDATE tables SET status = $1
        WHERE id = $2 AND status <> $1 AND NOT (status = 'needs_payment' AND $1 = 'all_delivered')`,
      [TABLE_STATUS[status], order.table_id]
    );
  }
  return order;
}

// True when nothing is left for the kitchen or the waiter to do: every dish is delivered or dead.
const allSettled = (order) => order.items.every((i) => i.status === 'delivered' || DEAD.includes(i.status));

// What is still to pay on an order.
const amountDue = (order) => Math.max(0, Math.round((order.total - order.paid_total) * 100) / 100);

module.exports = {
  ORDER_SELECT, getOrder, audit, deriveOrderStatus, refreshOrder, allSettled, amountDue, billFor, restaurantSettings, releaseTable, settleSplit,
  TABLE_STATUS,
  DEAD, SETTLED, FINISHED, SETTLED_SQL, FINISHED_SQL,
};
