// Close Table by a waiter who does not take payment (2.0.3, the client's rule): that waiter never
// sees an amount; when every dish is served they close the table, the bill goes to the counter and
// the table is free at once. The order is locked from then on. A manager can reopen it on its table
// while the table is still free and the bill unpaid; after that, extra dishes go on a new order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAll, signIn } = require('./helpers');

let env;
let manager;
let maya; // waiter who takes payment
let amit; // waiter set to "Close table only"
let sanjay; // chef
let dish;

async function newTable(label) {
  const made = await manager.post('/tables', { label, seats: 4, area_id: 1 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data.table;
}
// A party seated by this waiter, their two dishes cooked and served.
async function served(waiter, table) {
  await waiter.send('table.lock', { tableId: table.id });
  const order = await waiter.send('order.create', { type: 'dine_in', tableId: table.id, guests: 2, items: [{ menuItemId: dish.id, qty: 2 }] });
  await sanjay.send('chef.accept', { orderId: order.id });
  await sanjay.send('chef.start', { orderId: order.id });
  const ready = await sanjay.send('chef.allReady', { orderId: order.id });
  await waiter.send('waiter.deliver', { itemIds: ready.items.map((i) => i.id) });
  return order;
}
const office = async () => (await manager.get('/sync')).data;
const tableIn = (sync, table) => sync.tables.find((t) => t.id === table.id);
const orderIn = (sync, order) => sync.orders.find((o) => o.id === order.id);

test.before(async () => {
  env = await startAll();
  manager = await signIn(env.base, 'M-102', 'manager');
  maya = await signIn(env.base, 'W-104', 'waiter');
  amit = await signIn(env.base, 'W-105', 'waiter');
  sanjay = await signIn(env.base, 'C-103', 'chef');
  dish = (await manager.get('/menu')).data.items.find((m) => m.code === 'STR01');
});

test.after(async () => {
  for (const who of [manager, maya, amit, sanjay]) who?.close?.();
  await env.stop();
});

test('a waiter who does not take payment is never sent an amount: no dish prices, no bill', async () => {
  const perms = (await amit.get('/me')).data.user.permissions;
  assert.equal(perms['bills.view'], false);
  assert.equal(perms['prices.view'], false);
  assert.equal((await maya.get('/me')).data.user.permissions['bills.view'], true);

  const menuDish = (await amit.get('/menu')).data.items.find((m) => m.id === dish.id);
  assert.equal(menuDish.price, undefined);

  const table = await newTable('CT1');
  await amit.send('table.lock', { tableId: table.id });
  const order = await amit.send('order.create', { type: 'dine_in', tableId: table.id, guests: 2, items: [{ menuItemId: dish.id, qty: 2 }] });
  // The answer to their own action, the live update and a fresh sync all leave the money out.
  assert.equal(order.total, null);
  assert.equal(order.items[0].unit_price, undefined);
  const event = amit.events.filter((e) => e.type === 'order.created' && e.payload.id === order.id).pop();
  assert.equal(event.payload.total, null);
  const mine = (await amit.get('/sync')).data;
  assert.equal(mine.orders.find((o) => o.id === order.id).total, null);
  assert.equal(mine.tables.find((t) => t.id === table.id).order_total, null);
  // The manager and a waiter who takes payment still see the bill.
  assert.ok(orderIn(await office(), order).total > 0);
  assert.ok((await maya.get('/sync')).data.tables.find((t) => t.id === table.id).order_total > 0);
});

test('Close Table: the bill goes to the counter, the table is free at once, and the order is locked', async () => {
  const table = await newTable('CT2');
  const order = await served(amit, table);

  const closed = await amit.send('order.handover', { orderId: order.id });
  assert.ok(closed.handed_over_at);
  assert.ok(closed.bill_requested_at);
  assert.equal(closed.total, null); // still no amount for Amit

  const now = await office();
  assert.equal(tableIn(now, table).status, 'free');
  assert.equal(tableIn(now, table).order_id, null);
  const queued = orderIn(now, order);
  assert.ok(queued.bill_requested_at && queued.at_counter && queued.total > 0); // in the manager's Payments

  for (const [type, payload] of [
    ['order.addItems', { orderId: order.id, items: [{ menuItemId: dish.id, qty: 1 }] }],
    ['bill.request', { orderId: order.id }],
    ['order.handover', { orderId: order.id }],
    ['approval.request', { type: 'cancel', orderId: order.id, itemId: order.items[0].id, payload: { reason: 'Customer changed mind' } }],
  ]) {
    assert.equal((await amit.try(type, payload)).error, 'order_closed', type);
  }
  // A new party can sit at the table straight away.
  await maya.send('table.lock', { tableId: table.id });
  await maya.send('table.release', { tableId: table.id });
});

test('Close Table waits until every dish is served, and only the order\'s own waiter closes it', async () => {
  const table = await newTable('CT3');
  await amit.send('table.lock', { tableId: table.id });
  const order = await amit.send('order.create', { type: 'dine_in', tableId: table.id, guests: 1, items: [{ menuItemId: dish.id, qty: 1 }] });
  assert.equal((await amit.try('order.handover', { orderId: order.id })).error, 'not_all_delivered');
  // Only the order's own waiter (or someone who manages every order) closes it.
  assert.equal((await maya.try('order.handover', { orderId: order.id })).error, 'not_your_order');
});

test('the manager reopens a closed table while it is still free; the waiter can add dishes again', async () => {
  const table = await newTable('CT4');
  const order = await served(amit, table);
  await amit.send('order.handover', { orderId: order.id });

  assert.equal((await amit.try('order.reopen', { orderId: order.id })).error, 'forbidden'); // a manager's power
  const reopened = await manager.send('order.reopen', { orderId: order.id });
  assert.equal(reopened.handed_over_at, null);
  assert.equal(reopened.bill_requested_at, null); // out of the payment queue until closed again
  const now = await office();
  assert.equal(tableIn(now, table).status, 'all_delivered');
  assert.equal(tableIn(now, table).order_id, order.id);
  assert.equal(tableIn(now, table).locked_by, amit.user.id);

  const more = await amit.send('order.addItems', { orderId: order.id, items: [{ menuItemId: dish.id, qty: 1 }] });
  assert.equal(more.items.length, 2);
  assert.equal((await manager.try('order.reopen', { orderId: order.id })).error, 'not_closed');
});

test('no reopening after new guests sit down or a newer order is placed on the table', async () => {
  const table = await newTable('CT5');
  const first = await served(amit, table);
  await amit.send('order.handover', { orderId: first.id });

  // New guests being seated: refused. Seated and left again without ordering: allowed.
  await amit.send('table.lock', { tableId: table.id });
  const busy = await manager.try('order.reopen', { orderId: first.id });
  assert.equal(busy.error, 'table_taken');
  assert.match(busy.message, /CT5 has new guests/);
  await amit.send('table.release', { tableId: table.id });
  await manager.send('order.reopen', { orderId: first.id });
  await amit.send('order.handover', { orderId: first.id });

  // A newer order on the table: refused, even once that order's table is closed and free again.
  const second = await served(amit, table);
  await amit.send('order.handover', { orderId: second.id });
  assert.equal(tableIn(await office(), table).status, 'free');
  assert.equal((await manager.try('order.reopen', { orderId: first.id })).error, 'table_taken');
});

test('paying a closed table finishes its order without touching the table, which may hold new guests', async () => {
  const table = await newTable('CT6');
  const first = await served(amit, table);
  await amit.send('order.handover', { orderId: first.id });
  const next = await served(amit, table); // new guests at the same table

  const due = orderIn(await office(), first).total;
  const paid = await manager.send('payment.add', { orderId: first.id, method: 'cash', amount: due, received: due });
  assert.equal(paid.status, 'closed');
  const now = await office();
  assert.equal(tableIn(now, table).order_id, next.id);
  assert.equal(tableIn(now, table).status, 'all_delivered');
  assert.equal((await manager.try('order.reopen', { orderId: first.id })).error, 'not_closed'); // paid: a new order instead
});

test('a waiter set to "No access" cannot close a table', async () => {
  const table = await newTable('CT7');
  const order = await served(amit, table);
  const changed = await manager.patch(`/users/${amit.user.id}`, { payment_access: 'none' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const none = await signIn(env.base, 'W-105', 'waiter');
  try {
    assert.equal((await none.try('order.handover', { orderId: order.id })).error, 'forbidden');
    assert.equal((await none.get('/me')).data.user.permissions['bills.view'], false);
  } finally {
    none.close();
    await manager.patch(`/users/${amit.user.id}`, { payment_access: 'close' });
  }
});
