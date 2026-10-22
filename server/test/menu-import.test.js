// Menu import from one file: existing categories are reused, missing ones are created, and every
// valid dish lands in its category. A new category is never left behind empty because its dishes
// failed, re-importing changes nothing, and the summary is counted from what was saved.
// Runs on its own in-memory database with a fresh restaurant (no demo data).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const writeExcel = require('write-excel-file/node').default;
const { call } = require('./helpers');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Test values for this in-memory server only.
const owner = { restaurantName: 'Import Test Kitchen', adminName: 'Owner', loginId: 'imp-owner', password: 'import-pass-123', pin: '1357' };
let base;
let stop;
let token;
const api = (pathname, options = {}) => call(base, pathname, { token, ...options });
const csv = (lines) => Buffer.from(lines.join('\n')).toString('base64');
const xlsx = async (rows) =>
  (await writeExcel([{ sheet: 'Menu Import', data: rows.map((r) => r.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: String(v) }))) }]).toBuffer()).toString('base64');
const preview = (kind, filename, data) => api('/menu/import/preview', { method: 'POST', body: { kind, filename, data } });
const commit = (id, mode = 'create') => api(`/menu/import/${id}/commit`, { method: 'POST', body: { mode } });
const menu = async () => (await api('/menu?all=1')).data;
// Dishes per category, by category name, as the menu has them now.
const counts = async () => {
  const { categories, items } = await menu();
  return Object.fromEntries(categories.map((c) => [c.name, items.filter((i) => i.category_id === c.id).length]));
};
const pick = (object, keys) => Object.fromEntries(keys.map((k) => [k, object[k]]));
const messages = (result) => result.data.problems.flatMap((p) => [...p.errors, ...(p.result_message ? [p.result_message] : []), ...p.warnings]);

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
  process.env.SETUP_CODE = 'import-test-code';
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

  // The menu of the brief: Breads with 4 dishes, Indian Main Course with 12, Burger with 10.
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...owner, setupCode: 'import-test-code' } })).status, 201);
  token = (await call(base, '/auth/login', { method: 'POST', body: { loginId: owner.loginId, password: owner.password, role: 'admin' } })).data.token;
  const menuOf = { Breads: 4, 'Indian Main Course': 12, Burger: 10 };
  for (const [name, n] of Object.entries(menuOf)) {
    const category = (await api('/menu/categories', { method: 'POST', body: { name } })).data.category;
    for (let i = 1; i <= n; i += 1) {
      const made = await api('/menu/items', { method: 'POST', body: { category_id: category.id, name: `${name} dish ${i}`, veg: true, price: 100 + i, sizes: [], customisations: [] } });
      assert.equal(made.status, 201, JSON.stringify(made.data));
    }
  }
  assert.deepEqual(await counts(), menuOf);
});
test.after(() => stop());

test('the brief: Naan joins Breads, Pasta and Pizza come with their categories (Excel, from Add Category)', async () => {
  const data = await xlsx([['Item ID', 'Item name', 'Category', 'Base Price (INR)'], ['101', 'Naan', 'Breads', 40], ['102', 'Pasta', 'Pasta', 250], ['103', 'Pizza', 'Pizza', 300]]);
  const checked = await preview('categories', 'brief.xlsx', data);
  assert.equal(checked.status, 200, JSON.stringify(checked.data));
  assert.deepEqual(pick(checked.data.counts, ['new', 'update', 'error', 'rows', 'new_categories', 'reused', 'items']), { new: 5, update: 0, error: 0, rows: 3, new_categories: 2, reused: 1, items: 3 });
  assert.deepEqual(checked.data.reused, ['Breads']);

  const before = await counts();
  const done = await commit(checked.data.id);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const s = done.data.summary;
  assert.deepEqual(
    pick(s, ['rows', 'categories_created', 'categories_reused', 'duplicates', 'rows_failed']),
    { rows: 3, categories_created: ['Pasta', 'Pizza'], categories_reused: ['Breads'], duplicates: 0, rows_failed: 0 }
  );
  assert.deepEqual(s.items, { created: 3, updated: 0, skipped: 0, failed: 0 });
  assert.deepEqual(await counts(), { ...before, Breads: 5, Pasta: 1, Pizza: 1 });

  // Each dish is in the right category, and no category name appears twice.
  const { categories, items } = await menu();
  const home = (code) => categories.find((c) => c.id === items.find((i) => i.code === code).category_id).name;
  assert.deepEqual(['101', '102', '103'].map(home), ['Breads', 'Pasta', 'Pizza']);
  assert.equal(new Set(categories.map((c) => c.name.toLowerCase())).size, categories.length);
});

test('importing the same file again adds nothing and says why', async () => {
  const data = await xlsx([['Item ID', 'Item name', 'Category', 'Base Price (INR)'], ['101', 'Naan', 'Breads', 40], ['102', 'Pasta', 'Pasta', 250], ['103', 'Pizza', 'Pizza', 300]]);
  const before = await counts();
  const checked = await preview('items', 'brief.xlsx', data);
  assert.deepEqual(pick(checked.data.counts, ['new', 'update', 'error', 'reused']), { new: 0, update: 3, error: 0, reused: 3 });
  const created = (await commit(checked.data.id)).data;
  assert.deepEqual(pick(created.summary, ['categories_created', 'duplicates', 'rows_failed']), { categories_created: [], duplicates: 3, rows_failed: 0 });
  assert.deepEqual(created.summary.items, { created: 0, updated: 0, skipped: 3, failed: 0 });
  assert.ok(created.problems.every((p) => p.result_message === 'Already on the menu'));
  const updated = (await commit((await preview('items', 'brief.xlsx', data)).data.id, 'update')).data;
  assert.deepEqual(updated.summary.items, { created: 0, updated: 0, skipped: 3, failed: 0 });
  assert.deepEqual(await counts(), before);
});

test('a plain "Name" heading beside a Category column is the dish, whichever button started the import', async () => {
  const data = csv(['ID,Name,Category,Price', '201,Garlic Naan,Breads,60', '202,Veg Burger,Burger,120']);
  const checked = await preview('categories', 'names.csv', data);
  assert.deepEqual(checked.data.columns.map((c) => c.field), ['item_code', 'item_name', 'category_name', 'portion_price']);
  const before = await counts();
  const done = (await commit(checked.data.id)).data;
  assert.deepEqual(pick(done.summary, ['categories_created', 'categories_reused']), { categories_created: [], categories_reused: ['Breads', 'Burger'] });
  assert.deepEqual(await counts(), { ...before, Breads: before.Breads + 1, Burger: before.Burger + 1 });
  // A file of categories only still reads "Name" as the category.
  const only = await preview('categories', 'categories.csv', csv(['Name,Description', 'Thalis,Full meals on one plate']));
  assert.deepEqual(only.data.columns.map((c) => c.field), ['category_name', 'category_description']);
});

test('several dishes into an existing category and two new categories in one file; the summary matches the menu', async () => {
  const data = csv([
    'Item ID,Item Name,Category ID,Category Name,Base Price',
    'B11,Chicken Burger,,Burger,180',
    'B12,Paneer Burger,,Burger,160',
    'B13,Fish Burger,CAT-BUR,Burger,200',
    'S1,Greek Salad,CAT-SAL,Salads,190',
    'S2,Caesar Salad,CAT-SAL,Salads,210',
    'D1,Gulab Jamun,CAT-DES,Desserts,90',
    'D2,Rasmalai,CAT-DES,Desserts,110',
  ]);
  const before = await menu();
  const beforeCounts = await counts();
  const done = (await commit((await preview('items', 'mixed.csv', data)).data.id)).data;
  const s = done.summary;
  assert.deepEqual(pick(s, ['rows', 'categories_created', 'categories_reused', 'rows_failed']), { rows: 7, categories_created: ['Salads', 'Desserts'], categories_reused: ['Burger'], rows_failed: 0 });
  assert.equal(s.items.created, 7);
  const after = await menu();
  assert.equal(after.items.length - before.items.length, s.items.created);
  assert.equal(after.categories.length - before.categories.length, s.categories_created.length);
  assert.deepEqual(await counts(), { ...beforeCounts, Burger: beforeCounts.Burger + 3, Salads: 2, Desserts: 2 });
  assert.equal(after.categories.find((c) => c.name === 'Salads').code, 'CAT-SAL');
  // "Create new only" leaves the existing Burger as it was, even though the file gives it an ID.
  assert.equal(after.categories.find((c) => c.name === 'Burger').code, null);
});

test('a dish without a price is left out with the reason, and its new category is not created empty', async () => {
  const data = csv(['Item Name,Category,Price', 'Tomato Soup,Soups,', 'Kulcha,Breads,50', 'Paneer Wrap,Wraps,150', 'Chicken Wrap,Wraps,abc']);
  const checked = await preview('items', 'prices.csv', data);
  assert.deepEqual(pick(checked.data.counts, ['error_rows', 'new_categories']), { error_rows: 2, new_categories: 1 });
  const soups = checked.data.records.find((r) => r.kind === 'category' && r.name === 'Soups');
  assert.equal(soups.status, 'error');
  assert.match(soups.errors.join(' '), /Not created: none of its 1 dish can be imported/);
  const before = await counts();
  const done = await commit(checked.data.id);
  const s = done.data.summary;
  assert.deepEqual(pick(s, ['categories_created', 'categories_reused', 'rows_failed']), { categories_created: ['Wraps'], categories_reused: ['Breads'], rows_failed: 2 });
  assert.equal(s.items.created, 2);
  const said = messages(done).join(' | ');
  assert.match(said, /price is missing/);
  assert.match(said, /price "abc" is not a number/);
  const after = await counts();
  assert.equal(after.Soups, undefined);
  assert.deepEqual(after, { ...before, Breads: before.Breads + 1, Wraps: 1 });
});

test('Item IDs of one character and with underscores are accepted; an ID with a space is explained', async () => {
  const done = await commit((await preview('items', 'ids.csv', csv(['Item ID,Item Name,Category,Price', '1,Plain Dosa,Dosa,80', 'A_1,Masala Dosa,Dosa,95', 'A 1,Onion Dosa,Dosa,90']))).data.id);
  assert.equal(done.data.summary.items.created, 2);
  assert.match(messages(done).join(' '), /Item ID "A 1" should be 1 to 12 letters, digits, hyphens or underscores/);
  const { categories, items } = await menu();
  const dosa = categories.find((c) => c.name === 'Dosa');
  assert.deepEqual(items.filter((i) => i.category_id === dosa.id).map((i) => i.code).sort(), ['1', 'A_1']);
  // The dish form follows the same rule.
  assert.equal((await api('/menu/items', { method: 'POST', body: { category_id: dosa.id, code: '7', name: 'Rava Dosa', veg: true, price: 99, sizes: [], customisations: [] } })).status, 201);
  const refused = await api('/menu/items', { method: 'POST', body: { category_id: dosa.id, code: 'A B', name: 'Mysore Dosa', veg: true, price: 99, sizes: [], customisations: [] } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.message, /1 to 12 letters, digits, hyphens or underscores/);
});

test('deleted dishes no longer hold their Item IDs: a file can be imported again after its category was deleted', async () => {
  const data = csv(['Item ID,Item Name,Category,Price', 'ITM-777,Paneer Kathi Roll,Kathi Rolls,150', 'ITM-778,Egg Kathi Roll,Kathi Rolls,130']);
  const first = (await commit((await preview('items', 'rolls.csv', data)).data.id)).data.summary;
  assert.deepEqual([first.items.created, first.categories_created], [2, ['Kathi Rolls']]);
  const rolls = (await menu()).categories.find((c) => c.name === 'Kathi Rolls');
  assert.equal((await api(`/menu/categories/${rolls.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await counts())['Kathi Rolls'], undefined);

  const checked = await preview('items', 'rolls.csv', data);
  assert.deepEqual(pick(checked.data.counts, ['new', 'error']), { new: 3, error: 0 });
  const again = (await commit(checked.data.id)).data;
  assert.deepEqual(pick(again.summary, ['categories_created', 'rows_failed']), { categories_created: ['Kathi Rolls'], rows_failed: 0 });
  assert.equal(again.summary.items.created, 2);
  assert.equal((await counts())['Kathi Rolls'], 2);
});

test('empty, header-only, wrongly typed and broken files are refused with a reason; repeated rows are counted once', async () => {
  assert.match((await preview('items', 'menu.csv', '')).data.message, /empty/);
  assert.match((await preview('items', 'menu.csv', csv(['Item Name,Category,Price']))).data.message, /headings but no rows/);
  assert.match((await preview('items', 'menu.xlsx', Buffer.from('not a spreadsheet').toString('base64'))).data.message, /not a real Excel/);
  assert.match((await preview('items', 'menu.xls', csv(['a']))).data.message, /Old \.xls/);
  const unmapped = await preview('items', 'menu.csv', csv(['Category,Price', 'Breads,40']));
  assert.equal(unmapped.data.needs_mapping, true);
  assert.deepEqual(unmapped.data.missing, ['Item name']);
  const negative = await preview('items', 'menu.csv', csv(['Item Name,Category,Price', 'Free Naan,Breads,-5']));
  assert.match(negative.data.records.find((r) => r.kind === 'item').errors.join(' '), /negative/);

  const before = await counts();
  const repeated = await preview('items', 'menu.csv', csv(['Item Name,Category,Price', 'Butter Kulcha,Breads,55', 'Butter Kulcha,Breads,55', 'Butter Kulcha,Breads,60']));
  assert.equal(repeated.data.counts.items, 1);
  const warned = repeated.data.records.find((r) => r.kind === 'item').warnings.join(' | ');
  assert.match(warned, /counted once/);
  assert.match(warned, /price 60 was left out/);
  const done = (await commit(repeated.data.id)).data.summary;
  assert.deepEqual(pick(done, ['duplicates', 'repeated_rows', 'rows', 'rows_failed']), { duplicates: 2, repeated_rows: 2, rows: 3, rows_failed: 0 });
  assert.deepEqual(await counts(), { ...before, Breads: before.Breads + 1 });
});

test('a dish that cannot be saved takes its new category back out with it', async () => {
  const menuRoutes = require('../src/routes/menu');
  const real = menuRoutes.insertItem;
  menuRoutes.insertItem = async (...args) => {
    if (args[4].name === 'Broken Dish') throw Object.assign(new Error('the disk is full'), { code: '53100' });
    return real(...args);
  };
  try {
    const before = await counts();
    const done = await commit((await preview('items', 'broken.csv', csv(['Item Name,Category,Price', 'Broken Dish,Broken Category,100', 'Fine Dish,Fine Category,100']))).data.id);
    const s = done.data.summary;
    assert.deepEqual(pick(s, ['categories_created', 'rows_failed']), { categories_created: ['Fine Category'], rows_failed: 1 });
    assert.equal(s.items.created, 1);
    const said = messages(done).join(' | ');
    assert.match(said, /Could not be saved/);
    assert.match(said, /Not created, because none of its dishes could be saved/);
    assert.deepEqual(await counts(), { ...before, 'Fine Category': 1 });
  } finally {
    menuRoutes.insertItem = real;
  }
});

test('two previews of the same new category, imported one after the other, make one category', async () => {
  const first = await preview('items', 'a.csv', csv(['Item Name,Category,Price', 'Veg Momo,Momos,120']));
  const second = await preview('items', 'b.csv', csv(['Item Name,Category,Price', 'Chicken Momo,Momos,150']));
  assert.equal(first.data.counts.new_categories, 1);
  assert.equal(second.data.counts.new_categories, 1);
  assert.deepEqual((await commit(first.data.id)).data.summary.categories_created, ['Momos']);
  const later = (await commit(second.data.id)).data.summary;
  assert.deepEqual(pick(later, ['categories_created', 'categories_reused']), { categories_created: [], categories_reused: ['Momos'] });
  const { categories } = await menu();
  assert.equal(categories.filter((c) => c.name === 'Momos').length, 1);
  assert.equal((await counts()).Momos, 2);
});
