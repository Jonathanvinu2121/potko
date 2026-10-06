// Table locking: one waiter per table.
const db = require('../db');
const { AppError } = require('../errors');
const { getTable } = require('../tables');
const ws = require('./events');

const LOCK_MINUTES = 5; // a lock with no order sent is released after this long without activity
const SWEEP_MS = 30 * 1000;

// True while some table may be locked without an order. Lets the sweep skip the database
// (and let a free Neon database sleep) when there is nothing to release.
let locksPending = true;

// table.lock { tableId } — take a free table, or refresh the lock on a table already mine.
// One atomic UPDATE: if two waiters tap the same table, exactly one of them gets a row back.
ws.on('table.lock', async (user, { tableId }) => {
  ws.need(user, 'waiter');
  const { rows } = await db.query(
    `UPDATE tables
        SET locked_by = $1, locked_at = now(),
            status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END
      WHERE id = $2 AND restaurant_id = $3 AND (locked_by IS NULL OR locked_by = $1)
      RETURNING id`,
    [user.id, tableId, user.restaurantId]
  );
  const table = await getTable(db, user.restaurantId, tableId);
  if (!table) throw new AppError(404, 'no_table', 'No such table');
  if (!rows[0]) throw new AppError(409, 'taken', `Taken by ${table.locked_by_name}`);

  locksPending = true;
  ws.toRestaurant(user.restaurantId, 'table.updated', table);
  return table;
});

// table.release { tableId } — give back a table I locked but never sent an order for.
// A table with an order stays mine until it is closed, so this quietly does nothing for those.
ws.on('table.release', async (user, { tableId }) => {
  ws.need(user, 'waiter');
  const { rows } = await db.query(
    `UPDATE tables
        SET locked_by = NULL, locked_at = NULL, status = 'free'
      WHERE id = $1 AND restaurant_id = $2 AND locked_by = $3 AND status = 'occupied'
      RETURNING id`,
    [tableId, user.restaurantId, user.id]
  );
  const table = await getTable(db, user.restaurantId, tableId);
  if (rows[0]) ws.toRestaurant(user.restaurantId, 'table.updated', table);
  return table;
});

// Releases locks that never became an order. Runs for every restaurant at once.
async function sweepStaleLocks() {
  if (!locksPending) return;
  const released = await db.query(
    `UPDATE tables
        SET locked_by = NULL, locked_at = NULL, status = 'free'
      WHERE status = 'occupied' AND locked_at < now() - interval '${LOCK_MINUTES} minutes'
      RETURNING id, restaurant_id`
  );
  for (const row of released.rows) {
    ws.toRestaurant(row.restaurant_id, 'table.updated', await getTable(db, row.restaurant_id, row.id));
  }
  const left = await db.query("SELECT 1 FROM tables WHERE status = 'occupied' LIMIT 1");
  locksPending = left.rows.length > 0;
}

setInterval(() => sweepStaleLocks().catch((err) => console.error('Lock sweep failed:', err.message)), SWEEP_MS).unref();

module.exports = { sweepStaleLocks };
