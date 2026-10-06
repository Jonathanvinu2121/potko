// Shared order queries and rules. An order always travels with its items, table label,
// waiter name and any approval requests still waiting for a manager.
const ORDER_SELECT = `
  SELECT o.*, t.label AS table_label, u.name AS waiter_name,
         COALESCE((SELECT json_agg(i ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id), '[]') AS items,
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'type', a.type, 'order_item_id', a.order_item_id,
                                                     'payload', a.payload) ORDER BY a.id)
                     FROM approvals a WHERE a.order_id = o.id AND a.status = 'pending'), '[]') AS pending_approvals
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    JOIN users u ON u.id = o.waiter_id`;

// q is anything with .query(): the pool, or a client inside a transaction.
async function getOrder(q, restaurantId, orderId) {
  const { rows } = await q.query(`${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.id = $2`, [restaurantId, orderId]);
  return rows[0] || null;
}

// Every sensitive action leaves a row here: who did what to which record, and the before/after.
function audit(q, { restaurantId, userId, action, entity, entityId, old = null, new: next = null }) {
  return q.query(
    `INSERT INTO audit_logs (restaurant_id, user_id, action, entity, entity_id, old, new)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [restaurantId, userId, action, entity, entityId, old && JSON.stringify(old), next && JSON.stringify(next)]
  );
}

// Dishes that are not (or no longer) being served. They are never cooked, delivered or charged.
const DEAD = ['unavailable', 'removed', 'cancelled'];

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

// Call after changing an order's items or discount. It recalculates the money, brings the order's
// status (and its table's) up to date, and returns the fresh order.
async function refreshOrder(q, restaurantId, orderId) {
  await q.query(
    `UPDATE orders o
        SET subtotal = s.subtotal,
            discount_amount = round(s.subtotal * o.discount_pct / 100, 2),
            total = s.subtotal - round(s.subtotal * o.discount_pct / 100, 2)
       FROM (SELECT COALESCE(sum(qty * unit_price), 0) AS subtotal
               FROM order_items
              WHERE order_id = $1 AND status NOT IN ('unavailable', 'removed', 'cancelled')) s
      WHERE o.id = $1`,
    [orderId]
  );
  const order = await getOrder(q, restaurantId, orderId);
  if (!order || order.status === 'closed' || order.status === 'cancelled') return order;

  const status = deriveOrderStatus(order.items);
  if (status === 'cancelled') {
    // Every dish was removed or cancelled: the order is over and its table is free again.
    await q.query(`UPDATE orders SET status = 'cancelled', closed_at = now(), at_counter = false WHERE id = $1`, [orderId]);
    await q.query(`UPDATE approvals SET status = 'rejected', decided_at = now() WHERE order_id = $1 AND status = 'pending'`, [
      orderId,
    ]);
    if (order.table_id) {
      await q.query(`UPDATE tables SET status = 'free', locked_by = NULL, locked_at = NULL WHERE id = $1`, [order.table_id]);
    }
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

module.exports = { ORDER_SELECT, getOrder, audit, deriveOrderStatus, refreshOrder, allSettled, DEAD };
