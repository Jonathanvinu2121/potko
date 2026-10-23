// Shared table query. A table travels with its floor and dining area, the name of the waiter
// holding it, the tables joined to it for one party (T3 + T4) and, if it has an order that is not
// finished, that order's number, start time and amount (for the timer and the amount on the card).
// An order whose table was closed by its waiter (handed over to the counter) no longer holds it.
const TABLE_SELECT = `
  SELECT t.*, u.name AS locked_by_name, da.name AS area_name, da.floor_id, fl.name AS floor_name,
         pt.label AS parent_label, pt.seats AS parent_seats, jt.label AS joined_to_label,
         COALESCE((SELECT json_agg(json_build_object('id', j.id, 'label', j.label, 'seats', j.seats) ORDER BY j.sort, j.id)
                     FROM tables j WHERE j.joined_to_id = t.id AND NOT j.archived), '[]') AS joined,
         ao.id AS order_id, ao.number AS order_number, ao.created_at AS order_created_at,
         ao.guests AS order_guests, ao.total AS order_total, ao.status AS order_status,
         ao.waiter_id AS order_waiter_id, ao.waiter_name AS order_waiter_name,
         ao.bill_requested_at AS order_bill_requested_at, ao.item_count AS order_item_count
    FROM tables t
    JOIN dining_areas da ON da.id = t.area_id
    LEFT JOIN floors fl ON fl.id = da.floor_id
    LEFT JOIN tables pt ON pt.id = t.parent_table_id
    LEFT JOIN tables jt ON jt.id = t.joined_to_id
    LEFT JOIN users u ON u.id = t.locked_by
    LEFT JOIN LATERAL (
      SELECT o.id, o.number, o.created_at, o.guests, o.total, o.status, o.waiter_id, o.bill_requested_at,
             w.name AS waiter_name,
             (SELECT COALESCE(sum(i.qty), 0)::int FROM order_items i
               WHERE i.order_id = o.id AND i.status NOT IN ('unavailable', 'removed', 'cancelled')) AS item_count
        FROM orders o JOIN users w ON w.id = o.waiter_id
       WHERE o.table_id = t.id AND o.status NOT IN ('closed', 'cancelled', 'merged') AND o.handed_over_at IS NULL
       ORDER BY o.id DESC
       LIMIT 1
    ) ao ON true`;

// The tables a service screen shows, in floor order. Children of a split table that were put
// away are left out; the app hides the parent while it is split.
const TABLE_ORDER = 'ORDER BY fl.sort, fl.id, da.sort, da.id, COALESCE(pt.sort, t.sort), COALESCE(pt.id, t.id), t.label';

// q is anything with .query(): the pool, or a client inside a transaction.
async function getTable(q, restaurantId, tableId) {
  const { rows } = await q.query(`${TABLE_SELECT} WHERE t.restaurant_id = $1 AND t.id = $2`, [restaurantId, tableId]);
  return rows[0] || null;
}

async function listTables(q, restaurantId) {
  const { rows } = await q.query(`${TABLE_SELECT} WHERE t.restaurant_id = $1 AND NOT t.archived ${TABLE_ORDER}`, [restaurantId]);
  return rows;
}

// May this waiter work this table? `access` comes from their staff record:
//   {}                                              every area and table
//   { areas: { "3": { mode: "all" } } }             all of area 3, nothing else
//   { areas: { "3": { mode: "tables", tables: [9, 10] } } }
// A split child (T4.1) follows its parent table (T4).
function tableAllowed(access, table) {
  const areas = access?.areas;
  if (!areas || Object.keys(areas).length === 0) return true;
  const rule = areas[String(table.area_id)];
  if (!rule) return false;
  if (rule.mode !== 'tables') return true;
  const ids = Array.isArray(rule.tables) ? rule.tables : [];
  return ids.includes(table.id) || (table.parent_table_id != null && ids.includes(table.parent_table_id));
}

// Tables changed deep inside a transaction (the parts and joined tables a release gives back).
// Whoever announces table changes next for that restaurant announces these as well.
const marked = new Map(); // restaurant id -> Set of table ids
function markTables(restaurantId, ids) {
  if (!marked.has(restaurantId)) marked.set(restaurantId, new Set());
  for (const id of ids) if (id) marked.get(restaurantId).add(id);
}
function takeMarked(restaurantId) {
  const ids = [...(marked.get(restaurantId) || [])];
  marked.delete(restaurantId);
  return ids;
}

module.exports = { TABLE_SELECT, TABLE_ORDER, getTable, listTables, tableAllowed, markTables, takeMarked };
