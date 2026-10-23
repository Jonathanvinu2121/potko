// Order actions: create, add items, edit, remove, deliver.
// The edit rules live here, on the server, so a tampered or stale app can never get around them.
const db = require('../db');
const { AppError } = require('../errors');
const { getOrder, refreshOrder, audit, restaurantSettings, SETTLED_SQL } = require('../orders');
const { tableAllowed } = require('../tables');
const { can } = require('../permissions');
const ws = require('./events');
const { publishOrder } = require('./publish');

const fail = (code, message) => new AppError(400, code, message);
const LOCKED = 'The kitchen has started this item. Only a manager can cancel it now.';

// Chips every dish offers on top of its own, e.g. "pack this one to take away".
const EXTRA_CHIPS = ['Parcel'];

// Trims free text and cuts it to a sensible length. Empty becomes null.
const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;

// The dishes asked for, as they are on the menu now, and what an order line needs from the
// restaurant: its tax defaults and the terminal that takes dishes with none of their own.
async function loadMenu(client, restaurantId, lines) {
  const ids = [...new Set(lines.map((l) => Number(l.menuItemId)))].filter(Number.isInteger);
  const { rows } = await client.query(
    `SELECT m.*, c.active AS category_active,
            (SELECT k.active FROM kitchen_terminals k WHERE k.id = m.terminal_id) AS terminal_active,
            COALESCE((SELECT array_agg(k.id ORDER BY array_position(m.terminal_ids, k.id))
                        FROM kitchen_terminals k WHERE k.id = ANY(m.terminal_ids) AND k.active), '{}') AS active_terminal_ids
       FROM menu_items m JOIN categories c ON c.id = m.category_id
      WHERE m.restaurant_id = $1 AND m.id = ANY($2::int[]) AND m.deleted_at IS NULL`,
    [restaurantId, ids]
  );
  const terminal = await client.query(
    'SELECT id FROM kitchen_terminals WHERE restaurant_id = $1 AND active ORDER BY is_default DESC, sort, id LIMIT 1',
    [restaurantId]
  );
  if (!terminal.rows[0]) throw new AppError(409, 'no_terminal', 'No kitchen terminal is set up. Ask a manager to add one.');
  const settings = await restaurantSettings(client, restaurantId);
  return { items: new Map(rows.map((m) => [m.id, m])), defaultTerminalId: terminal.rows[0].id, tax: settings.tax };
}

// Checks the add-ons picked for a dish against the groups the dish offers.
// Returns what is saved on the line (names and prices copied from the menu) and their total.
function resolveAddons(item, asked) {
  const picked = Array.isArray(asked) ? asked : [];
  const saved = [];
  let extra = 0;
  for (const group of item.modifier_groups || []) {
    const options = group.options || [];
    const mine = picked.filter((a) => a && a.group === group.name);
    const chosen = options.filter((o) => mine.some((a) => a.name === o.name));
    const min = Math.max(Number(group.min) || 0, group.required ? 1 : 0);
    const max = Number(group.max) > 0 ? Number(group.max) : options.length;
    if (chosen.length < min) throw fail('addon_required', `Choose ${min === 1 ? 'an option' : `${min} options`} for ${group.name} on ${item.name}`);
    if (chosen.length > max) throw fail('addon_too_many', `Choose up to ${max} for ${group.name} on ${item.name}`);
    for (const option of chosen) {
      saved.push({ group: group.name, name: option.name, price: Number(option.price) || 0 });
      extra += Number(option.price) || 0;
    }
  }
  return { saved, extra };
}

// Checks one requested dish against the menu and returns what will be saved.
// Names, prices, tax and the kitchen terminal always come from the menu, never from the app.
function resolveLine(menu, line, { mustBeAvailable = true } = {}) {
  const item = menu.items.get(Number(line.menuItemId));
  if (!item) throw fail('unknown_item', 'An item in this order is no longer on the menu');
  if (mustBeAvailable && (!item.available || !item.category_active)) {
    throw new AppError(409, 'item_unavailable', `${item.name} is unavailable right now`);
  }

  const qty = Number(line.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw fail('bad_qty', `Check the quantity of ${item.name}`);

  let size = null;
  let unitPrice = item.price;
  // An open-price dish has no fixed price: the person ordering types it in.
  if (item.open_price) {
    const typed = Math.round(Number(line.price) * 100) / 100;
    if (!(typed > 0 && typed <= 100000)) throw fail('bad_price', `Enter the price of ${item.name}`);
    unitPrice = typed;
  }
  if (!item.open_price && item.sizes.length > 0) {
    const chosen = item.sizes.find((s) => s.label === line.size);
    if (!chosen) throw fail('bad_size', `Choose a size for ${item.name}`);
    size = chosen.label;
    unitPrice = Number(chosen.price);
  }
  const addons = resolveAddons(item, line.addons);

  // Only the chips this dish offers are kept; anything else belongs in the note.
  const asked = Array.isArray(line.customisations) ? line.customisations : [];
  const customisations = [...item.customisations, ...EXTRA_CHIPS].filter((c) => asked.includes(c));

  return {
    item,
    size,
    qty,
    unitPrice: Math.round((unitPrice + addons.extra) * 100) / 100,
    addons: addons.saved,
    customisations,
    note: text(line.note, 200),
    allergyNote: text(line.allergyNote, 120),
    taxRate: item.tax_rate ?? menu.tax.rate,
    taxMode: item.tax_mode ?? menu.tax.mode,
    // A dish whose own terminal was switched off falls back to the default one, never to "somewhere".
    terminalId: item.terminal_id && item.terminal_active ? item.terminal_id : menu.defaultTerminalId,
  };
}

// Every terminal that shows a dish: the ones ticked on the dish that are switched on, with the
// numbering terminal first; a dish with none of its own goes to the default terminal.
function terminalsFor(line) {
  const ids = line.item.active_terminal_ids || [];
  return [...new Set([line.terminalId, ...ids])];
}

// Saves new dishes on an order and sends them to the kitchen: one KOT per terminal.
async function insertItems(client, user, order, items) {
  const kots = new Map(); // terminal id -> kot id
  for (const i of items) {
    if (!kots.has(i.terminalId)) {
      const numbered = await client.query(
        'UPDATE restaurants SET next_kot_number = next_kot_number + 1 WHERE id = $1 RETURNING next_kot_number - 1 AS number',
        [user.restaurantId]
      );
      const kot = await client.query(
        `INSERT INTO kots (restaurant_id, order_id, terminal_id, number, table_label, sent_by)
         VALUES ($1, $2, $3, $4, (SELECT label FROM tables WHERE id = $5), $6) RETURNING id`,
        [user.restaurantId, order.id, i.terminalId, numbered.rows[0].number, order.table_id, user.id]
      );
      kots.set(i.terminalId, kot.rows[0].id);
    }
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, veg, size, qty, unit_price, customisations,
                                note, allergy_note, addons, tax_rate, tax_mode, terminal_id, kot_id, terminal_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        order.id, i.item.id, i.item.name, i.item.veg, i.size, i.qty, i.unitPrice, i.customisations,
        i.note, i.allergyNote, JSON.stringify(i.addons), i.taxRate, i.taxMode, i.terminalId, kots.get(i.terminalId), terminalsFor(i),
      ]
    );
    await client.query('UPDATE menu_items SET order_count = order_count + $1 WHERE id = $2', [i.qty, i.item.id]);
  }
}

function readLines(payload) {
  const lines = Array.isArray(payload.items) ? payload.items : [];
  if (lines.length === 0) throw fail('no_items', 'Add at least one item');
  if (lines.length > 100) throw fail('too_many_items', 'Too many items in one order');
  return lines;
}

// An order may be worked on by the waiter who owns it, or by anyone allowed to manage every order.
function checkOwner(user, waiterId) {
  if (waiterId !== user.id && !can(user, 'orders.manage')) {
    throw new AppError(403, 'not_your_order', 'This order belongs to another waiter');
  }
}

// An order whose table its waiter closed is locked until a manager reopens it (order.reopen).
const CLOSED = 'This table was closed and its bill is with the counter. A manager can reopen it.';

// Locks an order that can still be changed for this transaction and checks who is asking.
async function lockOwnOrder(client, user, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ${SETTLED_SQL} FOR UPDATE`,
    [orderId, user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_order', 'This order is no longer open');
  checkOwner(user, rows[0].waiter_id);
  if (rows[0].handed_over_at) throw new AppError(409, 'order_closed', CLOSED);
  return rows[0];
}

// Locks one dish (and its order) and checks who is asking.
async function lockOwnItem(client, user, itemId) {
  const { rows } = await client.query(
    `SELECT i.*, o.waiter_id, o.handed_over_at
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.id = $1 AND o.restaurant_id = $2 AND o.status NOT IN ${SETTLED_SQL}
        FOR UPDATE OF i, o`,
    [itemId, user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_item', 'This item is no longer on an open order');
  checkOwner(user, rows[0].waiter_id);
  if (rows[0].handed_over_at) throw new AppError(409, 'order_closed', CLOSED);
  return rows[0];
}

// order.create { type, tableId?, guests? (no longer asked for in the app), customerName?, customerPhone?, deliveryAddress?, carNumber?,
//                items: [{ menuItemId, size?, qty, addons?, customisations?, note?, allergyNote? }] }
// The action id doubles as the order's client_id, so a double tap or a retry never makes two orders.
ws.on('order.create', async (user, payload, actionId) => {
  ws.need(user, 'waiter');
  const { restaurantId } = user;

  const type = payload.type;
  if (!['dine_in', 'delivery', 'takeaway'].includes(type)) throw fail('bad_type', 'Choose an order type');

  const customerName = text(payload.customerName, 80);
  const customerPhone = text(payload.customerPhone, 20);
  const deliveryAddress = text(payload.deliveryAddress, 200);
  const carNumber = text(payload.carNumber, 20)?.toUpperCase() ?? null;
  if (type === 'delivery' && !customerName) throw fail('name_required', 'Customer name is required for delivery');
  if (type === 'takeaway' && !customerName && !carNumber) throw fail('car_or_name_required', 'Enter car number or name');
  const lines = readLines(payload);

  const order = await db.tx(async (client) => {
    // Already created by an earlier try of this same action? Return that order.
    if (actionId) {
      const existing = await client.query('SELECT id FROM orders WHERE restaurant_id = $1 AND client_id = $2', [
        restaurantId,
        actionId,
      ]);
      if (existing.rows[0]) return getOrder(client, restaurantId, existing.rows[0].id);
    }

    // Dine-in: the waiter must hold the table lock, and the table must not already have an order.
    let tableId = null;
    let guests = Number.isInteger(payload.guests) && payload.guests > 0 && payload.guests <= 99 ? payload.guests : null;
    if (type === 'dine_in') {
      const table = await client.query('SELECT * FROM tables WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [
        payload.tableId,
        restaurantId,
      ]);
      if (!table.rows[0]) throw fail('no_table', 'Choose a table');
      if (!tableAllowed(user.access, table.rows[0])) throw new AppError(403, 'table_not_assigned', 'This table is not assigned to you');
      if (table.rows[0].locked_by !== user.id) throw new AppError(409, 'table_not_yours', 'This table is not yours');
      if (table.rows[0].status !== 'occupied') throw new AppError(409, 'table_has_order', 'This table already has an order');
      tableId = table.rows[0].id;
    }

    const menu = await loadMenu(client, restaurantId, lines);
    const items = lines.map((line) => resolveLine(menu, line));

    const numbered = await client.query(
      'UPDATE restaurants SET next_order_number = next_order_number + 1 WHERE id = $1 RETURNING next_order_number - 1 AS number',
      [restaurantId]
    );
    const inserted = await client.query(
      `INSERT INTO orders (restaurant_id, number, client_id, type, table_id, guests, customer_name, customer_phone,
                           delivery_address, car_number, waiter_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, table_id`,
      [
        restaurantId,
        numbered.rows[0].number,
        actionId || null,
        type,
        tableId,
        guests,
        customerName,
        customerPhone,
        type === 'delivery' ? deliveryAddress : null,
        type === 'takeaway' ? carNumber : null,
        user.id,
      ]
    );
    const orderId = inserted.rows[0].id;
    await insertItems(client, user, inserted.rows[0], items);

    const created = await refreshOrder(client, restaurantId, orderId);
    await audit(client, {
      restaurantId,
      userId: user.id,
      action: 'order.create',
      entity: 'order',
      entityId: orderId,
      new: { number: created.number, type, items: items.length, total: created.total },
      refs: { order_id: orderId, table_id: tableId || undefined },
    });
    return created;
  });

  await publishOrder(order, { created: true });
  return order;
});

// order.addItems { orderId, items, replacesItemId? } — more dishes on an order that is already with
// the kitchen. Allowed until the bill is settled. With replacesItemId, the new dishes stand in for a
// dish the chef could not make, and that dish is taken off the order.
ws.on('order.addItems', async (user, payload) => {
  const lines = readLines(payload);
  const order = await db.tx(async (client) => {
    const before = await lockOwnOrder(client, user, payload.orderId);
    if (payload.replacesItemId) {
      const replaced = await client.query(
        `UPDATE order_items SET status = 'removed', updated_at = now() WHERE id = $1 AND order_id = $2 AND status = 'unavailable'`,
        [payload.replacesItemId, payload.orderId]
      );
      if (replaced.rowCount === 0) throw new AppError(409, 'not_unavailable', 'That item is no longer waiting to be replaced');
    }
    const menu = await loadMenu(client, user.restaurantId, lines);
    const items = lines.map((line) => resolveLine(menu, line));
    await insertItems(client, user, before, items);
    // New dishes mean the bill is open again.
    await client.query('UPDATE orders SET at_counter = false, bill_requested_at = NULL, bill_requested_by = NULL WHERE id = $1', [payload.orderId]);
    const fresh = await refreshOrder(client, user.restaurantId, payload.orderId);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'order.addItems',
      entity: 'order',
      entityId: fresh.id,
      new: { items: items.map((i) => `${i.qty}× ${i.item.name}`), replacesItemId: payload.replacesItemId || undefined },
      refs: { order_id: fresh.id, table_id: fresh.table_id || undefined },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// item.edit { itemId, size?, qty, addons?, customisations?, note?, allergyNote? }
// Only while the dish is Sent or Accepted. Once the chef starts preparing it, it is locked.
ws.on('item.edit', async (user, payload) => {
  const order = await db.tx(async (client) => {
    const item = await lockOwnItem(client, user, payload.itemId);
    if (!['sent', 'accepted'].includes(item.status)) throw new AppError(409, 'locked', LOCKED);

    const menu = await loadMenu(client, user.restaurantId, [{ menuItemId: item.menu_item_id }]);
    const next = resolveLine(menu, { ...payload, menuItemId: item.menu_item_id }, { mustBeAvailable: false });
    await client.query(
      `UPDATE order_items
          SET size = $2, qty = $3, unit_price = $4, customisations = $5, note = $6, allergy_note = $7, addons = $8, updated_at = now()
        WHERE id = $1`,
      [item.id, next.size, next.qty, next.unitPrice, next.customisations, next.note, next.allergyNote, JSON.stringify(next.addons)]
    );
    const fresh = await refreshOrder(client, user.restaurantId, item.order_id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'item.edit',
      entity: 'order_item',
      entityId: item.id,
      old: { qty: item.qty, size: item.size, customisations: item.customisations, note: item.note },
      new: { qty: next.qty, size: next.size, customisations: next.customisations, note: next.note },
      refs: { order_id: item.order_id },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// item.remove { itemId } — a dish that is Sent, Accepted, or that the chef marked Unavailable.
ws.on('item.remove', async (user, payload) => {
  const order = await db.tx(async (client) => {
    const item = await lockOwnItem(client, user, payload.itemId);
    if (!['sent', 'accepted', 'unavailable'].includes(item.status)) throw new AppError(409, 'locked', LOCKED);
    await client.query(`UPDATE order_items SET status = 'removed', updated_at = now() WHERE id = $1`, [item.id]);
    const fresh = await refreshOrder(client, user.restaurantId, item.order_id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'item.remove',
      entity: 'order_item',
      entityId: item.id,
      old: { name: item.name_snapshot, qty: item.qty, status: item.status },
      refs: { order_id: item.order_id },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// waiter.deliver { itemIds } — ready dishes handed to the customer ("mark served").
// Dishes from several orders at once is fine. A manager may do it on any order.
ws.on('waiter.deliver', async (user, payload) => {
  const everyone = can(user, 'orders.manage');
  if (!everyone) ws.need(user, 'waiter');
  const ids = [...new Set(Array.isArray(payload.itemIds) ? payload.itemIds.map(Number) : [])].filter(Number.isInteger);
  if (ids.length === 0) throw fail('no_items', 'Select items to deliver');

  const { orders, delivered } = await db.tx(async (client) => {
    const done = await client.query(
      `UPDATE order_items i SET status = 'delivered', updated_at = now(), delivered_at = now(), delivered_by = $3
         FROM orders o
        WHERE i.id = ANY($1::int[]) AND o.id = i.order_id AND o.restaurant_id = $2 AND ($4 OR o.waiter_id = $3)
          AND i.status = 'ready' AND o.status NOT IN ${SETTLED_SQL}
        RETURNING i.order_id`,
      [ids, user.restaurantId, user.id, everyone]
    );
    if (done.rowCount === 0) throw new AppError(409, 'nothing_ready', 'These items are not ready to deliver');
    const fresh = [];
    for (const orderId of new Set(done.rows.map((r) => r.order_id))) {
      fresh.push(await refreshOrder(client, user.restaurantId, orderId));
    }
    return { orders: fresh, delivered: done.rowCount };
  });
  for (const order of orders) await publishOrder(order);
  return { delivered, orders };
});

module.exports = { lockOwnOrder, checkOwner, CLOSED };
