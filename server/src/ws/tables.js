// Table locking: one waiter per table. Tables joined for one party are taken and given back together.
const db = require('../db');
const { AppError } = require('../errors');
const { getTable, tableAllowed } = require('../tables');
const ws = require('./events');

const LOCK_MINUTES = 5; // a lock with no order sent is released after this long without activity
const SWEEP_MS = 30 * 1000;

// True while some table may be locked without an order. Lets the sweep skip the database
// (and let a free Neon database sleep) when there is nothing to release.
let locksPending = true;

// Joined tables take the state of the table they follow, and are told to every screen.
async function followLead(restaurantId, leadId, inUse, userId) {
  const { rows } = await db.query(
    inUse
      ? `UPDATE tables SET status = 'occupied', locked_by = $2, locked_at = now() WHERE joined_to_id = $1 RETURNING id`
      : `UPDATE tables SET joined_to_id = NULL, status = 'free', locked_by = NULL, locked_at = NULL WHERE joined_to_id = $1 AND $2::int IS NULL RETURNING id`,
    [leadId, inUse ? userId : null]
  );
  for (const row of rows) ws.tableToRestaurant(restaurantId, await getTable(db, restaurantId, row.id));
}

// table.lock { tableId } — take a free table, or refresh the lock on a table already mine.
// One atomic UPDATE: if two waiters tap the same table, exactly one of them gets a row back.
// Tapping a table that is joined to another takes the whole group, through its lead table.
ws.on('table.lock', async (user, payload) => {
  ws.need(user, 'waiter');
  const asked = await getTable(db, user.restaurantId, payload.tableId);
  const tableId = asked?.joined_to_id || payload.tableId;
  const before = asked?.joined_to_id ? await getTable(db, user.restaurantId, tableId) : asked;
  if (!before || before.archived) throw new AppError(404, 'no_table', 'No such table');
  if (!before.active) throw new AppError(409, 'table_off', 'This table is switched off');
  if (before.status === 'split') throw new AppError(409, 'table_split', 'This table is split. Use its parts.');
  if (!tableAllowed(user.access, before)) throw new AppError(403, 'table_not_assigned', 'This table is not assigned to you');

  const { rows } = await db.query(
    `UPDATE tables
        SET locked_by = $1, locked_at = now(),
            status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END
      WHERE id = $2 AND restaurant_id = $3 AND (locked_by IS NULL OR locked_by = $1)
      RETURNING id`,
    [user.id, tableId, user.restaurantId]
  );
  const table = await getTable(db, user.restaurantId, tableId);
  if (!rows[0]) throw new AppError(409, 'taken', `Taken by ${table.locked_by_name}`);

  locksPending = true;
  ws.tableToRestaurant(user.restaurantId, table);
  if (table.joined.length > 0) await followLead(user.restaurantId, table.id, true, user.id);
  return table;
});

// table.release { tableId } — give back a table I locked but never sent an order for.
// A table with an order stays mine until it is closed, so this quietly does nothing for those.
// Tables that were joined to it for this party are separated again.
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
  if (rows[0]) {
    ws.tableToRestaurant(user.restaurantId, table);
    await followLead(user.restaurantId, tableId, false);
  }
  return table;
});

// Releases locks that never became an order. Runs for every restaurant at once.
async function sweepStaleLocks() {
  if (!locksPending) return;
  const released = await db.query(
    `UPDATE tables
        SET locked_by = NULL, locked_at = NULL, status = 'free'
      WHERE status = 'occupied' AND joined_to_id IS NULL AND locked_at < now() - interval '${LOCK_MINUTES} minutes'
      RETURNING id, restaurant_id`
  );
  for (const row of released.rows) {
    ws.tableToRestaurant(row.restaurant_id, await getTable(db, row.restaurant_id, row.id));
    await followLead(row.restaurant_id, row.id, false);
  }
  const left = await db.query("SELECT 1 FROM tables WHERE status = 'occupied' AND joined_to_id IS NULL LIMIT 1");
  locksPending = left.rows.length > 0;
}

setInterval(() => sweepStaleLocks().catch((err) => console.error('Lock sweep failed:', err.message)), SWEEP_MS).unref();

module.exports = { sweepStaleLocks };
