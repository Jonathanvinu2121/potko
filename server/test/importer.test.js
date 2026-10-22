// Menu import: reading files, matching columns and checking rows (no database involved).
const test = require('node:test');
const assert = require('node:assert/strict');
const importer = require('../src/importer');

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const existing = {
  categories: [{ id: 1, name: 'Starters', description: null, active: true, sort: 1 }],
  items: [{ id: 10, code: 'STR01', name: 'Veg Spring Roll', category_id: 1, sizes: [], price: 140, description: null, tax_rate: null, tax_mode: null, available: true, modifier_groups: [], terminal_id: null }],
  terminals: [{ id: 1, name: 'Main Kitchen', active: true }, { id: 2, name: 'Tandoor', active: true }],
};

async function check(csv, kind = 'items', mapping = null) {
  const sheets = await importer.readFile('menu.csv', b64(csv));
  const records = importer.buildRecords(sheets, kind, mapping);
  const counts = records.missing.length ? null : importer.classify(records, existing, kind);
  return { records, counts };
}

test('CSV: quotes, commas and line breaks inside a cell', () => {
  const rows = importer.parseCsv('﻿name,note\r\n"Paneer, Tikka","said ""hot""\nplease"\r\nNaan,\r\n');
  assert.deepEqual(rows, [['name', 'note'], ['Paneer, Tikka', 'said "hot"\nplease'], ['Naan', '']]);
});

test('rows of one item fold into portions and add-ons', async () => {
  const { records, counts } = await check([
    'category_name,item_code,item_name,portion_name,portion_price,addon_group,addon_name,addon_price,addon_required,addon_max_select,kitchen_terminal',
    'Starters,STR10,Paneer Tikka,Half,180,Extras,Extra Cheese,30,FALSE,2,Tandoor',
    'Starters,STR10,Paneer Tikka,Full,320,Extras,Mint Chutney,10,,,',
  ].join('\n'));
  assert.equal(records.items.length, 1);
  const item = records.items[0];
  assert.deepEqual(item.sizes, [{ label: 'Half', price: 180 }, { label: 'Full', price: 320 }]);
  assert.equal(item.price, 180); // no base price in the file: the first portion's
  assert.deepEqual(item.groups, [{ name: 'Extras', required: false, min: 0, max: 2, options: [{ name: 'Extra Cheese', price: 30 }, { name: 'Mint Chutney', price: 10 }] }]);
  assert.equal(item.terminal_id, 2);
  assert.equal(item.status, 'new');
  assert.deepEqual(counts, { new: 1, update: 0, error: 0, warnings: 0, rows: 2, error_rows: 0, new_categories: 0, reused: 1, categories: 0, items: 1, kitchens: 0 });
});

test('the compact "Regular|180,Large|240" style is read too', async () => {
  const { records } = await check('Item Name,Category,Portions,Add-ons\nClassic Burger,Starters,"Regular|180,Large|240","Extra Cheese|30,Onions|10"');
  const item = records.items[0];
  assert.deepEqual(item.sizes, [{ label: 'Regular', price: 180 }, { label: 'Large', price: 240 }]);
  assert.deepEqual(item.groups[0].options, [{ name: 'Extra Cheese', price: 30 }, { name: 'Onions', price: 10 }]);
});

test('bad rows are blocked with a reason; good rows still pass', async () => {
  const { records, counts } = await check([
    'category_name,item_name,portion_price,tax_rate,tax_mode',
    'Starters,Good Dish,120,5,EXCLUSIVE',
    'Starters,No Price,,,',
    'Starters,Negative,-40,,',
    'Starters,Bad Tax,100,150,',
    'Starters,Bad Mode,100,5,SOMETIMES',
    'Nowhere,Lost Dish,90,,',
    ',Orphan,50,,',
  ].join('\n'));
  const byName = Object.fromEntries(records.items.map((i) => [i.name, i]));
  assert.equal(byName['Good Dish'].status, 'new');
  assert.match(byName['No Price'].errors[0], /price is missing/);
  assert.match(byName.Negative.errors[0], /negative/);
  assert.match(byName['Bad Tax'].errors[0], /tax rate/);
  assert.match(byName['Bad Mode'].errors[0], /Restaurant, Custom or None/);
  // A category that is not on the menu yet comes along as a new one (shown in the preview).
  assert.equal(byName['Lost Dish'].status, 'new');
  assert.equal(records.categories.find((c) => c.name === 'Nowhere').status, 'new');
  assert.match(byName.Orphan.errors[0], /category is missing/);
  assert.equal(counts.new, 3);
  assert.equal(counts.error, 5);
});

test('an item already on the menu is matched by its code and shows what would change', async () => {
  const { records } = await check('category_name,item_code,item_name,portion_price\nStarters,str01,Veg Spring Roll,160');
  assert.equal(records.items[0].status, 'update');
  assert.equal(records.items[0].match_id, 10);
  assert.deepEqual(records.items[0].changes, [{ field: 'Price', old: '140', new: '160' }]);
});

test('a kitchen the restaurant does not have yet is created with the import, never a silent fallback', async () => {
  const { records, counts } = await check('category_name,item_name,portion_price,kitchen_terminal\nStarters,Soup,90,Grill|Tandoor');
  assert.deepEqual(records.items[0].errors, []);
  assert.deepEqual(records.items[0].terminal_ids, [2]); // Tandoor exists
  assert.deepEqual(records.items[0].new_kitchens, ['Grill']);
  assert.deepEqual(records.new_kitchens, ['Grill']);
  assert.equal(counts.kitchens, 1);
});

test('categories: new, existing and broken rows', async () => {
  const { records, counts } = await check('category_name,category_description,category_display_order,category_active\nStarters,Small plates,1,TRUE\nPizza,Wood fired,2,maybe\nPasta,,3,FALSE', 'categories');
  const byName = Object.fromEntries(records.categories.map((c) => [c.name, c]));
  assert.equal(byName.Starters.status, 'update');
  assert.equal(byName.Pizza.status, 'error');
  assert.equal(byName.Pasta.status, 'new');
  assert.equal(byName.Pasta.active, false);
  assert.equal(counts.new, 1);
});

test('headings that are not recognised ask for a mapping, and a chosen mapping is used', async () => {
  const csv = 'Dish,Group,Cost\nSoup,Starters,90';
  const first = await check(csv);
  assert.deepEqual(first.records.missing, ['category_name']);
  const second = await check(csv, 'items', { Group: 'category_name', Cost: 'portion_price' });
  assert.equal(second.records.items[0].price, 90);
  assert.equal(second.records.items[0].status, 'new');
});

test('files are checked by content, not by name', async () => {
  await assert.rejects(importer.readFile('menu.xls', b64('x')), /\.xls files are not supported/);
  await assert.rejects(importer.readFile('menu.xlsx', b64('not a zip')), /not a real Excel/);
  await assert.rejects(importer.readFile('menu.exe', b64('x')), /\.csv or \.xlsx/);
  await assert.rejects(importer.readFile('menu.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]).toString('base64')), /not a text/);
});

test('the menu template (one file for categories and items) can be read back by the importer', async () => {
  for (const kind of ['categories', 'items']) {
    const file = await importer.template(kind, 'xlsx');
    const sheets = await importer.readFile('template.xlsx', file.toString('base64'));
    assert.deepEqual(sheets.map((s) => s.sheet), ['Menu Import', 'Read Me']);
    const records = importer.buildRecords(sheets, kind, null);
    assert.deepEqual(records.missing, []);
    assert.equal(records.mapping.filter(Boolean).length, 17); // every column is read
    assert.equal(records.categories.length, 6);
    assert.equal(records.items.length, 9); // one import: started from Add Category or "+ Add", the dishes come too
  }
  const csv = await importer.template('items', 'csv');
  const records = importer.buildRecords(await importer.readFile('t.csv', csv.toString('base64')), 'items', null);
  assert.equal(records.items.find((i) => i.code === 'ITM-001').sizes.length, 2);
});

test('the combined format: Name:Price lists, several kitchens, open price, tax choice and go well with', async () => {
  const head = 'Item ID,Item Name,Category Name,Item Type (Veg/Non-veg),Base Price (INR),Open Price? (Yes/No),Tax Mode (Restaurant/Custom/None),Custom Tax Rate (%),Kitchen Terminals,Portions and Prices,Add-ons and Prices,Suggested Item IDs (for Go Well With)';
  const { records } = await check([
    head,
    'ITEM-PTM-001,Paneer Tikka Masala,Starters,Veg,220,No,Restaurant,,Tandoor | Main Kitchen,Regular:220 | Family:390,Extra Gravy:30 | Extra Cheese:25,ITEM-SR-002 | STR01 | NOPE-1',
    'ITEM-SR-002,Soup of the Day,Starters,Non-veg,,Yes,None,,,,,',
    'ITEM-CT-003,Chai,Starters,Veg,20,No,Custom,,,,,',
  ].join('\n'));
  const [paneer, soup, chai] = records.items;
  assert.deepEqual(paneer.sizes, [{ label: 'Regular', price: 220 }, { label: 'Family', price: 390 }]);
  assert.deepEqual(paneer.groups[0].options, [{ name: 'Extra Gravy', price: 30 }, { name: 'Extra Cheese', price: 25 }]);
  assert.equal(paneer.groups[0].name, 'Add-ons'); // the dish form's own add-on list
  assert.equal(paneer.terminal_ids.length, 2);
  assert.equal(paneer.tax_rate, null); // Restaurant: the restaurant's own tax
  assert.deepEqual(paneer.suggestions, ['ITEM-SR-002', 'STR01', 'NOPE-1']);
  assert.match(paneer.warnings[0], /no item with code "NOPE-1"/); // in the file or on the menu, else left out
  assert.equal(soup.open_price, true);
  assert.equal(soup.status, 'new'); // no price needed for an open-price dish
  assert.equal(soup.tax_rate, 0); // None
  assert.match(chai.errors[0], /custom tax rate/);
});

test('the error report cannot smuggle a formula into Excel', () => {
  assert.equal(importer.safeCell('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(importer.safeCell('+1'), "'+1");
  assert.equal(importer.safeCell('Paneer'), 'Paneer');
  const report = importer.errorReport({ categories: [], items: [{ rows: [2], name: '=cmd', errors: ['bad'], warnings: [] }] }).toString('utf8');
  assert.ok(report.includes("'=cmd"));
});
