// Splitting a table when guests are already seated. The party stays together on the first part
// with exactly its seats, and only the free seats make further parts: a table of 4 with 2 guests
// becomes 2 + 2 or 2 + 1 + 1, never four parts. The order, its dishes, tickets, prices, discount
// and payments stay exactly as they were. Splitting the bill (moving dishes to another part)
// keeps its own rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAll, signIn } = require('./helpers');

let env;
let manager;
let maya; // waiter in Main Hall
let amit; // waiter everywhere
let sanjay; // chef
let dish;

// Each case has a table of its own in Main Hall.
async function newTable(label, seats) {
  const made = await manager.post('/tables', { label, seats, area_id: 1 });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data.table;
}
// A party seated at a table with two of a dish sent to the kitchen (no guest count when guests is 0).
async function seat(waiter, table, guests) {
  await waiter.send('table.lock', { tableId: table.id });
  return waiter.send('order.create', { type: 'dine_in', tableId: table.id, ...(guests ? { guests } : {}), items: [{ menuItemId: dish.id, qty: 2 }] });
}
const parts = (...seats) => seats.map((n) => ({ seats: n }));
const even = (total, count) => Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
const state = async () => (await manager.get('/sync')).data;
const partsOf = (tables, table) => tables.filter((x) => x.parent_table_id === table.id);

test.before(async () => {
  env = await startAll();
  manager = await signIn(env.base, 'M-102', 'manager');
  maya = await signIn(env.base, 'W-104', 'waiter');
  amit = await signIn(env.base, 'W-105', 'waiter');
  sanjay = await signIn(env.base, 'C-103', 'chef');
  dish = (await maya.get('/menu')).data.items.find((m) => m.code === 'STR01');
});

test.after(async () => {
  for (const who of [manager, maya, amit, sanjay]) who?.close?.();
  await env.stop();
});

test('four seats, two guests together: 2 + 2 and 2 + 1 + 1 are allowed, four parts are not', async () => {
  const table = await newTable('S4A', 4);
  const order = await seat(maya, table, 2);
  for (const seats of [[2, 2], [2, 1, 1]]) {
    const preview = await maya.send('table.split', { tableId: table.id, parts: parts(...seats), preview: true });
    assert.deepEqual(preview.parts.map((p) => p.seats), seats);
    assert.equal(preview.parts[0].order_id, order.id); // the party and its order on the first part
    assert.deepEqual(preview.parts.slice(1).map((p) => p.free), seats.slice(1).map(() => true));
  }
  const four = await maya.try('table.split', { tableId: table.id, parts: parts(1, 1, 1, 1) });
  assert.equal(four.error, 'bad_parts');
  assert.match(four.message, /2 to 3 tables/);
  assert.equal((await maya.try('table.split', { tableId: table.id, parts: parts(1, 3) })).error, 'party_seats');
  assert.equal((await maya.try('table.split', { tableId: table.id, parts: parts(3, 1) })).error, 'party_seats');
  // An older app that divided the two people between the parts is refused; the party stays 2.
  const old = await maya.try('table.split', { tableId: table.id, parts: [{ seats: 1, guests: 1 }, { seats: 3, guests: 1 }] });
  assert.equal(old.error, 'party_seats');
  // Nothing of the refused or previewed splits was saved.
  const now = await state();
  assert.equal(now.orders.find((o) => o.id === order.id).guests, 2);
  assert.equal(now.tables.find((t) => t.id === table.id).status, 'order_placed');
  assert.equal(partsOf(now.tables, table).length, 0);
});

test('the split keeps the order, its dishes, tickets, prices, discount and payments exactly as they were', async () => {
  const table = await newTable('S4B', 4);
  let order = await seat(maya, table, 2);
  await sanjay.send('chef.accept', { orderId: order.id });
  await sanjay.send('chef.start', { orderId: order.id });
  const ready = await sanjay.send('chef.allReady', { orderId: order.id });
  await maya.send('waiter.deliver', { itemIds: ready.items.map((i) => i.id) });
  await manager.send('discount.apply', { orderId: order.id, type: 'pct', value: 5, reason: 'Regular guest' });
  order = await maya.send('payment.add', { orderId: order.id, method: 'cash', amount: 100, received: 100 });
  const before = (await manager.get(`/orders/${order.id}`)).data.order;
  assert.equal(before.paid_total, 100);
  assert.ok(before.discount_amount > 0);

  const done = await maya.send('table.split', { tableId: table.id, parts: parts(2, 1, 1) });
  assert.deepEqual(done.parts.map((p) => [p.table_label, p.seats, p.free]), [['S4B.1', 2, false], ['S4B.2', 1, true], ['S4B.3', 1, true]]);

  const after = (await manager.get(`/orders/${order.id}`)).data.order;
  const line = (i) => [i.id, i.qty, i.unit_price, i.status, i.kot_id];
  assert.equal(after.table_label, 'S4B.1');
  assert.deepEqual(after.items.map(line), before.items.map(line));
  for (const key of ['number', 'subtotal', 'discount_amount', 'tax_total', 'round_off', 'total', 'paid_total', 'guests']) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.payments.map((p) => [p.id, p.amount, p.method]), before.payments.map((p) => [p.id, p.amount, p.method]));
  let now = await state();
  assert.equal(now.orders.filter((o) => String(o.table_label).startsWith('S4B')).length, 1); // no new bill
  assert.equal(now.tables.find((t) => t.id === table.id).status, 'split');

  // The same request again changes nothing: the table is split and its first part is in use.
  const again = await maya.try('table.split', { tableId: table.id, parts: parts(2, 1, 1) });
  assert.equal(again.ok, false);
  now = await state();
  assert.equal(partsOf(now.tables, table).length, 3);
  assert.equal(now.orders.filter((o) => String(o.table_label).startsWith('S4B')).length, 1);

  // A part with a payment on its bill is not merged (that bill is history). The party pays the
  // rest and leaves: the bill adds up to what it always was, and the table is whole again.
  assert.match((await maya.try('table.merge', { tableIds: partsOf(now.tables, table).map((t) => t.id) })).message, /payment/);
  const paid = await maya.send('payment.add', { orderId: order.id, method: 'upi', close: true });
  assert.equal(paid.total, before.total);
  assert.equal(paid.paid_total, before.total);
  assert.deepEqual(paid.items.map(line), before.items.map(line));
  now = await state();
  assert.equal(partsOf(now.tables, table).length, 0);
  assert.equal(now.tables.find((t) => t.id === table.id).status, 'free');
});

test('six seats, two guests: 2 to 5 parts, made from the four free seats', async () => {
  const table = await newTable('S6A', 6);
  await seat(maya, table, 2);
  for (const count of [2, 3, 4, 5]) {
    const seats = [2, ...even(4, count - 1)];
    const preview = await maya.send('table.split', { tableId: table.id, parts: parts(...seats), preview: true });
    assert.deepEqual(preview.parts.map((p) => p.seats), seats, `${count} parts`);
  }
  // The free seats may be shared unevenly between the new parts.
  assert.equal((await maya.send('table.split', { tableId: table.id, parts: parts(2, 3, 1), preview: true })).parts.length, 3);
  const six = await maya.try('table.split', { tableId: table.id, parts: parts(1, 1, 1, 1, 1, 1) });
  assert.equal(six.error, 'bad_parts');
  assert.match(six.message, /2 to 5 tables/);
});

test('four seats, three guests together: only 3 + 1', async () => {
  const table = await newTable('S4C', 4);
  await seat(maya, table, 3);
  assert.deepEqual((await maya.send('table.split', { tableId: table.id, parts: parts(3, 1), preview: true })).parts.map((p) => p.seats), [3, 1]);
  assert.equal((await maya.try('table.split', { tableId: table.id, parts: parts(2, 2) })).error, 'party_seats');
  const three = await maya.try('table.split', { tableId: table.id, parts: parts(2, 1, 1) });
  assert.equal(three.error, 'bad_parts');
  assert.match(three.message, /into 2 tables/);
});

test('four seats, four guests together: there are no free seats to split off', async () => {
  const table = await newTable('S4D', 4);
  await seat(maya, table, 4);
  for (const seats of [[2, 2], [3, 1], [1, 1, 1, 1]]) {
    assert.equal((await maya.try('table.split', { tableId: table.id, parts: parts(...seats) })).error, 'no_free_seats');
  }
  assert.equal(partsOf((await state()).tables, table).length, 0);
});

test('a table nobody sits at is split by seats as before', async () => {
  const table = await newTable('S4E', 4);
  for (const seats of [[1, 1, 1, 1], [2, 2], [3, 1]]) {
    const preview = await manager.send('table.split', { tableId: table.id, parts: parts(...seats), preview: true });
    assert.deepEqual(preview.parts.map((p) => [p.seats, p.free]), seats.map((n) => [n, true]));
  }
});

test('an order with no guest count takes the count the app gives, else counts as one guest', async () => {
  const one = await newTable('S4F', 4);
  const order = await seat(amit, one, 0);
  assert.equal(order.guests, null);
  assert.deepEqual((await amit.send('table.split', { tableId: one.id, parts: parts(1, 1, 1, 1), preview: true })).parts.length, 4);
  assert.equal((await amit.try('table.split', { tableId: one.id, parts: parts(2, 2) })).error, 'party_seats');

  const two = await newTable('S4G', 4);
  const second = await seat(amit, two, 0);
  assert.equal((await amit.try('table.split', { tableId: two.id, parts: [{ seats: 2, guests: 2 }, { seats: 1 }, { seats: 1 }] })).ok, true);
  assert.equal((await manager.get(`/orders/${second.id}`)).data.order.guests, 2);
});

test('re-cutting a split table: a part with guests keeps at least their seats', async () => {
  const table = await newTable('S6B', 6);
  const order = await seat(maya, table, 2);
  const first = await maya.send('table.split', { tableId: table.id, parts: parts(2, 4) });
  const [p1, p2] = first.parts.map((p) => p.table_id);
  assert.equal((await maya.try('table.split', { tableId: table.id, parts: [{ id: p1, seats: 1 }, { id: p2, seats: 5 }] })).error, 'party_seats');
  const roomier = await maya.send('table.split', { tableId: table.id, parts: [{ id: p1, seats: 3 }, { id: p2, seats: 3 }] });
  assert.deepEqual(roomier.parts.map((p) => p.seats), [3, 3]);
  const more = await maya.send('table.split', { tableId: table.id, parts: [{ id: p1, seats: 2 }, { id: p2, seats: 2 }, { seats: 1 }, { seats: 1 }] });
  assert.deepEqual(more.parts.map((p) => [p.seats, p.free]), [[2, false], [2, true], [1, true], [1, true]]);
  assert.equal((await manager.get(`/orders/${order.id}`)).data.order.table_id, p1);
});

test('splitting the bill (dishes moved to another part) keeps its own rules', async () => {
  const table = await newTable('S4H', 4);
  const order = await seat(maya, table, 2);
  const split = await maya.send('table.split', { tableId: table.id, parts: [{ seats: 1 }, { seats: 3, items: [{ itemId: order.items[0].id, qty: 1 }] }] });
  assert.deepEqual(split.parts.map((p) => [p.seats, p.free]), [[1, false], [3, false]]);
  const now = await state();
  assert.equal(now.orders.filter((o) => String(o.table_label).startsWith('S4H')).length, 2); // two bills
});
