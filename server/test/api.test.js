// The server's business rules, tested through the real server against a throwaway database:
// who may do what, kitchen routing, payments, split / merge / join / transfer, floors, the PIN,
// sessions and imports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startAll, signIn, call, live, PIN } = require('./helpers');

let env;
let admin;
let manager;
let maya; // waiter: Main Hall and Open Air (rooftop) only, may take payments
let amit; // waiter: everywhere, sends bills to the manager
let neha; // cashier: discount limit 10%
let sanjay; // chef at every terminal
let vikram; // chef at the tandoor only
let menu;
let tables;
const item = (code) => menu.find((m) => m.code === code);
const table = (label) => tables.find((t) => t.label === label);
const refreshTables = async () => { tables = (await manager.get('/sync')).data.tables; };

// Sends an order from a waiter and walks it through the kitchen to "everything served".
async function servedOrder(waiter, label, lines, guests = 2) {
  await waiter.send('table.lock', { tableId: table(label).id });
  let order = await waiter.send('order.create', { type: 'dine_in', tableId: table(label).id, guests, items: lines });
  await sanjay.send('chef.accept', { orderId: order.id });
  await sanjay.send('chef.start', { orderId: order.id });
  order = await sanjay.send('chef.allReady', { orderId: order.id });
  const served = await waiter.send('waiter.deliver', { itemIds: order.items.map((i) => i.id) });
  return served.orders[0];
}

test.before(async () => {
  env = await startAll();
  admin = await signIn(env.base, 'A-101', 'admin');
  manager = await signIn(env.base, 'M-102', 'manager');
  maya = await signIn(env.base, 'W-104', 'waiter');
  amit = await signIn(env.base, 'W-105', 'waiter');
  neha = await signIn(env.base, 'K-106', 'cashier');
  sanjay = await signIn(env.base, 'C-103', 'chef');
  vikram = await signIn(env.base, 'C-107', 'chef');
  menu = (await maya.get('/menu')).data.items;
  await refreshTables();
});

test.after(async () => {
  for (const who of [admin, manager, maya, amit, neha, sanjay, vikram]) who?.close?.();
  await env.stop();
});

test('roles get their preset permissions; a cashier may sign in at the manager desk', async () => {
  assert.equal(admin.user.permissions['settings.manage'], true);
  assert.equal(manager.user.permissions['settings.manage'], false);
  assert.equal(manager.user.permissions['approvals.decide'], true);
  assert.deepEqual(Object.entries(neha.user.permissions).filter(([, v]) => v).map(([k]) => k).sort(), ['bills.view', 'orders.view', 'payments.collect', 'prices.view', 'tables.close']);
  assert.equal(maya.user.permissions['payments.collect'], true);
  assert.equal(amit.user.permissions['payments.collect'], false);
  const asManager = await signIn(env.base, 'K-106', 'manager', { live: false });
  assert.equal(asManager.user.role, 'cashier');
});

test('permissions are enforced by the server, not by hidden buttons', async () => {
  assert.equal((await neha.patch(`/menu/items/${item('STR01').id}`, { price: 1 })).status, 403);
  assert.equal((await maya.get('/users')).status, 403);
  assert.equal((await maya.get('/reports/overview')).status, 403);
  assert.equal((await manager.patch('/restaurant', { name: 'Hacked' })).status, 403);
  assert.equal((await manager.get('/audit')).status, 403);
  assert.equal((await admin.get('/audit')).status, 200);
  assert.equal((await maya.try('approval.decide', { approvalId: 1, approve: false })).error, 'forbidden');
  assert.equal((await neha.try('table.split', { tableId: table('T1').id, parts: [{ seats: 2 }, { seats: 2 }] })).error, 'forbidden');
});

test('a waiter can only take the tables they are assigned', async () => {
  assert.equal((await maya.try('table.lock', { tableId: table('T11').id })).error, 'table_not_assigned'); // First Floor
  assert.equal((await maya.try('table.lock', { tableId: table('R1').id })).ok, true); // Rooftop
  await maya.send('table.release', { tableId: table('R1').id });
  assert.equal((await amit.try('table.lock', { tableId: table('T11').id })).ok, true);
  await amit.send('table.release', { tableId: table('T11').id });
});

test('dishes go to their terminals as separate KOTs, with tax saved on each line', async () => {
  await maya.send('table.lock', { tableId: table('T1').id });
  const order = await maya.send('order.create', {
    type: 'dine_in', tableId: table('T1').id, guests: 2,
    items: [{ menuItemId: item('IMC11').id, size: 'Full', qty: 1 }, { menuItemId: item('BRD02').id, qty: 2 }, { menuItemId: item('DRK01').id, qty: 1 }],
  });
  assert.equal(new Set(order.items.map((i) => i.terminal_id)).size, 3);
  assert.equal(new Set(order.items.map((i) => i.kot_number)).size, 3);
  assert.ok(order.items.every((i) => i.tax_rate === 5 && i.tax_mode === 'exclusive'));
  assert.equal(order.subtotal, 530);
  assert.equal(order.tax_total, 26.5);
  assert.equal(order.total, 557); // 556.50 rounded
  assert.equal(order.guests, 2);

  // The tandoor chef accepts and cooks only the tandoor's dishes.
  let seen = await vikram.send('chef.accept', { orderId: order.id });
  assert.deepEqual(seen.items.map((i) => i.status), ['sent', 'accepted', 'sent']);
  const curry = order.items[0];
  await vikram.send('chef.start', { orderId: order.id });
  assert.equal((await vikram.try('chef.itemReady', { itemId: curry.id })).ok, false);
  seen = await vikram.send('chef.allReady', { orderId: order.id });
  assert.deepEqual(seen.items.map((i) => i.status), ['sent', 'ready', 'sent']);

  await sanjay.send('chef.accept', { orderId: order.id });
  await sanjay.send('chef.start', { orderId: order.id });
  seen = await sanjay.send('chef.allReady', { orderId: order.id });
  assert.equal(seen.status, 'ready');
  const served = await maya.send('waiter.deliver', { itemIds: seen.items.map((i) => i.id) });
  assert.equal(served.orders[0].status, 'delivered');
});

test('a required add-on must be chosen, and add-on prices come from the menu', async () => {
  await maya.send('table.lock', { tableId: table('T2').id });
  const base = { type: 'dine_in', tableId: table('T2').id };
  const without = await maya.try('order.create', { ...base, items: [{ menuItemId: item('RIC03').id, size: 'Full', qty: 1 }] });
  assert.equal(without.error, 'addon_required');
  const order = await maya.send('order.create', {
    ...base,
    items: [{ menuItemId: item('RIC03').id, size: 'Full', qty: 1, addons: [{ group: 'Served with', name: 'Raita' }, { group: 'Add Ons', name: 'Boiled Egg', price: 0 }] }],
  });
  assert.equal(order.items[0].unit_price, 320); // 300 + 20, whatever price the app sent
  assert.deepEqual(order.items[0].addons.map((a) => a.name), ['Raita', 'Boiled Egg']);
  await maya.send('item.remove', { itemId: order.items[0].id }); // every dish removed: the order is cancelled and the table freed
  await refreshTables();
  assert.equal(table('T2').status, 'free');
});

test('discounts: within the limit at once, above it only with an approved request and the PIN', async () => {
  await refreshTables();
  const order = (await manager.get('/sync')).data.orders.find((o) => o.table_label === 'T1');
  assert.equal((await maya.try('discount.apply', { orderId: order.id, type: 'pct', value: 3 })).error, 'no_reason');
  const small = await maya.send('discount.apply', { orderId: order.id, type: 'pct', value: 3, reason: 'Regular customer' });
  assert.equal(small.discount_amount, 15.9);
  assert.equal((await maya.try('discount.apply', { orderId: order.id, type: 'amount', value: 100, reason: 'Birthday' })).error, 'above_limit');
  assert.equal((await neha.try('discount.apply', { orderId: order.id, type: 'pct', value: 15, reason: 'Birthday' })).error, 'above_limit');

  const request = await maya.send('approval.request', { type: 'discount', orderId: order.id, payload: { type: 'amount', value: 100, reason: 'Birthday' } });
  assert.equal(request.payload.total_after, 452); // (530 - 100) + 5% = 451.50
  // While the request waits the old discount still stands, and the bill cannot be settled.
  assert.equal((await maya.try('payment.add', { orderId: order.id, method: 'cash' })).error, 'approval_pending');
  assert.equal((await manager.try('approval.decide', { approvalId: request.id, approve: true, pin: '000000' })).error, 'wrong_pin');
  const decided = await manager.send('approval.decide', { approvalId: request.id, approve: true, pin: PIN });
  assert.equal(decided.status, 'approved');
  const after = (await manager.get(`/orders/${order.id}`)).data;
  assert.equal(after.order.discount_amount, 100);
  assert.equal(after.order.total, 452);
  assert.ok(after.audit.some((a) => a.action === 'discount.approved' && a.user_role === 'manager'));
});

test('payment: a failed try closes nothing, parts add up, and only full payment marks the bill paid', async () => {
  const order = (await manager.get('/sync')).data.orders.find((o) => o.table_label === 'T1');
  await maya.send('bill.request', { orderId: order.id });
  await refreshTables();
  assert.equal(table('T1').status, 'needs_payment');

  let bill = await neha.send('payment.add', { orderId: order.id, method: 'upi', amount: 452, status: 'failed' });
  assert.equal(bill.status, 'delivered');
  assert.equal(bill.paid_total, 0);
  assert.equal((await neha.try('payment.add', { orderId: order.id, method: 'cash', amount: 500 })).error, 'overpaid');
  assert.equal((await neha.try('payment.add', { orderId: order.id, method: 'cash', amount: 200, received: 100 })).error, 'short_cash');
  assert.equal((await neha.try('payment.add', { orderId: order.id, method: 'bitcoin', amount: 10 })).error, 'bad_method');

  bill = await neha.send('payment.add', { orderId: order.id, method: 'cash', amount: 200, received: 500 });
  assert.equal(bill.payments.at(-1).change_due, 300);
  assert.equal(bill.status, 'delivered');
  // The same payment sent twice (a retry) is recorded once.
  const twice = await neha.send('payment.add', { orderId: order.id, method: 'card', amount: 52, reference: 'C-1' }, 'retry-1');
  await neha.send('payment.add', { orderId: order.id, method: 'card', amount: 52, reference: 'C-1' }, 'retry-1');
  assert.equal(twice.paid_total, 252);
  bill = await neha.send('payment.add', { orderId: order.id, method: 'upi', reference: 'UPI-9' });
  assert.equal(bill.status, 'paid');
  assert.equal(bill.payment_method, 'split');
  assert.equal(bill.paid_total, 452);
  await refreshTables();
  assert.equal(table('T1').status, 'paid'); // guests still seated

  // Nothing more can be added to a settled bill.
  assert.equal((await maya.try('order.addItems', { orderId: order.id, items: [{ menuItemId: item('BRD02').id, qty: 1 }] })).error, 'no_order');
});

test('a party can move to a free table at any time; closing the table frees it', async () => {
  const state = (await manager.get('/sync')).data;
  const paid = state.orders.find((o) => o.table_label === 'T1');
  const open = await servedOrder(maya, 'T4', [{ menuItemId: item('STR01').id, qty: 1 }]);
  assert.equal((await maya.try('order.close', { orderId: open.id })).error, 'not_paid');

  assert.equal((await maya.try('table.transfer', { orderId: paid.id, toTableId: table('T4').id })).error, 'not_free');
  assert.equal((await maya.try('table.transfer', { orderId: paid.id, toTableId: table('T11').id })).error, 'table_not_assigned');
  const moved = await maya.send('table.transfer', { orderId: paid.id, toTableId: table('T6').id });
  assert.equal(moved.to, 'T6');
  await refreshTables();
  assert.equal(table('T1').status, 'free');
  assert.equal(table('T6').status, 'paid');
  const closed = await maya.send('order.close', { orderId: paid.id });
  assert.equal(closed.status, 'closed');
  await refreshTables();
  assert.equal(table('T6').status, 'free');

  // A party that is still eating moves too: the new table carries on where the old one was,
  // the dishes keep their kitchen tickets, and another waiter cannot move them.
  assert.equal((await amit.try('table.transfer', { orderId: open.id, toTableId: table('T5').id })).error, 'not_your_order');
  const mid = await maya.send('table.transfer', { orderId: open.id, toTableId: table('T5').id });
  assert.equal(mid.order.table_label, 'T5');
  assert.deepEqual(mid.order.items.map((i) => i.kot_id), open.items.map((i) => i.kot_id));
  await new Promise((resolve) => setTimeout(resolve, 60)); // the kitchen's own message arrives on its own connection
  assert.ok(sanjay.events.some((e) => e.type === 'order.moved' && e.payload.orderId === open.id && e.payload.to === 'T5'));
  await refreshTables();
  assert.equal(table('T4').status, 'free');
  assert.equal(table('T5').status, 'all_delivered');
  await maya.send('table.transfer', { orderId: open.id, toTableId: table('T4').id });

  // Money back on a paid bill: only with permission and the PIN, never more than was paid.
  assert.equal((await neha.try('payment.refund', { orderId: paid.id, amount: 50, reason: 'Cold', pin: PIN })).error, 'forbidden');
  assert.equal((await manager.try('payment.refund', { orderId: paid.id, amount: 5000, reason: 'Cold', pin: PIN })).error, 'bad_amount');
  const refunded = await manager.send('payment.refund', { orderId: paid.id, amount: 52, method: 'cash', reason: 'Cold naan', pin: PIN });
  assert.equal(refunded.payments.filter((p) => p.kind === 'refund').length, 1);
  assert.equal(refunded.total, 452); // the bill itself is history and does not change
});

test('a waiter without payment permission sends the bill to the manager', async () => {
  const order = await servedOrder(amit, 'T12', [{ menuItemId: item('STR01').id, qty: 2 }]);
  assert.equal((await amit.try('payment.add', { orderId: order.id, method: 'cash' })).error, 'no_payment_permission');
  const asked = await amit.send('bill.request', { orderId: order.id });
  assert.equal(asked.at_counter, true);
  // Another waiter cannot touch it; the manager settles it and closes the table in one go.
  assert.equal((await maya.try('payment.add', { orderId: order.id, method: 'cash' })).error, 'not_your_order');
  const done = await manager.send('payment.add', { orderId: order.id, method: 'cash', close: true });
  assert.equal(done.status, 'closed');
  await refreshTables();
  assert.equal(table('T12').status, 'free');
});

test('split with dishes moved: nothing is cooked twice, the bills add up, and merge brings the table back', async () => {
  const order = (await manager.get('/sync')).data.orders.find((o) => o.table_label === 'T4');
  await maya.send('order.addItems', { orderId: order.id, items: [{ menuItemId: item('IMC11').id, size: 'Half', qty: 3 }, { menuItemId: item('DRK03').id, qty: 2 }] });
  let whole = (await manager.get(`/orders/${order.id}`)).data.order;
  const [roll, curry, chaas] = live(whole);
  const kots = whole.items.map((i) => i.kot_id).sort();
  const base = { tableId: table('T4').id }; // T4 has 4 seats

  assert.equal((await maya.try('table.split', { ...base, parts: [{ seats: 1 }, { seats: 1 }] })).error, 'seats_mismatch');
  assert.equal((await maya.try('table.split', { ...base, parts: [{ seats: 4 }] })).error, 'bad_parts');
  assert.equal((await maya.try('table.split', { ...base, parts: [{ seats: 2 }, { seats: 2, items: [{ itemId: curry.id, qty: 4 }] }] })).error, 'over_allocated');
  assert.equal((await maya.try('table.split', { ...base, parts: [{ seats: 2 }, { seats: 2, items: [{ itemId: roll.id, qty: 1 }, { itemId: curry.id, qty: 3 }, { itemId: chaas.id, qty: 2 }] }] })).error, 'empty_part');
  assert.equal((await amit.try('table.split', { ...base, parts: [{ seats: 2 }, { seats: 2 }] })).error, 'not_your_order');

  // The first part keeps the roll and one curry; the second gets a bill of its own.
  const parts = [{ seats: 2, guests: 3 }, { seats: 2, items: [{ itemId: curry.id, qty: 2 }, { itemId: chaas.id, qty: 2 }] }];
  const preview = await maya.send('table.split', { ...base, parts, preview: true });
  await refreshTables();
  assert.equal(table('T4').status, 'order_placed'); // a preview changes nothing
  const done = await maya.send('table.split', { ...base, parts });
  assert.deepEqual(done.parts.map((p) => p.table_label), ['T4.1', 'T4.2']);
  assert.deepEqual(done.parts.map((p) => p.total), preview.parts.map((p) => p.total));
  assert.equal(done.parts.reduce((sum, p) => sum + p.total, 0), whole.total);

  const state = (await manager.get('/sync')).data;
  tables = state.tables;
  assert.equal(table('T4').status, 'split');
  const children = state.orders.filter((o) => ['T4.1', 'T4.2'].includes(o.table_label));
  assert.equal(children.find((o) => o.table_label === 'T4.1').guests, 3); // the people at the first part
  assert.equal(children.length, 2);
  assert.equal(children.find((o) => o.table_label === 'T4.2').parent_order_id, order.id);
  // The dishes kept their tickets and their kitchen status: no new KOT was made by the split.
  assert.deepEqual([...new Set(children.flatMap((o) => o.items.map((i) => i.kot_id)))].sort(), [...new Set(kots)].sort());
  assert.equal(children.flatMap((o) => live(o)).reduce((n, i) => n + i.qty, 0), 6);
  assert.ok(children.find((o) => o.table_label === 'T4.1').items.some((i) => i.status === 'delivered'));

  // A part cannot be joined to another table. Merging the parts gives the one bill back.
  assert.equal((await maya.try('table.merge', { tableIds: [table('T4.1').id, table('T3').id] })).error, 'not_siblings');
  const merged = await maya.send('table.merge', { tableIds: [table('T4.1').id, table('T4.2').id] });
  assert.equal(merged.merged.table_label, 'T4');
  assert.equal(merged.merged.total, whole.total);
  assert.equal(merged.merged.items.reduce((n, i) => n + i.qty, 0), 6);
  assert.equal(merged.merged.items.length, 3); // the line that was cut in two is one line again
  await refreshTables();
  assert.equal(table('T4').status, 'order_placed');
  assert.equal(table('T4').seats, 4);
  assert.equal(tables.filter((t) => t.parent_table_id === table('T4').id).length, 0);
  whole = (await manager.get(`/orders/${order.id}`)).data;
  assert.deepEqual(whole.audit.filter((a) => ['table.split', 'table.merge'].includes(a.action)).map((a) => a.action), ['table.split', 'table.merge']);
});

test('a paid part cannot be merged; the table is whole again when every part has been closed', async () => {
  const order = (await manager.get('/sync')).data.orders.find((o) => o.table_label === 'T4');
  // Finish the kitchen work first, so each part can be billed.
  await sanjay.send('chef.start', { orderId: order.id });
  const ready = await sanjay.send('chef.allReady', { orderId: order.id });
  await maya.send('waiter.deliver', { itemIds: ready.items.filter((i) => i.status === 'ready').map((i) => i.id) });
  const [, curry, chaas] = live(ready);
  await maya.send('table.split', {
    tableId: table('T4').id,
    parts: [{ seats: 1 }, { seats: 3, items: [{ itemId: curry.id, qty: 3 }, { itemId: chaas.id, qty: 2 }] }],
  });
  const state = (await manager.get('/sync')).data;
  tables = state.tables;
  const first = state.orders.find((o) => o.table_label === 'T4.1');
  const second = state.orders.find((o) => o.table_label === 'T4.2');
  // Paid, guests still seated: that bill is history and is never folded into another.
  await maya.send('payment.add', { orderId: first.id, method: 'cash' });
  assert.equal((await maya.try('table.merge', { tableIds: [table('T4.1').id, table('T4.2').id] })).error, 'paid');
  // The first party leaves: its part stands free while the other part is still in use.
  await maya.send('order.close', { orderId: first.id });
  await refreshTables();
  assert.equal(table('T4').status, 'split');
  assert.equal(table('T4.1').status, 'free');
  await maya.send('payment.add', { orderId: second.id, method: 'upi', close: true });
  await refreshTables();
  assert.equal(table('T4').status, 'free');
  assert.equal(tables.some((t) => t.parent_table_id === table('T4').id), false);
});

test('split bills are evened out to the original total, and merging back gives exactly the original bill', async () => {
  // ₹35 with 5% tax: two of them round up, one rounds up, but all three together round down.
  const category = (await admin.get('/menu')).data.categories[0];
  const made = await admin.post('/menu/items', { category_id: category.id, name: 'Rounding Dish', veg: true, price: 35, sizes: [], customisations: [] });
  assert.equal(made.status, 201);
  await refreshTables();
  const order = await servedOrder(maya, 'T4', [{ menuItemId: made.data.item.id, qty: 3 }], 3);
  assert.equal(order.total, 110); // 105 + 5.25 tax, rounded
  const [line] = live(order);
  const split = await maya.send('table.split', {
    tableId: table('T4').id,
    parts: [{ seats: 2 }, { seats: 2, items: [{ itemId: line.id, qty: 1 }] }],
  });
  // 73.50 rounds to 74 and 36.75 to 37: one rupee too many, taken off the last part.
  assert.deepEqual(split.parts.map((p) => p.total), [74, 36]);
  await refreshTables();
  const merged = await maya.send('table.merge', { tableIds: [table('T4.1').id, table('T4.2').id] });
  assert.equal(merged.merged.total, 110);
  assert.equal(merged.merged.items.length, 1);
  await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
  assert.equal((await admin.del(`/menu/items/${made.data.item.id}`)).status, 200);
  await refreshTables();
  assert.equal(table('T4').status, 'free');
});

test('a paid bill never changes when the menu or the tax settings change later', async () => {
  const order = await servedOrder(maya, 'T7', [{ menuItemId: item('STR02').id, qty: 2 }]);
  const paid = await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
  assert.equal((await manager.patch(`/menu/items/${item('STR02').id}`, { price: 999, name: 'Renamed Kebab' })).status, 200);
  assert.equal((await admin.patch('/restaurant', { tax: { rate: 18, mode: 'inclusive', split: false }, service_charge_pct: 10 })).status, 200);
  const later = (await manager.get(`/orders/${order.id}`)).data.order;
  assert.equal(later.total, paid.total);
  assert.equal(later.items[0].name_snapshot, 'Hara Bhara Kebab');
  assert.equal(later.items[0].unit_price, 160);
  assert.deepEqual(later.tax_lines, paid.tax_lines);

  // A new order uses the new settings: price includes 18% tax, plus 10% service charge.
  const next = await servedOrder(maya, 'T7', [{ menuItemId: item('STR01').id, qty: 1 }]);
  assert.equal(next.items[0].tax_mode, 'inclusive');
  assert.deepEqual(next.tax_lines.map((l) => l.label), ['GST 18%']);
  assert.ok(next.service_charge > 0);
  await maya.send('payment.add', { orderId: next.id, method: 'cash', close: true });
  await admin.patch('/restaurant', { tax: { rate: 5, mode: 'exclusive', split: true }, service_charge_pct: 0 });
});

test('five wrong PINs lock the PIN; the right one does not work until the lock ends', async () => {
  const order = await servedOrder(maya, 'T8', [{ menuItemId: item('STR01').id, qty: 1 }]);
  const request = await maya.send('approval.request', { type: 'cancel', orderId: order.id, itemId: order.items[0].id, payload: { reason: 'Guest left' } });
  assert.equal(request.type, 'void'); // the dish was already served
  let last;
  for (let n = 0; n < 5; n += 1) last = await admin.try('approval.decide', { approvalId: request.id, approve: true, pin: '9999' });
  assert.equal(last.error, 'pin_locked');
  assert.equal((await admin.try('approval.decide', { approvalId: request.id, approve: true, pin: PIN })).error, 'pin_locked');
  // Another approver is not affected, and rejecting never needs a PIN.
  const rejected = await manager.send('approval.decide', { approvalId: request.id, approve: false, reason: 'Already eaten' });
  assert.equal(rejected.status, 'rejected');
  await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
});

test('menu: categories and items can be added, ordered, switched off and deleted', async () => {
  const made = await manager.post('/menu/categories', { name: 'Burgers', description: 'Handcrafted', position: 1 });
  assert.equal(made.status, 201);
  assert.match(made.data.category.prefix, /^[A-Z]{2,5}$/);
  assert.equal((await manager.post('/menu/categories', { name: 'burgers' })).status, 409);
  const created = await manager.post('/menu/items', {
    category_id: made.data.category.id, name: 'Classic Burger', description: 'Juicy', veg: false,
    sizes: [{ label: 'Regular', price: 180 }, { label: 'Large', price: 240 }], tax_rate: 12, tax_mode: 'inclusive', terminal_id: 2,
    modifier_groups: [{ name: 'Burger Size', required: true, max: 1, options: [{ name: 'Single', price: 0 }, { name: 'Double', price: 80 }] }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.item.code, `${made.data.category.prefix}01`);
  assert.equal(created.data.item.modifier_groups[0].min, 1);
  assert.equal((await manager.post('/menu/items', { category_id: made.data.category.id, name: 'Bad', price: 10, terminal_id: 999 })).status, 400);

  let list = (await manager.get('/menu?all=1')).data;
  assert.equal(list.categories[0].name, 'Burgers');
  assert.equal((await manager.post(`/menu/categories/${made.data.category.id}/move`, { direction: 'down' })).status, 200);
  list = (await manager.get('/menu?all=1')).data;
  assert.equal(list.categories[1].name, 'Burgers');

  // Switched off: waiters no longer see the category or its items.
  await manager.patch(`/menu/categories/${made.data.category.id}`, { active: false });
  assert.equal((await maya.get('/menu')).data.items.some((i) => i.name === 'Classic Burger'), false);
  assert.equal((await manager.del(`/menu/categories/${made.data.category.id}`)).data.items, 1);
  assert.equal((await manager.get('/menu?all=1')).data.categories.some((c) => c.name === 'Burgers'), false);
});

test('import: preview, create new only, the same import twice, then update matching', async () => {
  const file = (rows) => Buffer.from(['category_name,item_code,item_name,portion_name,portion_price,kitchen_terminal', ...rows].join('\n')).toString('base64');
  const first = await manager.post('/menu/import/preview', {
    kind: 'items', filename: 'menu.csv',
    data: file(['Starters,STR01,Veg Spring Roll,,155,', 'Starters,STR90,Corn Tikki,Half,90,Tandoor', 'Starters,STR90,Corn Tikki,Full,160,', 'Nowhere,XX01,Lost,,50,', 'Starters,STR91,Free Dish,,-5,']),
  });
  assert.equal(first.status, 200);
  // "Nowhere" is not on the menu: it comes along as a new category with its dish.
  assert.deepEqual(first.data.counts, { new: 3, update: 1, error: 1, warnings: 0, rows: 5, error_rows: 1, new_categories: 1, reused: 1, categories: 1, items: 4, kitchens: 0 });

  const created = await manager.post(`/menu/import/${first.data.id}/commit`, { mode: 'create' });
  assert.deepEqual([created.data.summary.created, created.data.summary.updated, created.data.summary.skipped, created.data.summary.failed], [3, 0, 1, 1]);
  const again = await manager.post(`/menu/import/${first.data.id}/commit`, { mode: 'update' });
  assert.deepEqual(again.data.summary, created.data.summary); // nothing new happened
  let items = (await manager.get('/menu?all=1')).data.items;
  assert.equal(items.find((i) => i.code === 'STR01').price, 140); // not overwritten in "create new only"
  assert.deepEqual(items.find((i) => i.code === 'STR90').sizes, [{ label: 'Half', price: 90 }, { label: 'Full', price: 160 }]);
  assert.equal(items.find((i) => i.code === 'STR90').terminal_id, 2);

  const report = await manager.get(`/menu/import/${first.data.id}/errors.csv`);
  assert.match(report.data.toString('utf8'), /negative/);
  assert.ok((await manager.get('/menu?all=1')).data.categories.some((c) => c.name === 'Nowhere'));

  const second = await manager.post('/menu/import/preview', { kind: 'items', filename: 'menu.csv', data: file(['Starters,STR01,Veg Spring Roll,,155,']) });
  assert.deepEqual(second.data.records[0].changes, [{ field: 'Price', old: '140', new: '155' }]);
  const updated = await manager.post(`/menu/import/${second.data.id}/commit`, { mode: 'update' });
  assert.equal(updated.data.summary.updated, 1);
  items = (await manager.get('/menu?all=1')).data.items;
  assert.equal(items.find((i) => i.code === 'STR01').price, 155);

  assert.equal((await neha.post('/menu/import/preview', { kind: 'items', filename: 'menu.csv', data: file([]) })).status, 403);
  assert.equal((await manager.post('/menu/import/preview', { kind: 'items', filename: 'menu.xls', data: 'AAAA' })).status, 400);
});

test('dining areas and tables: rules that keep the floor consistent', async () => {
  const area = await manager.post('/areas', { name: 'Garden', kind: 'outdoor', tables: 3 });
  assert.equal(area.status, 201);
  assert.equal(area.data.area.table_count, 3);
  assert.equal((await manager.post('/areas', { name: 'garden' })).status, 409);
  await refreshTables();
  const mine = tables.filter((t) => t.area_id === area.data.area.id);
  assert.deepEqual(mine.map((t) => t.label), ['T17', 'T18', 'T19']);
  assert.equal((await manager.del(`/areas/${area.data.area.id}`)).data.error, 'area_has_tables');
  assert.equal((await manager.patch(`/tables/${mine[0].id}`, { label: 'T1' })).status, 409);
  assert.equal((await manager.put(`/areas/${area.data.area.id}/layout`, { positions: [{ id: mine[0].id, x: 0.5, y: 0.5 }] })).status, 200);
  // Tables, and dining areas, are put in order by dragging; only rows of the same list are accepted.
  const reversed = [...mine].reverse().map((t) => t.id);
  assert.equal((await manager.put(`/areas/${area.data.area.id}/tables/order`, { ids: reversed })).status, 200);
  await refreshTables();
  assert.deepEqual(tables.filter((t) => t.area_id === area.data.area.id).map((t) => t.label), ['T19', 'T18', 'T17']);
  assert.equal((await manager.put(`/areas/${area.data.area.id}/tables/order`, { ids: [table('T1').id] })).status, 400);
  assert.equal((await maya.put(`/areas/${area.data.area.id}/tables/order`, { ids: reversed })).status, 403);
  const floorId = area.data.area.floor_id;
  const before = (await manager.get('/areas')).data.areas.filter((a) => a.floor_id === floorId).map((a) => a.id);
  const moved = [area.data.area.id, ...before.filter((x) => x !== area.data.area.id)];
  const ordered = await manager.put('/areas/order', { ids: moved });
  assert.equal(ordered.status, 200);
  assert.deepEqual(ordered.data.areas.filter((a) => a.floor_id === floorId).map((a) => a.id), moved);
  assert.equal((await manager.put('/areas/order', { ids: [999999] })).status, 400);
  assert.equal((await maya.put('/areas/order', { ids: moved })).status, 403);
  assert.equal((await manager.put('/areas/order', { ids: before })).status, 200);
  for (const t of mine) assert.equal((await manager.del(`/tables/${t.id}`)).status, 200);
  assert.equal((await manager.del(`/areas/${area.data.area.id}`)).status, 200);
  // A table in use cannot be switched off, moved or deleted.
  await maya.send('table.lock', { tableId: table('T9').id });
  assert.equal((await manager.del(`/tables/${table('T9').id}`)).data.error, 'table_busy');
  assert.equal((await manager.patch(`/tables/${table('T9').id}`, { active: false })).data.error, 'table_busy');
  await maya.send('table.release', { tableId: table('T9').id });
  assert.equal((await maya.post('/areas', { name: 'Nope' })).status, 403);
});

test('staff: profile, assignments, and ending sessions from the server', async () => {
  const list = (await manager.get('/users')).data.users;
  const m = list.find((u) => u.login_id === 'W-104');
  assert.equal(m.online, true);
  assert.equal(m.assignment, 'Main Hall, Open Air');
  assert.equal(list.find((u) => u.login_id === 'C-107').assignment, 'Tandoor');

  const profile = (await manager.get(`/users/${m.id}`)).data;
  assert.ok(profile.performance.orders_taken >= 5);
  assert.ok(profile.sessions.some((s) => s.online));
  assert.ok(profile.activity.some((a) => a.action === 'session.login'));

  // A manager manages waiters and chefs, but not managers, admins or permissions.
  assert.equal((await manager.post('/users', { name: 'Boss', login_id: 'M-900', password: 'secret12', role: 'manager' })).status, 403);
  assert.equal((await manager.patch(`/users/${m.id}`, { permissions: { 'reports.view': true } })).status, 403);
  const added = await manager.post('/users', { name: 'Karan', login_id: 'karan@restaurant.com', password: 'secret12', role: 'waiter', access: { areas: { 1: { mode: 'tables', tables: [table('T1').id, table('T2').id] } } }, can_collect_payment: false });
  assert.equal(added.status, 201);
  assert.equal(added.data.user.permissions['payments.collect'], false);
  assert.equal((await manager.post('/users', { name: 'Chef X', login_id: 'C-900', password: 'secret12', role: 'chef' })).status, 400); // no terminal

  const karan = await signIn(env.base, 'karan@restaurant.com', 'waiter', { password: 'secret12' });
  assert.equal((await karan.try('table.lock', { tableId: table('T3').id })).error, 'table_not_assigned');
  assert.equal((await karan.try('table.lock', { tableId: table('T2').id })).ok, true);
  await karan.send('table.release', { tableId: table('T2').id });

  // Log out all devices: the token stops working at once and the live connection is closed.
  assert.equal((await manager.post(`/users/${added.data.user.id}/logout`, {})).data.ended, 1);
  assert.equal((await karan.get('/me')).status, 401);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(karan.closedWith, 4401);

  // Deleting keeps the name on history and frees the login ID.
  assert.equal((await manager.del(`/users/${added.data.user.id}`)).status, 200);
  assert.equal((await manager.post('/users', { name: 'Karan 2', login_id: 'karan@restaurant.com', password: 'secret12', role: 'waiter' })).status, 201);
  assert.equal((await admin.del(`/users/${admin.user.id}`)).status, 409); // nobody deletes themselves
});

test('the PIN is changed with the current PIN, and a password change signs out other devices', async () => {
  assert.equal((await manager.post('/me/pin', { currentPin: '0000', pin: '4321' })).status, 403);
  assert.equal((await manager.post('/me/pin', { currentPin: PIN, pin: '12' })).status, 400);
  assert.equal((await manager.post('/me/pin', { currentPin: PIN, pin: '4321' })).status, 200);
  assert.equal((await manager.post('/me/pin', { currentPin: '4321', pin: PIN })).status, 200);
  assert.equal((await maya.post('/me/pin', { currentPin: PIN, pin: '4321' })).status, 403); // waiters have no approval PIN

  const other = await signIn(env.base, 'K-106', 'cashier', { live: false });
  assert.equal((await neha.post('/me/password', { current: 'wrong', password: 'newsecret' })).status, 403);
  const { PASSWORD } = require('./helpers');
  assert.equal((await neha.post('/me/password', { current: PASSWORD, password: 'newsecret' })).status, 200);
  assert.equal((await other.get('/me')).status, 401);
  assert.equal((await neha.get('/me')).status, 200);
});

test('one of my own devices can be signed out, and a printed bill is recorded', async () => {
  const phone = await signIn(env.base, 'M-102', 'manager', { live: false });
  const phoneSession = (await phone.get('/me')).data.sessionId;
  const here = (await manager.get('/me')).data.sessionId;
  assert.equal((await manager.post(`/me/sessions/${here}/logout`)).status, 400); // this device uses Sign Out
  assert.equal((await manager.post(`/me/sessions/${phoneSession}/logout`)).status, 200);
  assert.equal((await phone.get('/me')).status, 401);
  assert.equal((await manager.get('/me')).status, 200);
  assert.equal((await manager.post(`/me/sessions/${phoneSession}/logout`)).status, 404); // already out

  const day = 86400000;
  const range = `from=${new Date(Date.now() - day).toISOString()}&to=${new Date(Date.now() + day).toISOString()}`;
  const paid = (await manager.get(`/orders?${range}`)).data.orders.find((o) => ['paid', 'closed'].includes(o.status));
  assert.ok(paid, 'an earlier test left a paid bill');
  assert.equal((await sanjay.post(`/orders/${paid.id}/receipt`, { kind: 'print' })).status, 403); // a chef gives out no bills
  assert.equal((await neha.post(`/orders/${paid.id}/receipt`, { kind: 'print' })).status, 200);
  const open = (await manager.get('/sync')).data.orders.find((o) => !['paid', 'closed'].includes(o.status));
  if (open) assert.equal((await neha.post(`/orders/${open.id}/receipt`, { kind: 'print' })).status, 409);
  const log = (await admin.get('/audit?entity=order')).data.entries;
  const printed = log.find((e) => e.action === 'receipt.print' && e.entity_id === paid.id);
  assert.ok(printed);
  assert.equal(printed.user_role, 'cashier');
  assert.equal(printed.refs.order_id, paid.id);
});

test('reports and the overview count paid bills only, in the restaurant’s day', async () => {
  const overview = (await manager.get('/overview')).data;
  assert.ok(overview.today.orders >= 5);
  assert.equal(overview.previous.orders, 0);
  const sales = (await manager.get('/reports/sales?range=today')).data;
  assert.equal(sales.totals.orders, overview.today.orders);
  assert.equal(sales.totals.refunds, 52);
  assert.equal(sales.totals.net_sales, overview.today.net_sales);
  assert.ok(sales.totals.collected > 0 && sales.totals.collected < sales.totals.billed); // a refund came off
  assert.ok(sales.by_method.some((m) => m.method === 'cash'));
  const report = (await manager.get('/reports/overview?range=7d')).data;
  assert.equal(report.previous, null); // nothing before to compare with: no made-up growth
  assert.equal(report.trend.length, 7);
  const menuReport = (await manager.get('/reports/menu?range=today')).data;
  assert.ok(menuReport.top_by_qty.length > 0);
  assert.ok(menuReport.never_ordered.length > 0);
  assert.ok(!menuReport.never_ordered.some((n) => menuReport.top_by_qty.some((t) => t.id === n.id)));
  const staff = (await manager.get('/reports/staff?range=today')).data;
  assert.equal(staff.waiters[0].name, 'Maya');
  assert.ok(staff.chefs.find((c) => c.name === 'Sanjay').items_prepared > 0);
  assert.equal((await manager.get('/reports/overview?range=custom&from=2026-01-10&to=2026-01-01')).status, 400);
});

test('audit records cannot be changed or deleted', async () => {
  await assert.rejects(env.pg.query('UPDATE audit_logs SET action = \'x\''), /cannot be changed/);
  await assert.rejects(env.pg.query('DELETE FROM audit_logs'), /cannot be changed/);
  const entries = (await admin.get('/audit')).data.entries;
  assert.ok(entries.every((e) => e.user_role));
});

test('the kitchen accepts a ticket, then starts it; denying some dishes accepts the rest', async () => {
  await refreshTables();
  await maya.send('table.lock', { tableId: table('T2').id });
  const order = await maya.send('order.create', {
    type: 'dine_in', tableId: table('T2').id,
    items: [{ menuItemId: item('IMC11').id, size: 'Full', qty: 1 }, { menuItemId: item('IMC11').id, size: 'Half', qty: 1 }, { menuItemId: item('BRD02').id, qty: 1 }],
  });
  // Step 1, Accept: only the tandoor's naan, the dish at this chef's terminal.
  const accepted = await vikram.send('chef.accept', { orderId: order.id });
  assert.deepEqual(accepted.items.map((i) => i.status).sort(), ['accepted', 'sent', 'sent']);
  assert.equal((await vikram.try('chef.accept', { orderId: order.id })).error, 'nothing_to_accept');
  // Step 2, Start preparing.
  const started = await vikram.send('chef.start', { orderId: order.id });
  assert.deepEqual(started.items.map((i) => i.status).sort(), ['preparing', 'sent', 'sent']);
  assert.equal((await vikram.try('chef.start', { orderId: order.id })).error, 'nothing_to_start');
  // Denying one dish accepts the other one that was new at the same chef's terminals; it is not started.
  const [a, b] = started.items.filter((i) => i.status === 'sent');
  const denied = await sanjay.send('chef.deny', { orderId: order.id, itemIds: [a.id], reason: 'out_of_stock' });
  assert.equal(denied.accepted, 1);
  assert.equal(denied.unavailable, 1);
  assert.equal(denied.order.items.find((i) => i.id === b.id).status, 'accepted');
  const cooking = await sanjay.send('chef.start', { orderId: order.id });
  assert.equal(cooking.items.find((i) => i.id === b.id).status, 'preparing');
  const ready = await sanjay.send('chef.allReady', { orderId: order.id });
  await maya.send('waiter.deliver', { itemIds: ready.items.filter((i) => i.status === 'ready').map((i) => i.id) });
  await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
});

test('a table is split by seats for a second party, re-cut, and is whole again when everyone has left', async () => {
  await refreshTables();
  const first = await servedOrder(maya, 'T3', [{ menuItemId: item('STR01').id, qty: 1 }]);
  const t3 = table('T3').id; // six seats
  assert.equal((await maya.try('table.split', { tableId: t3, parts: [{ seats: 4 }, { seats: 1 }] })).error, 'seats_mismatch');
  // The two guests stay together on T3.1 with their two seats; the four free seats make T3.2.
  assert.equal((await maya.try('table.split', { tableId: t3, parts: [{ seats: 4 }, { seats: 2 }] })).error, 'party_seats');
  const split = await maya.send('table.split', { tableId: t3, parts: [{ seats: 2 }, { seats: 4 }] });
  assert.deepEqual(split.parts.map((p) => [p.table_label, p.seats, p.free]), [['T3.1', 2, false], ['T3.2', 4, true]]);
  await refreshTables();
  assert.equal(table('T3').status, 'split');
  assert.equal(table('T3.2').status, 'free');
  assert.equal(table('T3.1').order_id, first.id);

  // Another waiter seats a second party on the free part, with an order and a bill of its own.
  await amit.send('table.lock', { tableId: table('T3.2').id });
  const second = await amit.send('order.create', { type: 'dine_in', tableId: table('T3.2').id, items: [{ menuItemId: item('STR01').id, qty: 2 }] });
  assert.equal(second.table_label, 'T3.2');

  // Cut again: a part in use cannot be dropped; a new free part can be added.
  assert.equal((await manager.try('table.split', { tableId: t3, parts: [{ id: table('T3.1').id, seats: 5 }, { seats: 1 }] })).error, 'part_in_use');
  const again = await manager.send('table.split', { tableId: table('T3.2').id, parts: [{ id: table('T3.1').id, seats: 3 }, { id: table('T3.2').id, seats: 2 }, { seats: 1 }] });
  assert.deepEqual(again.parts.map((p) => [p.table_label, p.seats]), [['T3.1', 3], ['T3.2', 2], ['T3.3', 1]]);
  await refreshTables();
  // Merging the free part into an occupied one gives its seat back; the party and its bill stay.
  const merged = await maya.send('table.merge', { tableIds: [table('T3.1').id, table('T3.3').id] });
  assert.equal(merged.table.label, 'T3.1');
  assert.equal(merged.table.seats, 4);
  assert.equal(merged.table.order_id, first.id);

  // The first party pays and leaves: its part is free, and the table stays split for the second.
  await maya.send('payment.add', { orderId: first.id, method: 'cash', close: true });
  await refreshTables();
  assert.equal(table('T3.1').status, 'free');
  assert.equal(table('T3').status, 'split');
  await sanjay.send('chef.start', { orderId: second.id });
  const done = await sanjay.send('chef.allReady', { orderId: second.id });
  await amit.send('waiter.deliver', { itemIds: done.items.map((i) => i.id) });
  await amit.send('bill.request', { orderId: second.id });
  await manager.send('payment.add', { orderId: second.id, method: 'cash', close: true });
  await refreshTables();
  assert.equal(table('T3').status, 'free');
  assert.equal(table('T3').seats, 6);
  assert.equal(tables.some((t) => t.parent_table_id === t3), false);

  // A free table can be split ahead of time, and merged back while nobody sits there.
  await manager.send('table.split', { tableId: t3, parts: [{ seats: 2 }, { seats: 2 }, { seats: 2 }] });
  await refreshTables();
  assert.deepEqual(tables.filter((t) => t.parent_table_id === t3).map((t) => t.status), ['free', 'free', 'free']);
  await manager.send('table.merge', { tableIds: tables.filter((t) => t.parent_table_id === t3).map((t) => t.id) });
  await refreshTables();
  assert.equal(table('T3').status, 'free');
});

test('whole tables are joined for one party, move together, and come apart when the bill closes', async () => {
  await refreshTables();
  assert.equal((await maya.try('table.merge', { tableIds: [table('T5').id, table('R1').id], seat: true })).error, 'different_areas');
  const joined = await maya.send('table.merge', { tableIds: [table('T5').id, table('T6').id], seat: true });
  assert.equal(joined.table.label, 'T5');
  assert.deepEqual(joined.table.joined.map((j) => j.label), ['T6']);
  assert.equal(joined.table.locked_by, maya.user.id);
  const order = await maya.send('order.create', { type: 'dine_in', tableId: table('T5').id, items: [{ menuItemId: item('STR01').id, qty: 1 }] });
  assert.equal(order.table_label, 'T5+T6');
  await refreshTables();
  assert.equal(table('T6').joined_to_id, table('T5').id);
  assert.equal((await amit.try('table.lock', { tableId: table('T6').id })).error, 'taken'); // the joined table follows its lead
  assert.equal((await maya.try('table.split', { tableId: table('T5').id, parts: [{ seats: 2 }, { seats: 2 }] })).error, 'joined');

  // The party moves mid-meal: one table for the two, and both old tables are free again.
  const kot = order.items[0].kot_id;
  const moved = await maya.send('table.transfer', { orderId: order.id, toTableId: table('T8').id });
  assert.equal(moved.order.table_label, 'T8');
  assert.equal(moved.order.items[0].kot_id, kot);
  await refreshTables();
  assert.equal(table('T5').status, 'free');
  assert.equal(table('T6').status, 'free');
  assert.equal(table('T6').joined_to_id, null);
  assert.equal(table('T8').status, 'order_placed');

  // A table is joined to one that already has an order, then separated again.
  await maya.send('table.merge', { tableIds: [table('T8').id, table('T9').id] });
  assert.equal((await manager.get(`/orders/${order.id}`)).data.order.table_label, 'T8+T9');
  const apart = await maya.send('table.unjoin', { tableId: table('T9').id });
  assert.deepEqual(apart.freed, ['T9']);
  assert.equal((await maya.try('table.unjoin', { tableId: table('T8').id })).error, 'not_joined');

  // Two tables that both have orders become one party with one bill.
  await maya.send('table.lock', { tableId: table('T9').id });
  const other = await maya.send('order.create', { type: 'dine_in', tableId: table('T9').id, items: [{ menuItemId: item('STR01').id, qty: 2 }] });
  const one = await maya.send('table.merge', { tableIds: [table('T8').id, table('T9').id] });
  assert.equal(one.merged.order_id, order.id);
  assert.equal(one.merged.table_label, 'T8+T9');
  assert.equal(one.merged.total, order.total + other.total);
  assert.equal(one.merged.items.reduce((n, i) => n + i.qty, 0), 3);

  await sanjay.send('chef.start', { orderId: order.id });
  const ready = await sanjay.send('chef.allReady', { orderId: order.id });
  await maya.send('waiter.deliver', { itemIds: ready.items.map((i) => i.id) });
  await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
  await refreshTables();
  assert.equal(table('T8').status, 'free');
  assert.equal(table('T9').status, 'free');
  assert.equal(table('T9').joined_to_id, null);
});

test('floors hold dining areas; a floor with areas cannot be deleted', async () => {
  const state = (await manager.get('/sync')).data;
  assert.deepEqual(state.floors.map((f) => f.name), ['Ground Floor', 'First Floor', 'Rooftop']);
  assert.equal(state.areas.find((a) => a.name === 'Private Dining').floor_name, 'Ground Floor');
  assert.equal(state.tables.find((t) => t.label === 'T11').floor_name, 'First Floor');
  const made = await manager.post('/floors', { name: 'Basement' });
  assert.equal(made.status, 201);
  assert.equal((await manager.post('/floors', { name: 'basement' })).status, 409);
  // The same area name may be used on two floors.
  const area = await manager.post('/areas', { name: 'Main Hall', floor_id: made.data.id, kind: 'indoor' });
  assert.equal(area.status, 201);
  assert.equal(area.data.area.floor_name, 'Basement');
  assert.equal((await manager.del(`/floors/${made.data.id}`)).data.error, 'floor_has_areas');
  assert.equal((await manager.del(`/areas/${area.data.area.id}`)).status, 200);
  assert.equal((await manager.del(`/floors/${made.data.id}`)).status, 200);
  assert.equal((await maya.post('/floors', { name: 'Nope' })).status, 403);
});

test('chefs can be assigned from the terminal, and their board follows', async () => {
  const bar = (await manager.get('/terminals')).data.terminals.find((t) => t.name === 'Bar & Drinks');
  assert.ok(bar.chefs.some((c) => c.name === 'Sanjay'));
  const set = await manager.put(`/terminals/${bar.id}/chefs`, { userIds: [...bar.chefs.map((c) => c.id), vikram.user.id] });
  assert.ok(set.data.terminals.find((t) => t.id === bar.id).chefs.some((c) => c.name === 'Vikram'));
  assert.ok((await vikram.get('/me')).data.user.terminals.includes(bar.id));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(vikram.events.some((e) => e.type === 'me.updated'));
  assert.equal((await manager.put(`/terminals/${bar.id}/chefs`, { userIds: [maya.user.id] })).status, 400); // only chefs
  assert.equal((await manager.put(`/terminals/${bar.id}/chefs`, { userIds: bar.chefs.map((c) => c.id) })).status, 200);
  assert.equal((await vikram.get('/me')).data.user.terminals.includes(bar.id), false);
  assert.equal((await maya.put(`/terminals/${bar.id}/chefs`, { userIds: [] })).status, 403);
});

test('a manager sees only the roles below; an admin can switch a manager off; a PIN is 4 digits', async () => {
  const seen = (await manager.get('/users')).data.users;
  assert.ok(seen.length > 2);
  assert.ok(seen.every((u) => u.id === manager.user.id || !['admin', 'manager'].includes(u.role)));
  assert.equal((await manager.get(`/users/${admin.user.id}`)).status, 404);
  assert.ok((await admin.get('/users')).data.users.some((u) => u.role === 'manager'));

  assert.equal((await admin.post('/users', { name: 'Long Pin', login_id: 'M-951', password: 'secret12', role: 'manager', pin: '123456' })).status, 400);
  const boss = await admin.post('/users', { name: 'Temp Boss', login_id: 'M-950', password: 'secret12', role: 'manager', pin: '2468' });
  assert.equal(boss.status, 201);
  const temp = await signIn(env.base, 'M-950', 'manager', { live: false, password: 'secret12' });
  assert.equal((await temp.get('/users')).status, 200);
  // One manager cannot switch another off; the admin can, and it takes effect at once.
  assert.equal((await manager.patch(`/users/${boss.data.user.id}`, { active: false })).status, 403);
  assert.equal((await admin.patch(`/users/${boss.data.user.id}`, { active: false })).status, 200);
  assert.equal((await temp.get('/me')).status, 401);
  assert.equal((await admin.del(`/users/${boss.data.user.id}`)).status, 200);
});

test('developer sign-in is off unless switched on, and never works through a shared link or a hosted server (but for the in-memory demo)', async () => {
  // (A developer's own .env may switch it on for this computer; the test starts from "off".)
  const flag = process.env.DEV_LOGIN;
  const before = process.env.NODE_ENV;
  const url = process.env.DATABASE_URL;
  delete process.env.DEV_LOGIN;
  try {
    assert.equal((await call(env.base, '/auth/dev')).data.enabled, false);
    assert.equal((await call(env.base, '/auth/dev-login', { method: 'POST', body: { userId: maya.user.id } })).status, 404);
    process.env.DEV_LOGIN = '1';
    const dev = await call(env.base, '/auth/dev');
    assert.equal(dev.data.enabled, true);
    assert.ok(dev.data.users.some((u) => u.login_id === 'W-104'));
    const signedIn = await call(env.base, '/auth/dev-login', { method: 'POST', body: { userId: maya.user.id } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.data.user.login_id, 'W-104');
    assert.equal((await call(env.base, '/me', { token: signedIn.data.token })).status, 200);
    // A request that came through a tunnel carries the tunnel's headers and is refused.
    const tunnelled = await fetch(env.base + '/auth/dev', { headers: { 'cf-ray': 'abc' } });
    assert.equal((await tunnelled.json()).enabled, false);
    process.env.NODE_ENV = 'production';
    assert.equal((await call(env.base, '/auth/dev')).data.enabled, false);
    assert.equal((await call(env.base, '/auth/dev-login', { method: 'POST', body: { userId: maya.user.id } })).status, 404);
    // The public demo (src/demo.js) runs on its own in-memory database on the same machine: there it
    // works on the hosted server and through the host's proxy, but never with a restaurant's database.
    process.env.DEV_LOGIN = 'public';
    process.env.RENDER = 'true';
    process.env.POTKO_DEMO = 'in-memory';
    assert.equal((await (await fetch(env.base + '/auth/dev', { headers: { 'x-forwarded-for': '203.0.113.9' } })).json()).enabled, true);
    process.env.DATABASE_URL = `postgresql://owner:secret@ep-example.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
    assert.equal((await call(env.base, '/auth/dev')).data.enabled, false);
    process.env.DATABASE_URL = url;
    delete process.env.POTKO_DEMO;
    assert.equal((await call(env.base, '/auth/dev')).data.enabled, false);
  } finally {
    if (flag === undefined) delete process.env.DEV_LOGIN;
    else process.env.DEV_LOGIN = flag;
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
    process.env.DATABASE_URL = url;
    delete process.env.RENDER;
    delete process.env.POTKO_DEMO;
  }
});

test('a waiter who may not see prices still takes payments; dish prices never reach their device', async () => {
  await refreshTables();
  assert.equal((await manager.patch(`/users/${maya.user.id}`, { permissions: { 'reports.view': true } })).status, 403); // other switches are the admin's
  assert.equal((await manager.patch(`/users/${maya.user.id}`, { permissions: { 'prices.view': false } })).status, 200); // price visibility is the manager's too
  assert.equal((await maya.get('/me')).data.user.permissions['prices.view'], false);
  const dish = (await maya.get('/menu')).data.items.find((m) => m.code === 'STR01');
  assert.equal(dish.price, undefined);
  assert.equal(dish.price_hidden, true);
  const order = await servedOrder(maya, 'T2', [{ menuItemId: item('STR01').id, qty: 1 }]);
  const mine = (await maya.get('/sync')).data.orders.find((o) => o.id === order.id);
  assert.equal(mine.items[0].unit_price, undefined); // the dish price is not sent
  assert.ok(Number(mine.total) > 0); // the amount to collect is
  const paid = await maya.send('payment.add', { orderId: order.id, method: 'cash', close: true });
  assert.equal(paid.status, 'closed');
  assert.equal((await admin.patch(`/users/${maya.user.id}`, { permissions: { 'prices.view': true } })).status, 200);
});

test('payment permission has three levels: take, close only, none', async () => {
  await refreshTables();
  const set = (level) => manager.patch(`/users/${amit.user.id}`, { payment_access: level });
  assert.equal((await set('maybe')).status, 400);
  assert.equal((await set('none')).status, 200);
  const order = await servedOrder(amit, 'T12', [{ menuItemId: item('STR01').id, qty: 1 }]);
  assert.equal((await amit.try('payment.add', { orderId: order.id, method: 'cash' })).error, 'no_payment_permission');
  assert.equal((await amit.send('bill.request', { orderId: order.id })).at_counter, true);
  await manager.send('payment.add', { orderId: order.id, method: 'cash' });
  assert.equal((await amit.try('order.close', { orderId: order.id })).error, 'forbidden'); // no access: cannot close either
  assert.equal((await set('close')).status, 200);
  assert.equal((await amit.get('/me')).data.user.payment_access, 'close');
  await amit.send('order.close', { orderId: order.id }); // close only: may close the paid table
  await refreshTables();
  assert.equal(table('T12').status, 'free');
});

test('a dish can be shown at several kitchens; each kitchen ticks its own dishes', async () => {
  const list = async () => (await manager.get('/terminals')).data.terminals;
  const tandoor = (await list()).find((t) => t.name === 'Tandoor');
  const dessert = (await list()).find((t) => t.name === 'Dessert Counter');
  const all = async () => (await manager.get('/menu?all=1')).data.items;
  const dish = async (code) => (await all()).find((i) => i.code === code);
  const code = (await all()).find((i) => i.terminal_ids.length === 0).code;
  const mine = (await all()).filter((i) => i.terminal_ids.includes(tandoor.id)).map((i) => i.id);

  // Ticked at the tandoor: the tandoor now shows it.
  const put = await manager.put(`/terminals/${tandoor.id}/items`, { itemIds: [...mine, (await dish(code)).id] });
  assert.equal(put.status, 200);
  assert.equal(put.data.added, 1);
  assert.deepEqual((await dish(code)).terminal_ids, [tandoor.id]);
  // Ticked at the dessert counter too: both show it, the first stays the numbering one.
  const desserts = (await all()).filter((i) => i.terminal_ids.includes(dessert.id)).map((i) => i.id);
  await manager.put(`/terminals/${dessert.id}/items`, { itemIds: [...desserts, (await dish(code)).id] });
  assert.deepEqual((await dish(code)).terminal_ids, [tandoor.id, dessert.id]);
  assert.equal((await dish(code)).terminal_id, tandoor.id);
  // Set from the dish form.
  const id = (await dish(code)).id;
  assert.equal((await manager.patch(`/menu/items/${id}`, { terminal_ids: [dessert.id] })).status, 200);
  assert.deepEqual((await dish(code)).terminal_ids, [dessert.id]);
  assert.equal((await manager.patch(`/menu/items/${id}`, { terminal_ids: [999999] })).status, 400);
  // Unticked everywhere: the default kitchen cooks it.
  await manager.put(`/terminals/${dessert.id}/items`, { itemIds: desserts.filter((d) => d !== id) });
  assert.deepEqual((await dish(code)).terminal_ids, []);
  assert.equal((await dish(code)).terminal_id, null);
  assert.equal((await list()).find((t) => t.id === tandoor.id).item_count, mine.length);

  assert.equal((await manager.put(`/terminals/${tandoor.id}/items`, { itemIds: [999999] })).status, 400);
  assert.equal((await neha.put(`/terminals/${tandoor.id}/items`, { itemIds: [] })).status, 403);
});

test('a dish at two kitchens shows on both boards, and a chef gets only their own dishes', async () => {
  await refreshTables();
  const terminals = (await manager.get('/terminals')).data.terminals;
  const tandoor = terminals.find((t) => t.name === 'Tandoor');
  const kitchen = terminals.find((t) => t.is_default);
  const naan = item('BRD01'); // at the tandoor
  const soup = (await manager.get('/menu?all=1')).data.items.find((i) => i.terminal_ids.length === 0 && i.available && i.sizes.length === 0 && !i.modifier_groups.some((g) => g.required));
  assert.equal((await manager.patch(`/menu/items/${soup.id}`, { terminal_ids: [kitchen.id, tandoor.id] })).status, 200);

  await maya.send('table.lock', { tableId: table('T3').id });
  const order = await maya.send('order.create', { type: 'dine_in', tableId: table('T3').id, guests: 2, items: [{ menuItemId: naan.id, qty: 1 }, { menuItemId: soup.id, qty: 1 }] });
  const vikramSees = (await vikram.get('/sync')).data.orders.find((o) => o.id === order.id);
  assert.deepEqual(vikramSees.items.map((i) => i.menu_item_id).sort(), [naan.id, soup.id].sort()); // both show at the tandoor
  assert.equal(vikramSees.items[0].unit_price, undefined); // a chef sees no prices
  assert.deepEqual((await vikram.get('/sync')).data.terminals.map((t) => t.id), [tandoor.id]);
  // The tandoor chef starts both; on the main kitchen's board the soup is the same dish, already cooking.
  await vikram.send('chef.start', { orderId: order.id });
  const sanjaySees = (await sanjay.get('/sync')).data.orders.find((o) => o.id === order.id);
  assert.ok(sanjaySees.items.every((i) => i.status === 'preparing'));

  // A chef's menu is the dishes of their kitchens, and they may switch those off.
  const chefMenu = (await vikram.get('/menu')).data.items;
  assert.ok(chefMenu.some((m) => m.id === naan.id));
  assert.ok(chefMenu.every((m) => m.terminal_ids.includes(tandoor.id)));
  assert.equal((await vikram.patch(`/menu/items/${naan.id}/availability`, { available: false })).status, 200);
  assert.equal((await vikram.patch(`/menu/items/${naan.id}/availability`, { available: true })).status, 200);
  assert.equal((await vikram.patch(`/menu/items/${item('DES01').id}/availability`, { available: false })).status, 403);
  await manager.patch(`/menu/items/${soup.id}`, { terminal_ids: [] });
});

test('a waiter is sent only the dining areas and tables assigned to them', async () => {
  await refreshTables();
  const mine = (await maya.get('/sync')).data;
  assert.ok(mine.tables.length > 0);
  assert.ok(!mine.tables.some((t) => t.label === 'T11')); // First Floor is not hers
  assert.ok(!mine.areas.some((a) => a.id === table('T11').area_id));
  assert.ok((await amit.get('/sync')).data.tables.some((t) => t.label === 'T11')); // Amit works everywhere
});

test('open-price dishes take the price typed in; a dish can be duplicated', async () => {
  await refreshTables();
  const dish = item('STR01');
  assert.equal((await manager.patch(`/menu/items/${dish.id}`, { open_price: true })).status, 200);
  await amit.send('table.lock', { tableId: table('T13').id });
  assert.equal((await amit.try('order.create', { type: 'dine_in', tableId: table('T13').id, guests: 1, items: [{ menuItemId: dish.id, qty: 1 }] })).error, 'bad_price');
  const order = await amit.send('order.create', { type: 'dine_in', tableId: table('T13').id, guests: 1, items: [{ menuItemId: dish.id, qty: 2, price: 75 }] });
  // Amit does not take payment, so he is never sent the price back; the manager sees it.
  assert.equal(order.items[0].unit_price, undefined);
  assert.equal(Number((await manager.get(`/orders/${order.id}`)).data.order.items[0].unit_price), 75);
  await manager.patch(`/menu/items/${dish.id}`, { open_price: false });

  const copy = await manager.post(`/menu/items/${dish.id}/duplicate`, {});
  assert.equal(copy.status, 201);
  assert.equal(copy.data.item.name, `${dish.name} (copy)`);
  assert.equal(copy.data.item.available, false);
  assert.notEqual(copy.data.item.code, dish.code);
  assert.equal((await neha.post(`/menu/items/${dish.id}/duplicate`, {})).status, 403);
});

test('import in the menu template: dishes, their kitchens, open price and go-well-with links are saved', async () => {
  const head = 'Item Code,Item Name,Category Name,Category Description,Base Price (INR),Open Price? (Yes/No),Kitchen Terminals,Add-ons and Prices,Suggested Item Codes (for Go Well With)';
  const data = Buffer.from([
    head,
    'TPL-A1,Template Curry,Template Dishes,Made from the template,250,No,Main Kitchen | Tandoor,Extra Gravy:30,TPL-B2',
    'TPL-B2,Template Bread,Template Dishes,,,Yes,,,',
  ].join('\n')).toString('base64');
  const preview = await manager.post('/menu/import/preview', { kind: 'items', filename: 'menu.csv', data });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.counts.error, 0);
  const done = await manager.post(`/menu/import/${preview.data.id}/commit`, { mode: 'create' });
  assert.equal(done.data.summary.created, 3); // the new category and its two dishes
  const { items, categories } = (await manager.get('/menu?all=1')).data;
  const curry = items.find((i) => i.code === 'TPL-A1');
  const bread = items.find((i) => i.code === 'TPL-B2');
  assert.equal(categories.find((c) => c.id === curry.category_id).description, 'Made from the template');
  assert.equal(curry.terminal_ids.length, 2);
  assert.deepEqual(curry.addon_ids, [bread.id]); // the dish further down the same file
  assert.equal(bread.open_price, true);
  assert.equal(curry.modifier_groups[0].name, 'Add-ons');
});
