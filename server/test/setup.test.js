// First-run set-up on an empty server: the client creates the restaurant and its admin from the
// app, once, with the setup code. Runs on its own in-memory database with no demo data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { call } = require('./helpers');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let base;
let stop;
test.before(async () => {
  const pg = await PGlite.create();
  await pg.exec(sql('schema.sql'));
  const { migrate } = require('../src/migrate');
  await migrate({ run: (text) => pg.exec(text), rows: async (text) => (await pg.query(text)).rows });
  const dbPort = await freePort();
  const socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: '127.0.0.1', maxConnections: 4 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
  process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';
  delete process.env.SETUP_CODE;
  const { server, start } = require('../src/index');
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  stop = async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await require('../src/db').pool.end();
    await socket.stop();
    await pg.close();
  };
});
test.after(() => stop());

// Test values for this in-memory server only.
const form = { restaurantName: 'Test Kitchen', adminName: 'Owner', loginId: 'owner-1', password: 'test-pass-123', pin: '2468' };

test('an empty server asks for set-up, and refuses it until a setup code is configured', async () => {
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: true, ready: false });
  const refused = await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'anything' } });
  assert.equal(refused.status, 503);
  assert.equal(refused.data.error, 'setup_not_ready');
});

test('the setup code is checked, then the restaurant and its admin are created and signed in, once', async () => {
  process.env.SETUP_CODE = 'test-setup-code';
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: true, ready: true });

  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'wrong' } })).data.error, 'wrong_setup_code');
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, password: '123', setupCode: 'test-setup-code' } })).status, 400);
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, pin: '12', setupCode: 'test-setup-code' } })).status, 400);

  const made = await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'test-setup-code' } });
  assert.equal(made.status, 201);
  assert.ok(made.data.token);
  assert.equal(made.data.user.role, 'admin');
  assert.equal(made.data.user.has_pin, true);
  assert.equal(made.data.restaurant.name, 'Test Kitchen');

  // Closed for good: a second set-up is refused, and the app shows sign-in.
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, loginId: 'someone-else', setupCode: 'test-setup-code' } })).data.error, 'setup_done');
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: false, ready: true });

  // The admin signs in with what they chose, and the restaurant starts with a dining area and a kitchen.
  const login = await call(base, '/auth/login', { method: 'POST', body: { loginId: 'owner-1', password: 'test-pass-123', role: 'admin' } });
  assert.equal(login.status, 200);
  const sync = await call(base, '/sync', { token: login.data.token });
  assert.deepEqual(sync.data.areas.map((a) => a.name), ['Main Hall']);
  assert.deepEqual(sync.data.terminals.map((k) => k.name), ['Main Kitchen']);
});

test('the new restaurant imports the combined menu file: categories, dishes, kitchens and links, once', async () => {
  const login = await call(base, '/auth/login', { method: 'POST', body: { loginId: 'owner-1', password: 'test-pass-123', role: 'admin' } });
  const token = login.data.token;
  const file = await call(base, '/menu/import/template?kind=categories&format=xlsx', { token }); // started from Add Category
  const preview = await call(base, '/menu/import/preview', { token, method: 'POST', body: { kind: 'categories', filename: 'POTKO_Menu_Import_Template.xlsx', data: Buffer.from(file.data).toString('base64') } });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.data.counts, { new: 15, update: 0, error: 0, warnings: 0, rows: 9, error_rows: 0, new_categories: 6, reused: 0, categories: 6, items: 9, kitchens: 3 });

  const done = await call(base, `/menu/import/${preview.data.id}/commit`, { token, method: 'POST', body: { mode: 'create' } });
  assert.equal(done.data.summary.created, 15);
  assert.deepEqual(done.data.summary.kitchens, ['Tandoor', 'Starters', 'Beverages']);

  const { categories, items } = (await call(base, '/menu?all=1', { token })).data;
  const sync = (await call(base, '/sync', { token })).data;
  const dish = (id) => items.find((i) => i.code === id);
  const kitchen = (name) => sync.terminals.find((k) => k.name === name).id;
  assert.deepEqual(categories.map((c) => `${c.code} ${c.name}`), ['CAT-001 Indian Main Course', 'CAT-002 Breads', 'CAT-003 Rice & Biryani', 'CAT-004 Starters & Sides', 'CAT-005 Drinks', 'CAT-006 Specials']);
  assert.equal(categories[0].description, 'Curries and gravy-based main-course dishes.');
  // Base price kept, portions with their own prices, one portion = a plain price.
  assert.equal(dish('ITM-001').price, 220);
  assert.deepEqual(dish('ITM-001').sizes, [{ label: 'Regular', price: 220 }, { label: 'Large', price: 320 }]);
  assert.deepEqual([dish('ITM-007').price, dish('ITM-007').sizes], [60, []]);
  assert.deepEqual(dish('ITM-001').modifier_groups[0].options, [{ name: 'Extra Gravy', price: 30 }, { name: 'Extra Paneer', price: 50 }]);
  // Kitchens, tax, status, display order and Go Well With.
  assert.deepEqual(dish('ITM-004').terminal_ids, [kitchen('Tandoor')]);
  assert.deepEqual(dish('ITM-008').terminal_ids, [kitchen('Beverages')]);
  assert.equal(dish('ITM-008').tax_rate, 5);
  assert.equal(dish('ITM-001').tax_rate, null);
  assert.equal(dish('ITM-009').available, false);
  assert.equal(dish('ITM-002').veg, false);
  assert.deepEqual(dish('ITM-001').addon_ids.sort(), [dish('ITM-004').id, dish('ITM-005').id].sort());
  assert.deepEqual(items.filter((i) => i.category_id === categories[0].id).map((i) => i.code), ['ITM-001', 'ITM-002', 'ITM-003']);

  // The same file again changes nothing, even with "update matching".
  const again = await call(base, '/menu/import/preview', { token, method: 'POST', body: { kind: 'items', filename: 'menu.xlsx', data: Buffer.from(file.data).toString('base64') } });
  assert.deepEqual([again.data.counts.new, again.data.counts.error, again.data.counts.kitchens], [0, 0, 0]);
  const second = await call(base, `/menu/import/${again.data.id}/commit`, { token, method: 'POST', body: { mode: 'update' } });
  assert.deepEqual([second.data.summary.created, second.data.summary.updated], [0, 0]);
});
