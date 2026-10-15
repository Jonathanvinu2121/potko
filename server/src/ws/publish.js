// Tells every screen that should know about a change to an order or a table.
const db = require('../db');
const { getTable, takeMarked } = require('../tables');
const { can } = require('../permissions');
const ws = require('./events');
const { orderFor } = require('../scope');

// How many items this waiter has ready to deliver, across all their open orders.
async function readyCount(restaurantId, waiterId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS count
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.restaurant_id = $1 AND o.waiter_id = $2 AND i.status = 'ready'
        AND o.status NOT IN ('paid', 'closed', 'cancelled', 'merged')`,
    [restaurantId, waiterId]
  );
  return rows[0].count;
}

// Everyone gets a table, because the floor is shared. A table that was put away (a split child
// after its bill closed) is announced as removed.
async function publishTables(restaurantId, tableIds) {
  for (const id of [...new Set([...tableIds, ...takeMarked(restaurantId)])].filter(Boolean)) {
    const table = await getTable(db, restaurantId, id);
    if (!table) continue;
    if (table.archived) ws.toRestaurant(restaurantId, 'table.removed', { id: table.id });
    else ws.tableToRestaurant(restaurantId, table);
  }
}

// The kitchen and everyone who may see all orders get the order, and so does the waiter who owns
// it (other waiters do not). The waiter's Ready badge is recounted.
async function publishOrder(order, { created = false, tables = [] } = {}) {
  const restaurantId = order.restaurant_id;
  const type = created ? 'order.created' : 'order.updated';
  ws.toEach(restaurantId, type, order, (u, o) => (u.role === 'chef' || can(u, 'orders.view') || u.id === o.waiter_id ? orderFor(u, o) : null));
  await publishTables(restaurantId, [order.table_id, ...tables]);
  ws.toUser(restaurantId, order.waiter_id, 'ready.count', { count: await readyCount(restaurantId, order.waiter_id) });
}

module.exports = { publishOrder, publishTables, readyCount };
