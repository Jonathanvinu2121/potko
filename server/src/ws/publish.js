// Tells every screen that should know about a change to an order.
const db = require('../db');
const { getTable } = require('../tables');
const ws = require('./events');

// How many items this waiter has ready to deliver, across all their open orders.
async function readyCount(restaurantId, waiterId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS count
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.restaurant_id = $1 AND o.waiter_id = $2 AND i.status = 'ready'
        AND o.status NOT IN ('closed', 'cancelled')`,
    [restaurantId, waiterId]
  );
  return rows[0].count;
}

// The kitchen and managers get the order, and so does the waiter who owns it (other waiters do not).
// Everyone gets the table, because the Tables screen is shared. The waiter's Ready badge is recounted.
async function publishOrder(order, { created = false } = {}) {
  const restaurantId = order.restaurant_id;
  const type = created ? 'order.created' : 'order.updated';
  ws.toRoles(restaurantId, ['chef', 'manager', 'admin'], type, order);
  ws.toUser(restaurantId, order.waiter_id, type, order);
  if (order.table_id) ws.toRestaurant(restaurantId, 'table.updated', await getTable(db, restaurantId, order.table_id));
  ws.toUser(restaurantId, order.waiter_id, 'ready.count', { count: await readyCount(restaurantId, order.waiter_id) });
}

module.exports = { publishOrder, readyCount };
