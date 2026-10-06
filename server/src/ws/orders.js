// Waiter order actions: create, add items, edit, remove, deliver.
// The edit rules live here, on the server, so a tampered or stale app can never get around them.
const db = require('../db');
const { AppError } = require('../errors');
const { getOrder, refreshOrder, audit } = require('../orders');
const ws = require('./events');
const { publishOrder } = require('./publish');

const fail = (code, message) => new AppError(400, code, message);
const LOCKED = 'The kitchen has started this item. Only a manager can cancel it now.';

// Chips every dish offers on top of its own, e.g. "pack this one to take away".
const EXTRA_CHIPS = ['Parcel'];

// Trims free text and cuts it to a sensible length. Empty becomes null.
const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;

async function loadMenu(client, restaurantId, lines) {
  const ids = [...new Set(lines.map((l) => Number(l.menuItemId)))].filter(Number.isInteger);
  const { rows } = await client.query('SELECT * FROM menu_items WHERE restaurant_id = $1 AND id = ANY($2::int[])', [
    restaurantId,
    ids,
  ]);
  return new Map(rows.map((m) => [m.id, m]));
}

// Checks one requested dish against the menu and returns what will be saved.
// Names and prices always come from the menu, never from the app.
function resolveLine(item, line, { mustBeAvailable = true } = {}) {
  if (!item) throw fail('unknown_item', 'An item in this order is no longer on the menu');
  if (mustBeAvailable && !item.available) throw new AppError(409, 'item_unavailable', `${item.name} is unavailable right now`);

  const qty = Number(line.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw fail('bad_qty', `Check the quantity of ${item.name}`);

  let size = null;
  let unitPrice = item.price;
  if (item.sizes.length > 0) {
    const chosen = item.sizes.find((s) => s.label === line.size);
    if (!chosen) throw fail('bad_size', `Choose a size for ${item.name}`);
    size = chosen.label;
    unitPrice = Number(chosen.price);
  }

  // Only the chips this dish offers are kept; anything else belongs in the note.
  const asked = Array.isArray(line.customisations) ? line.customisations : [];
  const customisations = [...item.customisations, ...EXTRA_CHIPS].filter((c) => asked.includes(c));

  return { item, size, qty, unitPrice, customisations, note: text(line.note, 200), allergyNote: text(line.allergyNote, 120) };
}

async function insertItems(client, orderId, items) {
  for (const i of items) {
    await client.query(
      `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, veg, size, qty, unit_price,
                                customisations, note, allergy_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [orderId, i.item.id, i.item.name, i.item.veg, i.size, i.qty, i.unitPrice, i.customisations, i.note, i.allergyNote]
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

// Locks an open order for this transaction and checks it belongs to this waiter.
async function lockOwnOrder(client, user, orderId) {
  const { rows } = await client.query(
    `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ('closed', 'cancelled') FOR UPDATE`,
    [orderId, user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_order', 'This order is no longer open');
  if (rows[0].waiter_id !== user.id) throw new AppError(403, 'not_your_order', 'This order belongs to another waiter');
  return rows[0];
}

// Locks one dish (and its order) and checks the order belongs to this waiter.
async function lockOwnItem(client, user, itemId) {
  const { rows } = await client.query(
    `SELECT i.*, o.waiter_id
       FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.id = $1 AND o.restaurant_id = $2 AND o.status NOT IN ('closed', 'cancelled')
        FOR UPDATE OF i, o`,
    [itemId, user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_item', 'This item is no longer on an open order');
  if (rows[0].waiter_id !== user.id) throw new AppError(403, 'not_your_order', 'This order belongs to another waiter');
  return rows[0];
}

// order.create { type, tableId?, guests?, customerName?, customerPhone?, deliveryAddress?, carNumber?,
//                items: [{ menuItemId, size?, qty, customisations?, note?, allergyNote? }] }
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
    if (type === 'dine_in') {
      const table = await client.query('SELECT * FROM tables WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [
        payload.tableId,
        restaurantId,
      ]);
      if (!table.rows[0]) throw fail('no_table', 'Choose a table');
      if (table.rows[0].locked_by !== user.id) throw new AppError(409, 'table_not_yours', 'This table is not yours');
      if (table.rows[0].status !== 'occupied') throw new AppError(409, 'table_has_order', 'This table already has an order');
      tableId = table.rows[0].id;
    }

    const menu = await loadMenu(client, restaurantId, lines);
    const items = lines.map((line) => resolveLine(menu.get(Number(line.menuItemId)), line));

    const numbered = await client.query(
      'UPDATE restaurants SET next_order_number = next_order_number + 1 WHERE id = $1 RETURNING next_order_number - 1 AS number',
      [restaurantId]
    );
    const guests = Number.isInteger(payload.guests) && payload.guests > 0 ? payload.guests : null;
    const inserted = await client.query(
      `INSERT INTO orders (restaurant_id, number, client_id, type, table_id, guests, customer_name, customer_phone,
                           delivery_address, car_number, waiter_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
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
    await insertItems(client, orderId, items);

    const created = await refreshOrder(client, restaurantId, orderId);
    await audit(client, {
      restaurantId,
      userId: user.id,
      action: 'order.create',
      entity: 'order',
      entityId: orderId,
      new: { number: created.number, type, items: items.length, total: created.total },
    });
    return created;
  });

  await publishOrder(order, { created: true });
  return order;
});

// order.addItems { orderId, items, replacesItemId? } — more dishes on an order that is already with
// the kitchen. Allowed until the order is paid. With replacesItemId, the new dishes stand in for a
// dish the chef could not make, and that dish is taken off the order.
ws.on('order.addItems', async (user, payload) => {
  ws.need(user, 'waiter');
  const lines = readLines(payload);
  const order = await db.tx(async (client) => {
    await lockOwnOrder(client, user, payload.orderId);
    if (payload.replacesItemId) {
      const replaced = await client.query(
        `UPDATE order_items SET status = 'removed', updated_at = now() WHERE id = $1 AND order_id = $2 AND status = 'unavailable'`,
        [payload.replacesItemId, payload.orderId]
      );
      if (replaced.rowCount === 0) throw new AppError(409, 'not_unavailable', 'That item is no longer waiting to be replaced');
    }
    const menu = await loadMenu(client, user.restaurantId, lines);
    const items = lines.map((line) => resolveLine(menu.get(Number(line.menuItemId)), line));
    await insertItems(client, payload.orderId, items);
    // New dishes mean the bill is open again.
    await client.query('UPDATE orders SET at_counter = false WHERE id = $1', [payload.orderId]);
    const fresh = await refreshOrder(client, user.restaurantId, payload.orderId);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'order.addItems',
      entity: 'order',
      entityId: fresh.id,
      new: { items: items.map((i) => `${i.qty}× ${i.item.name}`), replacesItemId: payload.replacesItemId || undefined },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// item.edit { itemId, size?, qty, customisations?, note?, allergyNote? }
// Only while the dish is Sent or Accepted. Once the chef starts preparing it, it is locked.
ws.on('item.edit', async (user, payload) => {
  ws.need(user, 'waiter');
  const order = await db.tx(async (client) => {
    const item = await lockOwnItem(client, user, payload.itemId);
    if (!['sent', 'accepted'].includes(item.status)) throw new AppError(409, 'locked', LOCKED);

    const menu = await loadMenu(client, user.restaurantId, [{ menuItemId: item.menu_item_id }]);
    const next = resolveLine(menu.get(item.menu_item_id), payload, { mustBeAvailable: false });
    await client.query(
      `UPDATE order_items
          SET size = $2, qty = $3, unit_price = $4, customisations = $5, note = $6, allergy_note = $7, updated_at = now()
        WHERE id = $1`,
      [item.id, next.size, next.qty, next.unitPrice, next.customisations, next.note, next.allergyNote]
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
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// item.remove { itemId } — a dish that is Sent, Accepted, or that the chef marked Unavailable.
ws.on('item.remove', async (user, payload) => {
  ws.need(user, 'waiter');
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
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// waiter.deliver { itemIds } — ready dishes handed to the customer. Dishes from several orders at once is fine.
ws.on('waiter.deliver', async (user, payload) => {
  ws.need(user, 'waiter');
  const ids = [...new Set(Array.isArray(payload.itemIds) ? payload.itemIds.map(Number) : [])].filter(Number.isInteger);
  if (ids.length === 0) throw fail('no_items', 'Select items to deliver');

  const { orders, delivered } = await db.tx(async (client) => {
    const done = await client.query(
      `UPDATE order_items i SET status = 'delivered', updated_at = now()
         FROM orders o
        WHERE i.id = ANY($1::int[]) AND o.id = i.order_id AND o.restaurant_id = $2 AND o.waiter_id = $3
          AND i.status = 'ready' AND o.status NOT IN ('closed', 'cancelled')
        RETURNING i.order_id`,
      [ids, user.restaurantId, user.id]
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

module.exports = { lockOwnOrder };
