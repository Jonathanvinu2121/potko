// Floor operations: split a table into parts by seats, merge parts back, join whole tables for
// one party, separate them again, and move a party to another table. Each is one transaction.
// Dishes already sent to the kitchen are moved, never copied, so the kitchen never cooks anything
// twice and each dish keeps its status and its KOT. Every operation leaves an audit record with
// the tables and orders involved.
const db = require('../db');
const { AppError } = require('../errors');
const { getOrder, refreshOrder, audit, releaseTable, DEAD, SETTLED, FINISHED_SQL } = require('../orders');
const { share, paise, rupees } = require('../bill');
const { getTable, tableAllowed } = require('../tables');
const { can } = require('../permissions');
const ws = require('./events');
const { publishOrder, publishTables } = require('./publish');

const fail = (code, message, status = 400) => new AppError(status, code, message);
const MAX_PARTS = 12;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// A guest count given with a part (1 to 99), or null.
const guestsOf = (part) => {
  const n = Number(part?.guests);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
};

// Thrown at the end of a "preview" run so the transaction rolls back and nothing is saved.
class Preview extends Error {
  constructor(result) {
    super('preview');
    this.result = result;
  }
}

// Runs fn in a transaction. With preview = true everything fn did is undone and only its result is kept.
async function run(preview, fn) {
  try {
    return await db.tx(async (client) => {
      const result = await fn(client);
      if (preview) throw new Preview(result);
      return result;
    });
  } catch (err) {
    if (err instanceof Preview) return err.result;
    throw err;
  }
}

function mayManage(user, order) {
  if (order.waiter_id !== user.id && !can(user, 'orders.manage')) throw fail('not_your_order', 'This table belongs to another waiter', 403);
}

// The office may work any table; a waiter only the tables they are assigned.
function mayUseTable(user, table) {
  if (can(user, 'orders.manage')) return;
  if (user.role !== 'waiter') throw fail('forbidden', 'You do not have permission to do this', 403);
  if (!tableAllowed(user.access, table)) throw fail('table_not_assigned', `${table.label} is not assigned to you`, 403);
}

// A table someone else is in the middle of seating cannot be taken from under them.
function notTaken(user, table) {
  if (table.locked_by && table.locked_by !== user.id && !can(user, 'orders.manage')) throw fail('taken', `${table.label} is taken by another waiter`, 409);
}

// The order a table holds right now (being served, or paid with the guests still seated), locked.
// An order whose table its waiter closed (handed over to the counter) holds no table.
async function openOrderOn(client, user, tableId) {
  const open = await client.query(
    `SELECT id FROM orders WHERE table_id = $1 AND status NOT IN ${FINISHED_SQL} AND handed_over_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [tableId]
  );
  return open.rows[0] ? getOrder(client, user.restaurantId, open.rows[0].id) : null;
}

// What the app shows for one bill before and after a split or merge.
// Dish prices are taken out of an answer for someone who may not see them; bill totals stay for a
// waiter who takes payment, and go too for one who does not (bills.view off).
const BILL_KEYS = ['total', 'subtotal', 'taxable', 'tax_total', 'tax_lines', 'service_charge', 'round_off', 'discount_amount', 'paid_total', 'due'];
const forUser = (user, value) => {
  if (can(user, 'prices.view') && can(user, 'bills.view')) return value;
  const hide = new Set(['amount', 'unit_price', ...(can(user, 'bills.view') ? [] : BILL_KEYS)]);
  return JSON.parse(JSON.stringify(value, (key, v) => (hide.has(key) ? undefined : v)));
};

const summary = (order) => ({
  order_id: order.id,
  order_number: order.number,
  table_id: order.table_id,
  table_label: order.table_label,
  items: order.items
    .filter((i) => !DEAD.includes(i.status))
    .map((i) => ({ id: i.id, name: i.name_snapshot, size: i.size, qty: i.qty, amount: Math.round(i.qty * i.unit_price * 100) / 100, status: i.status, kot_number: i.kot_number })),
  subtotal: order.subtotal,
  discount_amount: order.discount_amount,
  taxable: order.taxable,
  tax_total: order.tax_total,
  tax_lines: order.tax_lines,
  service_charge: order.service_charge,
  round_off: order.round_off,
  total: order.total,
});

// ---------- Split ----------

// table.split { tableId, parts: [{ id?, seats, guests?, items?: [{ itemId, qty }] }], preview? }
//
// Divides a table by seats into as many parts as wanted: T4 with 6 seats becomes T4.1 (4 seats)
// and T4.2 (2 seats). The seats of the parts always add up to the table's seats.
//   First split   the party already at the table (if any) stays together on the first part,
//                 which keeps exactly their seats; only the free seats make further parts. So
//                 4 seats with 2 guests becomes 2 + 2 or 2 + 1 + 1, never four parts. (guests on
//                 the first part is only read when the order has no guest count yet.)
//                 Moving dishes to another part is splitting the bill, not the seating: that part
//                 gets a bill of its own (the same guests, paying separately), and the guests of
//                 each part are the ones given.
//   Split again   on a table that is already split, the parts are re-cut: a part that is listed
//                 with its id keeps its party and may change size, but never to fewer seats than
//                 its guests; a part with no id is new and free; a free part left out is removed.
ws.on('table.split', async (user, payload) => {
  const wanted = Array.isArray(payload.parts) ? payload.parts : [];

  const result = await run(payload.preview === true, async (client) => {
    // The table itself, or the table a part belongs to.
    const asked = (await client.query('SELECT id, parent_table_id FROM tables WHERE id = $1 AND restaurant_id = $2', [payload.tableId, user.restaurantId])).rows[0];
    if (!asked) throw fail('no_table', 'No such table', 404);
    const parent = (await client.query('SELECT * FROM tables WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [asked.parent_table_id || asked.id, user.restaurantId])).rows[0];
    if (!parent || parent.archived || !parent.active) throw fail('no_table', 'No such table', 404);
    mayUseTable(user, parent);
    const joined = await client.query('SELECT 1 FROM tables WHERE joined_to_id = $1 AND NOT archived LIMIT 1', [parent.id]);
    if (parent.joined_to_id || joined.rows[0]) throw fail('joined', `${parent.label} is joined with another table. Separate the tables before splitting.`, 409);

    if (parent.seats < 2) throw fail('too_small', `${parent.label} has one seat and cannot be split`, 409);
    const most = Math.min(parent.seats, MAX_PARTS);
    if (wanted.length < 2 || wanted.length > most) throw fail('bad_parts', `Split ${parent.label} into 2 to ${most} parts`);
    const seats = wanted.map((p) => Number(p.seats));
    if (seats.some((n) => !Number.isInteger(n) || n < 1)) throw fail('bad_seats', 'Give every part at least one seat');
    const total = seats.reduce((a, b) => a + b, 0);
    if (total !== parent.seats) throw fail('seats_mismatch', `${parent.label} has ${parent.seats} seats; the parts add up to ${total}`, 409);
    return parent.status === 'split' ? splitAgain(client, user, parent, wanted, seats) : splitFirst(client, user, parent, wanted, seats);
  });

  if (payload.preview !== true) {
    for (const order of result.orders) await publishOrder(order, { created: result.created.includes(order.id) });
    await publishTables(user.restaurantId, result.tableIds);
  }
  return forUser(user, { parent: result.parent, before: result.before, parts: result.parts });
});

async function newPart(client, parent, number, seats, { status = 'free', lockedBy = null, lockedAt = null } = {}) {
  const label = `${parent.label}.${number}`;
  const clash = await client.query('SELECT 1 FROM tables WHERE restaurant_id = $1 AND lower(label) = lower($2) AND NOT archived', [parent.restaurant_id, label]);
  if (clash.rows[0]) throw fail('label_taken', `There is already a table named ${label}. Rename it before splitting ${parent.label}.`, 409);
  const made = await client.query(
    `INSERT INTO tables (restaurant_id, label, seats, area_id, kind, shape, size, sort, parent_table_id, status, locked_by, locked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, label, seats`,
    [parent.restaurant_id, label, seats, parent.area_id, parent.kind, parent.shape, parent.size, parent.sort, parent.id, status, lockedBy, lockedAt]
  );
  return made.rows[0];
}

async function splitFirst(client, user, parent, wanted, seats) {
  const original = await openOrderOn(client, user, parent.id);
  if (original) mayManage(user, original);
  else notTaken(user, parent);
  const live = original ? original.items.filter((i) => !DEAD.includes(i.status)) : [];

  // Dishes moved to another part: never more than was ordered. What is not moved stays on the first part.
  const taken = new Map(); // item id -> quantity given out so far
  const allocation = wanted.map((p, n) => {
    const mine = new Map();
    if (n === 0) return mine;
    for (const a of Array.isArray(p.items) ? p.items : []) {
      const item = live.find((i) => i.id === Number(a.itemId));
      const qty = Number(a.qty);
      if (!item) throw fail('bad_item', 'A dish in this split is not on the order');
      if (!Number.isInteger(qty) || qty < 0) throw fail('bad_qty', `Check the quantity of ${item.name_snapshot}`);
      if (qty === 0) continue;
      mine.set(item.id, (mine.get(item.id) || 0) + qty);
      taken.set(item.id, (taken.get(item.id) || 0) + qty);
      if (taken.get(item.id) > item.qty) throw fail('over_allocated', `Only ${item.qty}× ${item.name_snapshot} was ordered`, 409);
    }
    return mine;
  });
  const moving = allocation.some((a) => a.size > 0);
  if (!moving && original) {
    // Splitting the seating: the party stays together on the first part with exactly its seats,
    // and only the free seats make further parts. An order without a guest count takes the one
    // given for the first part (the app asks), else counts as one guest.
    const party = original.guests > 0 ? original.guests : guestsOf(wanted[0]) ?? 1;
    const free = parent.seats - party;
    if (free < 1) throw fail('no_free_seats', `The ${plural(party, 'guest')} at ${parent.label} fill all ${plural(parent.seats, 'seat')}, so there are no free seats to split off`, 409);
    const most = Math.min(1 + free, MAX_PARTS);
    if (wanted.length > most) throw fail('bad_parts', `Split ${parent.label} into ${most === 2 ? '2' : `2 to ${most}`} tables: its ${plural(party, 'guest')} stay together on ${parent.label}.1 and the ${plural(free, 'free seat')} make the rest`);
    if (seats[0] !== party) throw fail('party_seats', `The ${plural(party, 'guest')} at ${parent.label} stay together: ${parent.label}.1 keeps their ${plural(party, 'seat')}`, 409);
    if (!(original.guests > 0)) await client.query('UPDATE orders SET guests = $1 WHERE id = $2', [party, original.id]);
  } else if (moving && guestsOf(wanted[0])) {
    // Splitting the bill: the people at the party's own part are the ones given.
    await client.query('UPDATE orders SET guests = $1 WHERE id = $2', [guestsOf(wanted[0]), original.id]);
  }
  if (moving) {
    // Moving dishes makes a second bill, so the first one must still be open and untouched by money.
    if (SETTLED.includes(original.status)) throw fail('paid', 'This bill is already paid, so its dishes cannot be moved', 409);
    if (original.paid_total > 0) throw fail('part_paid', 'A payment was already taken on this bill, so its dishes cannot be moved', 409);
    if (original.pending_approvals.length > 0) throw fail('approval_pending', 'A manager approval is still pending on this order', 409);
    if (!live.some((item) => item.qty - (taken.get(item.id) || 0) > 0)) throw fail('empty_part', `Leave at least one dish on ${parent.label}.1`, 409);
  }

  // The parts: T4.1, T4.2, ... The first takes over whatever the table was doing.
  const children = [];
  for (let n = 0; n < wanted.length; n += 1) {
    const state =
      n === 0
        ? { status: parent.status, lockedBy: parent.locked_by, lockedAt: parent.locked_at }
        : allocation[n].size > 0
          ? { status: 'occupied', lockedBy: original.waiter_id, lockedAt: new Date() }
          : {};
    children.push(await newPart(client, parent, n + 1, seats[n], state));
  }
  await client.query(`UPDATE tables SET status = 'split', locked_by = NULL, locked_at = NULL WHERE id = $1`, [parent.id]);

  const orderIds = [];
  const created = [];
  if (original) {
    await client.query('UPDATE orders SET table_id = $1 WHERE id = $2', [children[0].id, original.id]);
    orderIds.push(original.id);
  }
  const leftOnLine = new Map(); // item id -> quantity still on the original line
  for (let n = 1; n < wanted.length; n += 1) {
    if (allocation[n].size === 0) continue;
    const numbered = await client.query(
      'UPDATE restaurants SET next_order_number = next_order_number + 1 WHERE id = $1 RETURNING next_order_number - 1 AS number',
      [user.restaurantId]
    );
    const made = await client.query(
      `INSERT INTO orders (restaurant_id, number, type, table_id, guests, waiter_id, parent_order_id, prep_minutes,
                           discount_type, discount_value, discount_reason, discount_by, bill_requested_at, bill_requested_by, at_counter, created_at)
       VALUES ($1, $2, 'dine_in', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        user.restaurantId, numbered.rows[0].number, children[n].id, seats[n], original.waiter_id, original.id, original.prep_minutes,
        original.discount_type, original.discount_type === 'pct' ? original.discount_value : 0, original.discount_reason, original.discount_by,
        original.bill_requested_at, original.bill_requested_by, original.at_counter, original.created_at,
      ]
    );
    orderIds.push(made.rows[0].id);
    created.push(made.rows[0].id);

    for (const [itemId, qty] of allocation[n]) {
      const item = live.find((i) => i.id === itemId);
      // What is still on the original line. The part that takes all of it gets the line itself.
      const onLine = leftOnLine.get(item.id) ?? item.qty;
      leftOnLine.set(item.id, onLine - qty);
      if (qty === onLine) {
        await client.query('UPDATE order_items SET order_id = $1 WHERE id = $2', [made.rows[0].id, item.id]);
      } else {
        // Part of a line moves: the line is cut in two, and both halves keep the dish's status and KOT.
        await client.query(
          `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, veg, size, qty, unit_price, customisations, note, allergy_note,
                                    status, unavailable_reason, created_at, updated_at, tax_rate, tax_mode, addons, terminal_id, kot_id, terminal_ids,
                                    started_at, ready_at, delivered_at, ready_by, delivered_by)
           SELECT $1, menu_item_id, name_snapshot, veg, size, $2, unit_price, customisations, note, allergy_note,
                  status, unavailable_reason, created_at, updated_at, tax_rate, tax_mode, addons, terminal_id, kot_id, terminal_ids,
                  started_at, ready_at, delivered_at, ready_by, delivered_by
             FROM order_items WHERE id = $3`,
          [made.rows[0].id, qty, item.id]
        );
        await client.query('UPDATE order_items SET qty = qty - $1 WHERE id = $2', [qty, item.id]);
      }
    }
  }

  let fresh = [];
  if (moving) {
    // A fixed-amount discount is shared between the bills in proportion to what each one ordered.
    for (const id of orderIds) fresh.push(await refreshOrder(client, user.restaurantId, id));
    if (original.discount_type === 'amount' && original.discount_value > 0) {
      const cuts = share(paise(original.discount_value), fresh.map((o) => paise(o.subtotal)));
      for (let n = 0; n < orderIds.length; n += 1) {
        await client.query(`UPDATE orders SET discount_type = 'amount', discount_value = $1 WHERE id = $2`, [rupees(cuts[n]), orderIds[n]]);
      }
      fresh = [];
      for (const id of orderIds) fresh.push(await refreshOrder(client, user.restaurantId, id));
    }
    // Rounding can leave the bills a rupee apart from the original: the last one takes the difference.
    const drift = Math.round((original.total - fresh.reduce((sum, o) => sum + o.total, 0)) * 100) / 100;
    if (drift !== 0) {
      const last = orderIds[orderIds.length - 1];
      await client.query('UPDATE orders SET split_adjust = split_adjust + $1 WHERE id = $2', [drift, last]);
      await refreshOrder(client, user.restaurantId, last);
    }
  }
  fresh = [];
  for (const id of orderIds) fresh.push(await getOrder(client, user.restaurantId, id));

  const parts = children.map((child) => {
    const order = fresh.find((o) => o.table_id === child.id);
    return { table_id: child.id, table_label: child.label, seats: child.seats, free: !order && !(child.id === children[0].id && parent.locked_by), ...(order ? summary(order) : {}) };
  });
  await audit(client, {
    restaurantId: user.restaurantId,
    userId: user.id,
    action: 'table.split',
    entity: 'table',
    entityId: parent.id,
    old: { table: parent.label, seats: parent.seats, order: original?.number, total: original?.total },
    new: { parts: parts.map((p) => ({ table: p.table_label, seats: p.seats, order: p.order_number, total: p.total })) },
    refs: { table_id: parent.id, order_id: original?.id, order_ids: orderIds },
  });
  return {
    parent: { id: parent.id, label: parent.label, seats: parent.seats },
    before: original ? summary(original) : null,
    parts,
    orders: fresh,
    created,
    tableIds: [parent.id, ...children.map((c) => c.id)],
  };
}

async function splitAgain(client, user, parent, wanted, seats) {
  const children = (await client.query('SELECT * FROM tables WHERE parent_table_id = $1 AND NOT archived ORDER BY id FOR UPDATE', [parent.id])).rows;
  const kept = new Map(); // part id -> its place in the new list
  wanted.forEach((p, n) => {
    if (Array.isArray(p.items) && p.items.length > 0) throw fail('no_move', 'Dishes can only be moved when a table is first split. Merge the parts and split again.', 409);
    if (p.id == null) return;
    const child = children.find((c) => c.id === Number(p.id));
    if (!child || kept.has(child.id)) throw fail('bad_part', 'One of these parts is no longer there. Open the table again.', 409);
    kept.set(child.id, n);
  });

  // A part with people at it keeps at least as many seats as it has guests.
  const seated = (await client.query(`SELECT table_id, guests FROM orders WHERE table_id = ANY($1::int[]) AND status NOT IN ${FINISHED_SQL} AND handed_over_at IS NULL`, [children.map((c) => c.id)])).rows;
  for (const child of children) {
    const order = seated.find((o) => o.table_id === child.id);
    if (!order || !kept.has(child.id)) continue;
    const need = order.guests > 0 ? order.guests : 1;
    if (seats[kept.get(child.id)] < need) throw fail('party_seats', `${child.label} has ${plural(need, 'guest')}, so it keeps at least ${plural(need, 'seat')}`, 409);
  }

  // A part that is left out is removed, which is only possible while nobody is using it.
  const removed = children.filter((c) => !kept.has(c.id));
  for (const child of removed) {
    if (child.status !== 'free' || child.locked_by) throw fail('part_in_use', `${child.label} is in use, so it cannot be removed`, 409);
  }
  if (removed.length) await client.query('UPDATE tables SET archived = true WHERE id = ANY($1::int[])', [removed.map((c) => c.id)]);

  const before = children.map((c) => ({ table: c.label, seats: c.seats }));
  const numberOf = (label) => Number(label.slice(label.lastIndexOf('.') + 1));
  const used = new Set(children.filter((c) => kept.has(c.id)).map((c) => numberOf(c.label)));
  const parts = [];
  for (let n = 0; n < wanted.length; n += 1) {
    const child = children.find((c) => kept.get(c.id) === n);
    if (child) {
      if (child.seats !== seats[n]) await client.query('UPDATE tables SET seats = $1 WHERE id = $2', [seats[n], child.id]);
      parts.push({ table_id: child.id, table_label: child.label, seats: seats[n], free: child.status === 'free' && !child.locked_by });
    } else {
      let number = 1;
      while (used.has(number)) number += 1;
      used.add(number);
      const made = await newPart(client, parent, number, seats[n]);
      parts.push({ table_id: made.id, table_label: made.label, seats: made.seats, free: true });
    }
  }

  // The bills at the parts did not change; they are sent again so every screen shows the new seats.
  const orders = [];
  for (const part of parts) {
    const order = await openOrderOn(client, user, part.table_id);
    if (order) {
      orders.push(order);
      Object.assign(part, summary(order));
    }
  }
  await audit(client, {
    restaurantId: user.restaurantId,
    userId: user.id,
    action: 'table.split',
    entity: 'table',
    entityId: parent.id,
    old: { table: parent.label, seats: parent.seats, parts: before },
    new: { parts: parts.map((p) => ({ table: p.table_label, seats: p.seats, order: p.order_number })) },
    refs: { table_id: parent.id, order_ids: orders.map((o) => o.id) },
  });
  return {
    parent: { id: parent.id, label: parent.label, seats: parent.seats },
    before: null,
    parts,
    orders,
    created: [],
    tableIds: [parent.id, ...children.map((c) => c.id), ...parts.map((p) => p.table_id)],
  };
}

// ---------- Merge and join ----------

// Folds several open bills into one. The bill the others were split from survives when it is
// among them; otherwise the oldest. Returns { survivor, others, billAsked, owed }.
async function combine(client, orders) {
  const survivor = orders.find((o) => !o.parent_order_id) || orders.slice().sort((a, b) => a.id - b.id)[0];
  const others = orders.filter((o) => o.id !== survivor.id);

  // Discounts: the same percentage everywhere stays a percentage; anything else becomes the sum of the amounts.
  const samePct = orders.every((o) => o.discount_type === 'pct' && o.discount_value === survivor.discount_value);
  const discount = samePct
    ? { type: 'pct', value: survivor.discount_value }
    : { type: 'amount', value: Math.round(orders.reduce((sum, o) => sum + o.discount_amount, 0) * 100) / 100 };
  const billAsked = orders.every((o) => o.bill_requested_at);

  await client.query('UPDATE order_items SET order_id = $1 WHERE order_id = ANY($2::int[])', [survivor.id, others.map((o) => o.id)]);
  // A line that a split cut in two becomes one line again (same dish, same ticket, same state).
  // Lines an approval once pointed at are left alone, so that history stays intact.
  await client.query(
    `WITH twins AS (
       SELECT i.id, i.qty,
              min(i.id) OVER w AS keep_id, sum(i.qty) OVER w AS total_qty
         FROM order_items i
        WHERE i.order_id = $1 AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.order_item_id = i.id)
       WINDOW w AS (PARTITION BY i.menu_item_id, i.size, i.unit_price, i.customisations, i.note, i.allergy_note, i.addons::text,
                                 i.status, i.kot_id, i.tax_rate, i.tax_mode, i.created_at)
     ), folded AS (
       UPDATE order_items i SET qty = t.total_qty FROM twins t WHERE i.id = t.id AND t.id = t.keep_id AND t.total_qty <> t.qty
     )
     DELETE FROM order_items i USING twins t WHERE i.id = t.id AND t.id <> t.keep_id`,
    [survivor.id]
  );
  await client.query(
    `UPDATE orders SET status = 'merged', merged_into_id = $1, closed_at = now(), at_counter = false, bill_requested_at = NULL,
            subtotal = 0, discount_amount = 0, taxable = 0, tax_total = 0, tax_lines = '[]', service_charge = 0, round_off = 0, total = 0
      WHERE id = ANY($2::int[])`,
    [survivor.id, others.map((o) => o.id)]
  );
  // split_adjust is worked out again by settle(), once the merged bill has been added up.
  await client.query(
    `UPDATE orders
        SET discount_type = $2, discount_value = $3, split_adjust = 0,
            bill_requested_at = CASE WHEN $4 THEN bill_requested_at ELSE NULL END, at_counter = at_counter AND $4
      WHERE id = $1`,
    [survivor.id, discount.type, discount.value, billAsked]
  );
  return { survivor, others, billAsked, owed: Math.round(orders.reduce((sum, o) => sum + o.total, 0) * 100) / 100 };
}

// After the tables are in place: the merged bill owes exactly what its parts owed together.
// Rounding each bill on its own can leave that a rupee away from the merged bill's own rounding;
// the difference is kept on the bill. Merging every part back therefore gives the original bill
// again, to the rupee.
async function settle(client, user, merge) {
  let merged = await refreshOrder(client, user.restaurantId, merge.survivor.id);
  const drift = Math.round((merge.owed - merged.total) * 100) / 100;
  if (drift !== 0) {
    await client.query('UPDATE orders SET split_adjust = $1 WHERE id = $2', [drift, merge.survivor.id]);
    merged = await refreshOrder(client, user.restaurantId, merge.survivor.id);
  }
  if (merge.billAsked && merged.table_id) await client.query(`UPDATE tables SET status = 'needs_payment' WHERE id = $1`, [merged.table_id]);
  const closed = [];
  for (const order of merge.others) closed.push(await getOrder(client, user.restaurantId, order.id));
  return { merged: await getOrder(client, user.restaurantId, merge.survivor.id), closed };
}

// table.merge { tableIds: [...], seat?, preview? }
//   Parts of one split table   become one part again (their seats are added up). Bills on them
//                              become one bill. When one part is left, the table is whole again.
//   Whole tables               are joined for one party: T3 + T4. The order sits on one of them
//                              (the lead); the others follow it until that order closes.
//                              seat: true also takes the joined tables for the waiter, to start an order.
ws.on('table.merge', async (user, payload) => {
  const given = [...new Set(Array.isArray(payload.tableIds) ? payload.tableIds.map(Number) : [])].filter(Number.isInteger);
  if (given.length < 2) throw fail('too_few', 'Choose at least two tables');

  const result = await run(payload.preview === true, async (client) => {
    // A table that already follows another one stands for its whole group.
    const asked = (await client.query('SELECT id, joined_to_id FROM tables WHERE id = ANY($1::int[]) AND restaurant_id = $2 AND NOT archived', [given, user.restaurantId])).rows;
    if (asked.length !== given.length) throw fail('no_table', 'One of these tables is no longer there', 404);
    const ids = [...new Set(given.map((id) => asked.find((t) => t.id === id).joined_to_id || id))];
    const tables = (await client.query('SELECT * FROM tables WHERE id = ANY($1::int[]) AND restaurant_id = $2 AND NOT archived ORDER BY sort, id FOR UPDATE', [ids, user.restaurantId])).rows;
    if (tables.length < 2) throw fail('too_few', 'These tables are already joined');

    const parentId = tables[0].parent_table_id;
    const siblings = !!parentId && tables.every((t) => t.parent_table_id === parentId);
    const whole = tables.every((t) => !t.parent_table_id && t.status !== 'split');
    if (!siblings && !whole) throw fail('not_siblings', 'Merge the parts of one split table, or join whole tables. A part cannot be joined to another table.', 409);
    if (whole && new Set(tables.map((t) => t.area_id)).size > 1) throw fail('different_areas', 'Only tables in the same dining area can be joined', 409);

    const orders = [];
    for (const table of tables) {
      mayUseTable(user, table);
      const order = await openOrderOn(client, user, table.id);
      if (!order) {
        notTaken(user, table);
        continue;
      }
      mayManage(user, order);
      // A paid bill is history. It is never folded into another bill.
      if (SETTLED.includes(order.status) || order.paid_total > 0) throw fail('paid', `${table.label} already has a payment, so it cannot be merged`, 409);
      if (order.pending_approvals.length > 0) throw fail('approval_pending', `A manager approval is still pending on ${table.label}`, 409);
      orders.push(order);
    }
    const before = orders.map(summary);
    const merge = orders.length > 1 ? await combine(client, orders) : null;
    const survivor = merge ? merge.survivor : orders[0] || null;
    const tableIds = tables.map((t) => t.id);
    let keep;

    if (siblings) {
      // The part with the bill stays; without a bill, the one somebody is seating, else the first.
      keep = (survivor && tables.find((t) => t.id === survivor.table_id)) || tables.find((t) => t.locked_by) || tables[0];
      const gone = tables.filter((t) => t.id !== keep.id);
      await client.query('UPDATE tables SET seats = seats + $1 WHERE id = $2', [gone.reduce((n, t) => n + t.seats, 0), keep.id]);
      await client.query(`UPDATE tables SET archived = true, status = 'free', locked_by = NULL, locked_at = NULL WHERE id = ANY($1::int[])`, [gone.map((t) => t.id)]);
      const left = await client.query('SELECT * FROM tables WHERE parent_table_id = $1 AND NOT archived', [parentId]);
      if (left.rows.length === 1) {
        // One part left: the table is whole again and takes over what that part was doing.
        const part = left.rows[0];
        await client.query(`UPDATE tables SET archived = true, status = 'free', locked_by = NULL, locked_at = NULL WHERE id = $1`, [part.id]);
        await client.query('UPDATE tables SET status = $1, locked_by = $2, locked_at = $3 WHERE id = $4', [part.status, part.locked_by, part.locked_at, parentId]);
        await client.query(`UPDATE orders SET table_id = $1 WHERE table_id = $2 AND status NOT IN ${FINISHED_SQL} AND handed_over_at IS NULL`, [parentId, part.id]);
        tableIds.push(parentId);
        keep = { ...keep, id: parentId };
      }
    } else {
      keep = (survivor && tables.find((t) => t.id === survivor.table_id)) || tables.find((t) => t.locked_by) || tables.find((t) => t.id === ids[0]);
      const followers = tables.filter((t) => t.id !== keep.id);
      // A waiter seating a party takes the joined tables; otherwise free tables stay free, joined.
      if (!survivor && !keep.locked_by && payload.seat === true && user.role === 'waiter') {
        await client.query(`UPDATE tables SET status = 'occupied', locked_by = $1, locked_at = now() WHERE id = $2`, [user.id, keep.id]);
        keep = { ...keep, status: 'occupied', locked_by: user.id };
      }
      const inUse = !!survivor || keep.status !== 'free';
      await client.query(
        `UPDATE tables SET joined_to_id = $1, status = $2, locked_by = $3, locked_at = CASE WHEN $2 = 'free' THEN NULL ELSE now() END
          WHERE id = ANY($4::int[])`,
        [keep.id, inUse ? 'occupied' : 'free', inUse ? (survivor?.waiter_id ?? keep.locked_by) : null, followers.map((t) => t.id)]
      );
      // Tables that followed one of these now follow the lead.
      const moved = await client.query('UPDATE tables SET joined_to_id = $1 WHERE joined_to_id = ANY($2::int[]) RETURNING id', [keep.id, followers.map((t) => t.id)]);
      tableIds.push(...moved.rows.map((r) => r.id));
    }

    const done = merge ? await settle(client, user, merge) : { merged: survivor ? await getOrder(client, user.restaurantId, survivor.id) : null, closed: [] };
    const table = await getTable(client, user.restaurantId, keep.id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: siblings ? 'table.merge' : 'table.join',
      entity: 'table',
      entityId: siblings ? parentId : keep.id,
      old: { tables: tables.map((t) => t.label), parts: before.map((p) => ({ table: p.table_label, order: p.order_number, total: p.total })) },
      new: { table: done.merged?.table_label ?? [table.label, ...table.joined.map((j) => j.label)].join('+'), order: done.merged?.number, total: done.merged?.total },
      refs: { table_id: siblings ? parentId : keep.id, order_id: done.merged?.id, order_ids: orders.map((o) => o.id) },
    });
    return { before, merged: done.merged ? summary(done.merged) : null, table, order: done.merged, closed: done.closed, tableIds: [...tableIds, keep.id] };
  });

  if (payload.preview !== true) {
    for (const order of result.closed) await publishOrder(order);
    if (result.order) await publishOrder(result.order, { tables: result.tableIds });
    else await publishTables(user.restaurantId, result.tableIds);
  }
  return forUser(user, { before: result.before, merged: result.merged, table: result.table });
});

// table.unjoin { tableId } — joined tables stand on their own again. The order (if any) stays on
// the lead table; the others are free.
ws.on('table.unjoin', async (user, { tableId }) => {
  const result = await db.tx(async (client) => {
    const asked = (await client.query('SELECT id, joined_to_id FROM tables WHERE id = $1 AND restaurant_id = $2 AND NOT archived', [tableId, user.restaurantId])).rows[0];
    if (!asked) throw fail('no_table', 'No such table', 404);
    const lead = (await client.query('SELECT * FROM tables WHERE id = $1 FOR UPDATE', [asked.joined_to_id || asked.id])).rows[0];
    mayUseTable(user, lead);
    const order = await openOrderOn(client, user, lead.id);
    if (order) mayManage(user, order);
    else notTaken(user, lead);
    const freed = await client.query(
      `UPDATE tables SET joined_to_id = NULL, status = 'free', locked_by = NULL, locked_at = NULL WHERE joined_to_id = $1 RETURNING id, label`,
      [lead.id]
    );
    if (freed.rows.length === 0) throw fail('not_joined', `${lead.label} is not joined with another table`, 409);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'table.unjoin',
      entity: 'table',
      entityId: lead.id,
      old: { tables: [lead.label, ...freed.rows.map((r) => r.label)] },
      new: { table: lead.label, freed: freed.rows.map((r) => r.label) },
      refs: { table_id: lead.id, order_id: order?.id },
    });
    return { order: order ? await getOrder(client, user.restaurantId, order.id) : null, tableIds: [lead.id, ...freed.rows.map((r) => r.id)], lead: lead.label, freed: freed.rows.map((r) => r.label) };
  });
  if (result.order) await publishOrder(result.order, { tables: result.tableIds });
  else await publishTables(user.restaurantId, result.tableIds);
  return { lead: result.lead, freed: result.freed };
});

// ---------- Transfer ----------

// table.transfer { orderId, toTableId } — the party moves to a free table, at any point: while
// ordering, while the kitchen is cooking, while eating, or after paying. The order, its dishes and
// its kitchen tickets go with them; the kitchen sees the new table at once. The old table (and
// any tables joined to it) is given back.
ws.on('table.transfer', async (user, payload) => {
  const result = await db.tx(async (client) => {
    const found = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ${FINISHED_SQL} FOR UPDATE`,
      [payload.orderId, user.restaurantId]
    );
    const order = found.rows[0];
    if (!order || !order.table_id) throw fail('no_order', 'This table has no order to move', 404);
    if (order.handed_over_at) throw fail('order_closed', 'This table was closed. A manager can reopen it first.', 409);
    if (order.waiter_id !== user.id && !can(user, 'orders.manage')) throw fail('not_your_order', 'This table belongs to another waiter', 403);

    const from = (await client.query('SELECT * FROM tables WHERE id = $1 FOR UPDATE', [order.table_id])).rows[0];
    const fromLabel = (await getOrder(client, user.restaurantId, order.id)).table_label; // "T7+T10" when tables were joined
    const dest = (await client.query('SELECT * FROM tables WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [payload.toTableId, user.restaurantId])).rows[0];
    if (!dest || dest.archived || !dest.active) throw fail('no_table', 'Choose a table that is in use', 404);
    if (dest.id === from.id) throw fail('same_table', `The party is already at ${dest.label}`, 409);
    if (dest.status !== 'free' || dest.locked_by || dest.joined_to_id) throw fail('not_free', `${dest.label} is not free`, 409);
    if (user.role === 'waiter' && !tableAllowed(user.access, dest)) throw fail('table_not_assigned', `${dest.label} is not assigned to you`, 403);

    // The new table carries on exactly where the old one was (preparing, ready, bill requested, paid ...).
    await client.query('UPDATE orders SET table_id = $1 WHERE id = $2', [dest.id, order.id]);
    await client.query('UPDATE tables SET status = $1, locked_by = $2, locked_at = now() WHERE id = $3', [from.status, order.waiter_id, dest.id]);
    // Tables already joined to the new one (set up ahead for a big party) are now in use with it.
    const joined = await client.query(
      `UPDATE tables SET status = 'occupied', locked_by = $1, locked_at = now() WHERE joined_to_id = $2 RETURNING id`,
      [order.waiter_id, dest.id]
    );
    const freed = await releaseTable(client, from.id);
    const moved = await getOrder(client, user.restaurantId, order.id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'table.transfer',
      entity: 'order',
      entityId: order.id,
      old: { table: fromLabel },
      new: { table: moved.table_label },
      refs: { order_id: order.id, table_id: dest.id, from_table_id: from.id },
    });
    return { order: moved, tableIds: [...freed, dest.id, ...joined.rows.map((r) => r.id)], from: fromLabel, to: moved.table_label };
  });
  await publishOrder(result.order, { tables: result.tableIds });
  // The kitchen is told in words too: a ticket that changes its table is easy to miss.
  ws.toWhere(user.restaurantId, 'order.moved', { orderId: result.order.id, number: result.order.number, from: result.from, to: result.to }, (u) => u.role === 'chef');
  return { order: result.order, from: result.from, to: result.to };
});
