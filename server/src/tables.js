// Shared table query. A table travels with the name of the waiter holding it and,
// if it has an open order, that order's id, number and start time (for the timer on the card).
const TABLE_SELECT = `
  SELECT t.*, u.name AS locked_by_name,
         ao.id AS order_id, ao.number AS order_number, ao.created_at AS order_created_at
    FROM tables t
    LEFT JOIN users u ON u.id = t.locked_by
    LEFT JOIN LATERAL (
      SELECT o.id, o.number, o.created_at
        FROM orders o
       WHERE o.table_id = t.id AND o.status NOT IN ('closed', 'cancelled')
       ORDER BY o.id DESC
       LIMIT 1
    ) ao ON true`;

// q is anything with .query(): the pool, or a client inside a transaction.
async function getTable(q, restaurantId, tableId) {
  const { rows } = await q.query(`${TABLE_SELECT} WHERE t.restaurant_id = $1 AND t.id = $2`, [restaurantId, tableId]);
  return rows[0] || null;
}

module.exports = { TABLE_SELECT, getTable };
