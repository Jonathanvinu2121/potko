// Menu import from a CSV or Excel file: reading the file, matching its columns to the fields
// we know, and checking every row. Nothing here touches the database; routes/import.js does
// the saving. Keeping the checks pure makes them easy to test.
const readExcel = require('read-excel-file/node').default;
const writeExcel = require('write-excel-file/node').default;
const { AppError } = require('./errors');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const bad = (message) => new AppError(400, 'bad_file', message);

// ---------- Reading the file ----------

// A small CSV reader: quoted fields, doubled quotes, commas and line breaks inside quotes, and
// a byte-order mark at the start. Semicolon-separated files (some Excel locales) are accepted too.
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// An .xlsx file is a zip. Before unpacking it, add up the sizes its own directory claims, so a
// tiny file that unpacks to gigabytes is refused.
function checkZip(buffer) {
  let total = 0;
  let entries = 0;
  for (let i = buffer.indexOf('PK\x01\x02', 0, 'latin1'); i >= 0 && i + 46 <= buffer.length; i = buffer.indexOf('PK\x01\x02', i + 46, 'latin1')) {
    total += buffer.readUInt32LE(i + 24);
    entries += 1;
    if (entries > 2000 || total > 60 * 1024 * 1024) throw bad('This Excel file is too large to import');
  }
  if (entries === 0) throw bad('This file is not a real Excel (.xlsx) file');
}

// Returns [{ sheet, rows }] where rows is a table of trimmed strings, empty rows removed.
async function readFile(filename, base64) {
  const name = String(filename || '').trim();
  const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase();
  if (ext === 'xls') throw bad('Old .xls files are not supported. Save the file as .xlsx or .csv and upload it again.');
  if (ext !== 'csv' && ext !== 'xlsx') throw bad('Upload a .csv or .xlsx file');
  const buffer = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buffer.length === 0) throw bad('The file is empty');
  if (buffer.length > MAX_BYTES) throw bad('The file is larger than 5 MB');

  let sheets;
  const isZip = buffer.subarray(0, 4).toString('latin1') === 'PK\x03\x04';
  if (ext === 'xlsx') {
    if (!isZip) throw bad('This file is not a real Excel (.xlsx) file');
    checkZip(buffer);
    try {
      sheets = (await readExcel(buffer)).map((s) => ({ sheet: s.sheet, rows: s.data }));
    } catch {
      throw bad('This Excel file could not be read. Save it again as .xlsx and retry.');
    }
  } else {
    if (isZip || buffer.includes(0)) throw bad('This file is not a text .csv file');
    sheets = [{ sheet: 'CSV', rows: parseCsv(buffer.toString('utf8')) }];
  }

  const clean = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
  const out = sheets
    .map((s) => ({ sheet: s.sheet, rows: s.rows.map((r) => r.map(clean)).filter((r) => r.some((c) => c !== '')) }))
    .filter((s) => s.rows.length > 0);
  if (out.length === 0) throw bad('The file has no rows');
  if (out.reduce((n, s) => n + s.rows.length, 0) > MAX_ROWS + 10) throw bad(`Import up to ${MAX_ROWS} rows at a time`);
  return out;
}

// ---------- Columns ----------

// field -> { label, required for which kind, other headings people use for it }
const FIELDS = {
  category_code: { label: 'Category ID', also: ['category id', 'category code', 'cat id', 'category_id'] },
  category_name: { label: 'Category name', also: ['category', 'category name', 'cat', 'menu category'] },
  category_description: { label: 'Category description', also: ['category description'] },
  category_display_order: { label: 'Category display order', also: ['category order', 'category display order'] },
  category_active: { label: 'Category active', also: ['category status', 'category active'] },
  item_code: { label: 'Item ID', also: ['sku', 'code', 'item code', 'item sku', 'item_code / sku', 'item id', 'id'] },
  item_name: { label: 'Item name', also: ['item', 'name', 'item name', 'dish', 'dish name', 'product'] },
  item_description: { label: 'Item description', also: ['description', 'item description', 'details'] },
  item_image_url: { label: 'Item image URL', also: ['image', 'image url', 'item image', 'photo'] },
  item_display_order: { label: 'Item display order', also: ['display order', 'order', 'sort', 'item order'] },
  item_active: { label: 'Item active', also: ['active', 'status', 'item status', 'available', 'availability'] },
  veg: { label: 'Veg / Non-veg', also: ['veg', 'type', 'veg/non-veg', 'food type', 'diet', 'item type'] },
  portion_name: { label: 'Portion name', also: ['portion', 'size', 'portion name', 'variant'] },
  portion_price: { label: 'Portion price', also: ['price', 'base price', 'portion price', 'rate', 'mrp', 'amount'] },
  portions: { label: 'Portions and prices', also: ['portions', 'sizes', 'variants', 'portions and prices'] },
  open_price: { label: 'Open price', also: ['open price', 'open'] },
  tax_rate: { label: 'Custom tax rate', also: ['tax', 'tax rate', 'gst', 'gst rate', 'tax %', 'gst %', 'custom tax rate', 'custom tax'] },
  tax_mode: { label: 'Tax mode', also: ['tax mode', 'tax type', 'inclusive/exclusive'] },
  addon_group: { label: 'Add-on group', also: ['addon group', 'add-on group', 'modifier group', 'group'] },
  addon_name: { label: 'Add-on name', also: ['addon', 'add-on', 'addon name', 'add-on name', 'modifier'] },
  addon_price: { label: 'Add-on price', also: ['addon price', 'add-on price', 'modifier price'] },
  addon_required: { label: 'Add-on required', also: ['addon required', 'required'] },
  addon_min_select: { label: 'Add-on minimum', also: ['addon min select', 'min select', 'addon min', 'min'] },
  addon_max_select: { label: 'Add-on maximum', also: ['addon max select', 'max select', 'addon max', 'max'] },
  addons: { label: 'Add-ons and prices', also: ['add-ons', 'addons', 'add ons', 'modifiers', 'extras', 'add-ons and prices', 'addons and prices'] },
  kitchen_terminal: { label: 'Kitchen terminals', also: ['terminal', 'kitchen', 'kitchen terminal', 'counter', 'station', 'kot terminal', 'kitchen terminals', 'terminals', 'kitchens'] },
  suggestions: { label: 'Go well with (item IDs)', also: ['suggested item ids', 'suggested item codes', 'suggested items', 'go well with', 'goes well with', 'suggestions'] },
  notes: { label: 'Notes', also: ['note', 'notes', 'remarks', 'comment'] },
};
const CATEGORY_FIELDS = ['category_code', 'category_name', 'category_description', 'category_display_order', 'category_active'];
const REQUIRED = { categories: ['category_name'], items: ['item_name', 'category_name'] };

const norm = (s) => String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[*()?]/g, ' ').replace(/[_\s]+/g, ' ').trim();

// Guesses which field each heading is. In a categories-only file "name" means the category.
function guessMapping(headers, kind) {
  const hasItemName = headers.some((h) => ['item name', 'item', 'dish', 'dish name'].includes(norm(h)));
  const used = new Set();
  return headers.map((header) => {
    const h = norm(header);
    if (!h) return null;
    let field = Object.keys(FIELDS).find((f) => norm(f) === h) || Object.keys(FIELDS).find((f) => FIELDS[f].also.includes(h));
    if (kind === 'categories' && !hasItemName) {
      if (['name', 'category'].includes(h)) field = 'category_name';
      else if (h === 'description') field = 'category_description';
      else if (['display order', 'order', 'sort'].includes(h)) field = 'category_display_order';
      else if (['status', 'active'].includes(h)) field = 'category_active';
    }
    if (!field || used.has(field)) return null;
    used.add(field);
    return field;
  });
}

// The headings and the field each is read as. `chosen` is the user's own mapping, by heading.
function mapColumns(headers, kind, chosen) {
  const guessed = guessMapping(headers, kind);
  const mapping = headers.map((header, i) => {
    if (chosen && Object.prototype.hasOwnProperty.call(chosen, header)) return FIELDS[chosen[header]] ? chosen[header] : null;
    return guessed[i];
  });
  const missing = REQUIRED[kind].filter((f) => !mapping.includes(f));
  return { mapping, missing };
}

// ---------- Values ----------

const TRUE = ['true', 'yes', 'y', '1', 'active', 'on', 'available', 'enabled'];
const FALSE = ['false', 'no', 'n', '0', 'inactive', 'off', 'unavailable', 'disabled'];
function readBool(value) {
  const v = String(value).trim().toLowerCase();
  if (v === '') return null;
  if (TRUE.includes(v)) return true;
  if (FALSE.includes(v)) return false;
  return undefined; // not understood
}
function readVeg(value) {
  const v = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (v === '') return null;
  if (['veg', 'vegetarian', 'v', 'true', 'yes'].includes(v)) return true;
  if (['nonveg', 'nonvegetarian', 'nv', 'n', 'false', 'no', 'egg'].includes(v)) return false;
  return undefined;
}
// "180", "₹180.00", "Rs. 1,250" -> number; anything else -> NaN.
function readPrice(value) {
  const v = String(value).replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (v === '' || !/^-?\d+(\.\d+)?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100) / 100;
}
// "Regular:220 | Family:390" (the template) or the older "Regular|180,Large|240" -> [{ name, price }].
// The price may be left out for add-ons ("Onions").
function readPairs(value, problems, what) {
  const out = [];
  const text = String(value);
  const colon = /[:=]/.test(text);
  for (const part of text.split(colon ? /[|,;\n]/ : /[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const [name, price = ''] = part.split(colon ? /[:=]/ : /[|]/).map((p) => p.trim());
    const amount = price === '' ? 0 : readPrice(price);
    if (!name || Number.isNaN(amount) || amount < 0) problems.push(`${what} "${part}" is not written as Name:Price`);
    else out.push({ name: name.slice(0, 30), price: amount });
  }
  return out;
}

// "Main Kitchen | Tandoor" or "ITEM-ROT-001 | ITEM-BN-002" -> the names, trimmed, in order.
const readList = (value) => String(value).split(/[|,;\n]/).map((p) => p.trim()).filter(Boolean);

// ---------- Rows to records ----------

// Turns one sheet into objects keyed by field, each remembering its row number in the file.
function sheetObjects(sheet, kind, chosen) {
  const [headers, ...rows] = sheet.rows;
  const { mapping, missing } = mapColumns(headers, kind, chosen);
  const objects = rows.map((row, index) => {
    const o = { _row: index + 2, _sheet: sheet.sheet };
    mapping.forEach((field, i) => { if (field) o[field] = row[i] ?? ''; });
    return o;
  });
  return { headers, mapping, missing, objects };
}

const sameKey = (s) => String(s || '').trim().toLowerCase();

// Builds category records: one per name, with any problems found.
function buildCategories(objects) {
  const byName = new Map();
  for (const o of objects) {
    const name = String(o.category_name || '').trim().slice(0, 40);
    const code = String(o.category_code || '').trim().toUpperCase().slice(0, 13);
    if (!name && CATEGORY_FIELDS.every((f) => !o[f])) continue;
    const key = code ? `code:${code}` : `name:${sameKey(name)}`;
    const rec = byName.get(key) || { rows: [], name, code: code || null, description: null, position: null, active: null, errors: [], warnings: [] };
    rec.rows.push(o._row);
    if (!name) rec.errors.push('Category name is missing');
    else if (rec.name && sameKey(rec.name) !== sameKey(name) && !rec.errors.some((e) => e.includes('two names'))) rec.errors.push(`Category ID ${code} is used with two names ("${rec.name}" and "${name}")`);
    if (code && !/^[A-Z0-9-]{2,12}$/.test(code) && !rec.errors.some((e) => e.includes('Category ID "'))) rec.errors.push(`Category ID "${code}" should be 2 to 12 letters, digits or hyphens`);
    if (o.category_description) rec.description = String(o.category_description).slice(0, 120);
    if (o.category_display_order) {
      const n = Number(o.category_display_order);
      if (Number.isInteger(n) && n > 0) rec.position = n;
      else rec.errors.push(`Display order "${o.category_display_order}" is not a whole number`);
    }
    if (o.category_active !== undefined) {
      const b = readBool(o.category_active);
      if (b === undefined) rec.errors.push(`Active "${o.category_active}" should be TRUE or FALSE`);
      else if (b !== null) rec.active = b;
    }
    byName.set(name || code ? key : `row-${o._row}`, rec);
  }
  return [...byName.values()];
}

// Builds item records from flat rows: rows of the same item (same code, or same category and
// name) are folded into one item with several portions and add-ons.
function buildItems(objects) {
  const byKey = new Map();
  for (const o of objects) {
    const name = String(o.item_name || '').trim().slice(0, 80);
    const code = String(o.item_code || '').trim().toUpperCase().slice(0, 13);
    const category = String(o.category_name || '').trim().slice(0, 40);
    const categoryCode = String(o.category_code || '').trim().toUpperCase().slice(0, 13);
    if (!name && !code && !o.portion_price && !o.addon_name) continue; // a category-only row
    const key = code ? `code:${code}` : `name:${sameKey(category)}|${sameKey(name)}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        rows: [], code: code || null, name, category, category_code: categoryCode || null, description: null, veg: null, sizes: [], price: null, groups: [], open_price: null,
        tax_rate: null, tax_mode: null, tax_kind: null, terminals: [], suggestions: null, position: null, active: null, image_url: null, errors: [], warnings: [],
      };
      byKey.set(key, rec);
    }
    rec.rows.push(o._row);
    const at = `Row ${o._row}: `;
    if (!name) rec.errors.push(`${at}item name is missing`);
    else if (rec.name && sameKey(rec.name) !== sameKey(name)) rec.warnings.push(`${at}Item ID ${code} is used with two names ("${rec.name}" and "${name}"); the first is kept`);
    if (!rec.name) rec.name = name;
    if (!category && !rec.category) rec.errors.push(`${at}category is missing`);
    if (category && !rec.category) rec.category = category;
    if (code && !/^[A-Z0-9-]{2,12}$/.test(code)) rec.errors.push(`${at}Item ID "${code}" should be 2 to 12 letters, digits or hyphens`);

    if (o.item_description) rec.description = String(o.item_description).slice(0, 200);
    if (o.item_image_url) rec.image_url = String(o.item_image_url).slice(0, 300);
    if (o.veg !== undefined) {
      const v = readVeg(o.veg);
      if (v === undefined) rec.warnings.push(`${at}"${o.veg}" is not Veg or Non-veg; left as Veg`);
      else if (v !== null) rec.veg = v;
    }
    if (o.item_active !== undefined) {
      const b = readBool(o.item_active);
      if (b === undefined) rec.errors.push(`${at}active "${o.item_active}" should be TRUE or FALSE`);
      else if (b !== null) rec.active = b;
    }
    if (o.item_display_order) {
      const n = Number(o.item_display_order);
      if (Number.isInteger(n) && n > 0) rec.position = n;
      else rec.errors.push(`${at}display order "${o.item_display_order}" is not a whole number`);
    }
    if (o.kitchen_terminal) for (const name of readList(o.kitchen_terminal)) if (!rec.terminals.some((x) => sameKey(x) === sameKey(name))) rec.terminals.push(name);
    if (o.open_price !== undefined && o.open_price !== '') {
      const b = readBool(o.open_price);
      if (b === undefined) rec.errors.push(`${at}open price "${o.open_price}" should be Yes or No`);
      else rec.open_price = b;
    }
    if (o.suggestions) rec.suggestions = [...new Set([...(rec.suggestions || []), ...readList(o.suggestions).map((c) => c.toUpperCase())])];
    if (o.tax_rate !== undefined && o.tax_rate !== '') {
      const rate = Number(String(o.tax_rate).replace('%', '').trim());
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) rec.errors.push(`${at}tax rate "${o.tax_rate}" should be a number from 0 to 100`);
      else rec.tax_rate = rate;
    }
    // Tax: Restaurant (the restaurant's own tax), Custom (the custom rate) or None (no tax), as in
    // the dish form. Older files say INCLUSIVE or EXCLUSIVE instead.
    if (o.tax_mode) {
      const mode = String(o.tax_mode).trim().toLowerCase();
      if (['restaurant', 'custom', 'none'].includes(mode)) rec.tax_kind = mode;
      else if (['inclusive', 'exclusive'].includes(mode)) rec.tax_mode = mode;
      else rec.errors.push(`${at}tax mode "${o.tax_mode}" should be Restaurant, Custom or None (or INCLUSIVE or EXCLUSIVE)`);
    }

    // Prices: a named portion with its price, a compact list of portions, or one base price.
    const problems = [];
    if (o.portions) for (const p of readPairs(o.portions, problems, 'Portion')) rec.sizes.push({ label: p.name.slice(0, 20), price: p.price });
    const portion = String(o.portion_name || '').trim().slice(0, 20);
    if (o.portion_price !== undefined && o.portion_price !== '') {
      const price = readPrice(o.portion_price);
      if (Number.isNaN(price)) problems.push(`price "${o.portion_price}" is not a number`);
      else if (price < 0) problems.push(`price ${o.portion_price} is negative`);
      else if (portion) rec.sizes.push({ label: portion, price });
      else if (rec.price === null) { rec.price = price; rec.base_given = true; }
    } else if (portion) problems.push(`portion "${portion}" has no price`);

    // Add-ons: one per row with its group and rules, or a compact list.
    if (o.addons) {
      const list = readPairs(o.addons, problems, 'Add-on');
      if (list.length) addOptions(rec, 'Add-ons', list, {});
    }
    if (o.addon_name) {
      const price = o.addon_price === undefined || o.addon_price === '' ? 0 : readPrice(o.addon_price);
      if (Number.isNaN(price) || price < 0) problems.push(`add-on price "${o.addon_price}" is not a number of 0 or more`);
      else {
        const rules = {};
        const required = o.addon_required === undefined ? null : readBool(o.addon_required);
        if (required === undefined) problems.push(`add-on required "${o.addon_required}" should be TRUE or FALSE`);
        else if (required !== null) rules.required = required;
        for (const [field, rule] of [['addon_min_select', 'min'], ['addon_max_select', 'max']]) {
          if (o[field] === undefined || o[field] === '') continue;
          const n = Number(o[field]);
          if (!Number.isInteger(n) || n < 0) problems.push(`${FIELDS[field].label} "${o[field]}" is not a whole number`);
          else rules[rule] = n;
        }
        addOptions(rec, String(o.addon_group || 'Add Ons').trim().slice(0, 30) || 'Add Ons', [{ name: String(o.addon_name).trim().slice(0, 30), price }], rules);
      }
    }
    for (const p of problems) rec.errors.push(at + p);
  }

  for (const rec of byKey.values()) {
    // The same portion or add-on written twice: keep the first, say so.
    const seen = new Set();
    rec.sizes = rec.sizes.filter((s) => {
      const k = sameKey(s.label);
      if (seen.has(k)) { rec.warnings.push(`Portion "${s.label}" is listed twice; the first price is kept`); return false; }
      seen.add(k);
      return true;
    });
    for (const g of rec.groups) {
      const names = new Set();
      g.options = g.options.filter((o) => {
        const k = sameKey(o.name);
        if (names.has(k)) return false;
        names.add(k);
        return true;
      });
      g.required = g.required === true;
      g.max = Math.min(g.options.length, g.max ?? 0);
      g.min = Math.min(g.options.length, Math.max(g.required ? 1 : 0, g.min ?? 0));
      if (g.max > 0 && g.min > g.max) rec.errors.push(`Add-on group "${g.name}": minimum ${g.min} is more than maximum ${g.max}`);
    }
    if (rec.tax_kind === 'restaurant') { rec.tax_rate = null; rec.tax_mode = null; }
    else if (rec.tax_kind === 'none') { rec.tax_rate = 0; rec.tax_mode = null; }
    else if (rec.tax_kind === 'custom' && rec.tax_rate === null) rec.errors.push(`Row ${rec.rows[0]}: tax mode is Custom, so enter the custom tax rate`);
    if (rec.open_price) {
      // An open-price dish has no set price: it is typed in when the dish is ordered.
      if (rec.sizes.length) rec.warnings.push('An open-price item has no portions; the portions were left out');
      rec.sizes = [];
      rec.price = 0;
    }
    // One portion is no choice at all: it is simply the dish's price.
    if (rec.sizes.length === 1) { rec.price = rec.sizes[0].price; rec.sizes = []; }
    if (rec.sizes.length === 0 && rec.price === null && rec.errors.length === 0) rec.errors.push(`Row ${rec.rows[0]}: price is missing`);
    // With portions, the base price given in the file stays (else the first portion's).
    if (rec.sizes.length > 0 && !rec.base_given) rec.price = rec.sizes[0].price;
    delete rec.base_given;
    if (rec.code && rec.suggestions) rec.suggestions = rec.suggestions.filter((c) => c !== rec.code);
    if (rec.image_url) rec.warnings.push('Picture links are not downloaded. Add the picture on the item in the app.');
  }
  return [...byKey.values()];
}

function addOptions(rec, groupName, options, rules) {
  let group = rec.groups.find((g) => sameKey(g.name) === sameKey(groupName));
  if (!group) {
    group = { name: groupName, required: false, min: null, max: null, options: [] };
    rec.groups.push(group);
  }
  group.options.push(...options);
  if (rules.required !== undefined) group.required = rules.required;
  if (rules.min !== undefined) group.min = rules.min;
  if (rules.max !== undefined) group.max = rules.max;
}

// Reads a whole upload into category records and item records.
//   A workbook with sheets named Categories / Items / Portions / AddOns is read sheet by sheet;
//   anything else is read as one flat table from its first sheet.
function buildRecords(sheets, kind, chosen) {
  const find = (name) => sheets.find((s) => norm(s.sheet).replace(/\s|-/g, '') === name);
  const itemsSheet = find('items');
  const multi = !!itemsSheet && (find('portions') || find('addons') || find('categories'));

  if (!multi) {
    const sheet = (kind === 'categories' ? find('categories') : itemsSheet) || sheets[0];
    const { headers, mapping, missing, objects } = sheetObjects(sheet, kind, chosen);
    const hasItems = mapping.includes('item_name');
    return {
      sheet: sheet.sheet,
      headers,
      mapping,
      missing,
      // One import for the whole menu: the categories named in the file (new ones are created) and,
      // when the file has dishes, the dishes. Add Category and "+ Add" open the same import.
      categories: buildCategories(objects),
      items: hasItems ? buildItems(objects) : [],
      declaredCategories: true,
    };
  }

  // Sheet by sheet: portions and add-ons point at their item by code or by name.
  const main = sheetObjects(itemsSheet, 'items', chosen);
  const objects = [...main.objects];
  const byCode = new Map(main.objects.filter((o) => o.item_code).map((o) => [sameKey(o.item_code), o]));
  const byName = new Map(main.objects.filter((o) => o.item_name).map((o) => [sameKey(o.item_name), o]));
  const orphans = [];
  for (const extra of [find('portions'), find('addons')].filter(Boolean)) {
    for (const o of sheetObjects(extra, 'items', null).objects) {
      const parent = (o.item_code && byCode.get(sameKey(o.item_code))) || (o.item_name && byName.get(sameKey(o.item_name)));
      if (!parent) { orphans.push(`${extra.sheet} row ${o._row}: no item "${o.item_code || o.item_name || ''}" on the Items sheet`); continue; }
      objects.push({ ...o, item_code: parent.item_code, item_name: parent.item_name, category_name: parent.category_name, _row: parent._row });
    }
  }
  const categorySheet = find('categories');
  const categories = categorySheet ? buildCategories(sheetObjects(categorySheet, 'categories', null).objects) : [];
  return {
    sheet: itemsSheet.sheet,
    headers: main.headers,
    mapping: main.mapping,
    missing: main.missing,
    categories,
    items: buildItems(objects),
    declaredCategories: !!categorySheet,
    orphans,
  };
}

// ---------- Against what is already on the menu ----------

// existing: { categories: [{ id, name, ... }], items: [{ id, code, name, category_id, ... }], terminals: [{ id, name, active }] }
// Marks every record 'new', 'update' (it matches something on the menu) or 'error', and for an
// update lists what would change.
function classify(records, existing, kind) {
  const catByName = new Map(existing.categories.map((c) => [sameKey(c.name), c]));
  const catByCode = new Map(existing.categories.filter((c) => c.code).map((c) => [sameKey(c.code), c]));
  const findCategory = (code, name) => (code && catByCode.get(sameKey(code))) || (name && catByName.get(sameKey(name))) || null;
  const incoming = new Set(records.categories.filter((c) => c.errors.length === 0).flatMap((c) => [sameKey(c.name), c.code ? `code:${sameKey(c.code)}` : null]).filter(Boolean));
  const termByName = new Map(existing.terminals.map((t) => [sameKey(t.name), t]));
  // Kitchens named in the file that the restaurant does not have yet are created with it.
  records.new_kitchens = [];
  const itemByCode = new Map(existing.items.map((i) => [sameKey(i.code), i]));
  const itemByName = new Map(existing.items.map((i) => [`${i.category_id}|${sameKey(i.name)}`, i]));
  // Codes a "go well with" list may point at: on the menu already, or in this file.
  const knownCodes = new Set([...existing.items.map((i) => sameKey(i.code)), ...records.items.filter((i) => i.code).map((i) => sameKey(i.code))]);

  for (const c of records.categories) {
    const match = findCategory(c.code, c.name);
    c.match_id = match?.id ?? null;
    c.changes = [];
    if (match) {
      if (c.name && c.name !== match.name) c.changes.push({ field: 'Name', old: match.name, new: c.name });
      if (c.code && sameKey(c.code) !== sameKey(match.code || '')) c.changes.push({ field: 'Category ID', old: match.code || '', new: c.code });
      if (c.description !== null && c.description !== (match.description || '')) c.changes.push({ field: 'Description', old: match.description || '', new: c.description });
      if (c.active !== null && c.active !== match.active) c.changes.push({ field: 'Active', old: match.active ? 'Yes' : 'No', new: c.active ? 'Yes' : 'No' });
      if (c.position !== null && c.position !== match.sort) c.changes.push({ field: 'Display order', old: String(match.sort), new: String(c.position) });
    }
    c.status = c.errors.length ? 'error' : match ? 'update' : 'new';
  }
  // A category already on the menu with nothing to change is not shown (every dish row names one).
  records.categories = records.categories.filter((c) => !(c.status === 'update' && c.changes.length === 0));

  for (const item of records.items) {
    const category = findCategory(item.category_code, item.category);
    // The category must be on the menu already, or come in the same file as a category of its own.
    const comes = (incoming.has(sameKey(item.category)) || (item.category_code && incoming.has(`code:${sameKey(item.category_code)}`))) && records.declaredCategories;
    if (item.category && !category && !comes && !(kind === 'categories')) {
      item.errors.push(`Category "${item.category}" does not exist. Add it first, or include it in a Categories sheet.`);
    }
    item.terminal_ids = [];
    item.new_kitchens = [];
    for (const name of item.terminals || []) {
      const terminal = termByName.get(sameKey(name));
      if (terminal) item.terminal_ids.push(terminal.id);
      else {
        item.new_kitchens.push(name.slice(0, 40));
        if (!records.new_kitchens.some((k) => sameKey(k) === sameKey(name))) records.new_kitchens.push(name.slice(0, 40));
      }
    }
    item.terminal_id = item.terminal_ids[0] ?? null;
    for (const code of item.suggestions || []) {
      if (!knownCodes.has(sameKey(code)) && !item.warnings.some((w) => w.includes(`"${code}"`))) item.warnings.push(`Go well with: no item with code "${code}"; it is left out`);
    }
    const match = (item.code && itemByCode.get(sameKey(item.code))) || (category && itemByName.get(`${category.id}|${sameKey(item.name)}`)) || null;
    item.match_id = match?.id ?? null;
    item.changes = [];
    if (match) {
      const priceText = (sizes, price) => (sizes?.length ? sizes.map((s) => `${s.label} ${s.price}`).join(', ') : String(price));
      const before = priceText(match.sizes, match.price);
      const after = priceText(item.sizes, item.price);
      if (item.name && item.name !== match.name) item.changes.push({ field: 'Name', old: match.name, new: item.name });
      if (item.price !== null && before !== after) item.changes.push({ field: 'Price', old: before, new: after });
      if (item.description !== null && item.description !== (match.description || '')) item.changes.push({ field: 'Description', old: match.description || '', new: item.description });
      if (item.tax_rate !== null && item.tax_rate !== match.tax_rate) item.changes.push({ field: 'Tax rate', old: match.tax_rate === null ? 'Default' : `${match.tax_rate}%`, new: `${item.tax_rate}%` });
      if (item.tax_mode !== null && item.tax_mode !== match.tax_mode) item.changes.push({ field: 'Tax mode', old: match.tax_mode || 'Default', new: item.tax_mode });
      if (item.active !== null && item.active !== match.available) item.changes.push({ field: 'Active', old: match.available ? 'Yes' : 'No', new: item.active ? 'Yes' : 'No' });
      if (item.groups.length && JSON.stringify(item.groups) !== JSON.stringify(match.modifier_groups || [])) item.changes.push({ field: 'Add-ons', old: `${(match.modifier_groups || []).length} group(s)`, new: `${item.groups.length} group(s)` });
      const termNames = (ids) => (ids || []).map((id) => existing.terminals.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || 'Default';
      const oldTerminals = match.terminal_ids?.length ? match.terminal_ids : match.terminal_id ? [match.terminal_id] : [];
      const newNames = [...item.terminal_ids.map((id) => existing.terminals.find((t) => t.id === id)?.name), ...item.new_kitchens].filter(Boolean).join(', ');
      if ((item.terminal_ids.length || item.new_kitchens.length) && newNames !== termNames(oldTerminals)) item.changes.push({ field: 'Kitchens', old: termNames(oldTerminals), new: newNames });
      if (item.open_price !== null && item.open_price !== !!match.open_price) item.changes.push({ field: 'Open price', old: match.open_price ? 'Yes' : 'No', new: item.open_price ? 'Yes' : 'No' });
      if (item.tax_kind === 'restaurant' && match.tax_rate !== null) item.changes.push({ field: 'Tax', old: `${match.tax_rate}%`, new: 'Restaurant' });
      if (item.suggestions && item.suggestions.join(',') !== (match.suggestion_codes || []).join(',')) item.changes.push({ field: 'Go well with', old: (match.suggestion_codes || []).join(', ') || 'None', new: item.suggestions.join(', ') });
      if (category && category.id !== match.category_id) item.changes.push({ field: 'Category', old: existing.categories.find((c) => c.id === match.category_id)?.name || '', new: category.name });
      else if (!category && item.category) item.changes.push({ field: 'Category', old: existing.categories.find((c) => c.id === match.category_id)?.name || '', new: item.category });
    }
    item.status = item.errors.length ? 'error' : match ? 'update' : 'new';
  }

  const count = (list, status) => list.filter((r) => r.status === status).length;
  const all = [...records.categories, ...records.items];
  return {
    new: count(all, 'new'),
    update: count(all, 'update'),
    error: count(all, 'error'),
    warnings: all.reduce((n, r) => n + r.warnings.length, 0),
    categories: records.categories.length,
    items: records.items.length,
    kitchens: records.new_kitchens.length,
  };
}

// ---------- Templates and the error report ----------

const bold = (value) => ({ value, fontWeight: 'bold' });
const row = (...values) => values.map((value) => (typeof value === 'number' ? { value, type: Number } : { value: String(value) }));

// The one menu file (the client's combined format): one sheet, one row per dish, its category in
// the same row. Lists in a cell are separated by |: portions and add-ons as Name:Price, kitchens and
// Go Well With as names or Item IDs.
const MENU_HEADERS = [
  'Item ID', 'Item Name', 'Item Description', 'Category ID', 'Category Name', 'Category Description', 'Item Type (Veg/Non-veg)',
  'Base Price (INR)', 'Open Price? (Yes/No)', 'Tax Mode (Restaurant/Custom/None)', 'Custom Tax Rate (%)', 'Item Status (Active/Inactive)',
  'Display Order (1 = First)', 'Kitchen Terminals', 'Portions and Prices', 'Add-ons and Prices', 'Suggested Item IDs (for Go Well With)',
];
const MENU_ROWS = [
  ['ITM-001', 'Paneer Tikka Masala', 'Paneer cubes in a rich spiced tomato gravy.', 'CAT-001', 'Indian Main Course', 'Curries and gravy-based main-course dishes.', 'Veg', 220, 'No', 'Restaurant', '', 'Active', 1, 'Main Kitchen', 'Regular:220|Large:320', 'Extra Gravy:30|Extra Paneer:50', 'ITM-004|ITM-005'],
  ['ITM-002', 'Butter Chicken', 'Tandoor-cooked chicken in creamy tomato gravy.', 'CAT-001', 'Indian Main Course', 'Curries and gravy-based main-course dishes.', 'Non-veg', 280, 'No', 'Restaurant', '', 'Active', 2, 'Main Kitchen', 'Half:180|Full:280', 'Extra Gravy:30|Extra Chicken:60', 'ITM-004|ITM-006'],
  ['ITM-003', 'Dal Makhani', 'Slow-cooked black lentils finished with butter and cream.', 'CAT-001', 'Indian Main Course', 'Curries and gravy-based main-course dishes.', 'Veg', 190, 'No', 'Restaurant', '', 'Active', 3, 'Main Kitchen', 'Half:130|Full:190', 'Extra Butter:15', 'ITM-005|ITM-007'],
  ['ITM-004', 'Tandoori Roti', 'Whole-wheat flatbread baked in a tandoor.', 'CAT-002', 'Breads', 'Indian breads served with curries and meals.', 'Veg', 20, 'No', 'Restaurant', '', 'Active', 1, 'Tandoor', 'Single:20|Basket of 4:70', 'Butter:5', 'ITM-001|ITM-002|ITM-003'],
  ['ITM-005', 'Butter Naan', 'Soft leavened bread brushed with butter.', 'CAT-002', 'Breads', 'Indian breads served with curries and meals.', 'Veg', 40, 'No', 'Restaurant', '', 'Active', 2, 'Tandoor', 'Single:40|Basket of 2:75', 'Extra Butter:5|Extra Cheese:20', 'ITM-001|ITM-002|ITM-003'],
  ['ITM-006', 'Jeera Rice', 'Basmati rice tempered with cumin.', 'CAT-003', 'Rice & Biryani', 'Rice dishes and biryanis.', 'Veg', 120, 'No', 'Restaurant', '', 'Active', 1, 'Main Kitchen', 'Half:80|Full:120', 'Extra Rice:50', 'ITM-002|ITM-003'],
  ['ITM-007', 'Masala Papad', 'Crispy papad topped with onion, tomato, and spices.', 'CAT-004', 'Starters & Sides', 'Small plates, starters, and accompaniments.', 'Veg', 60, 'No', 'Restaurant', '', 'Active', 1, 'Starters', 'Single:60', 'Extra Chutney:10', 'ITM-001|ITM-003'],
  ['ITM-008', 'Mango Lassi', 'Chilled mango yogurt drink.', 'CAT-005', 'Drinks', 'Cold and hot beverages.', 'Veg', 90, 'No', 'Custom', 5, 'Active', 1, 'Beverages', 'Regular:90|Large:130', 'Extra Ice Cream:25', 'ITM-001|ITM-002'],
  ['ITM-009', 'Seasonal Special', 'Demo inactive item for testing availability status.', 'CAT-006', 'Specials', 'Limited-time dishes and seasonal offerings.', 'Veg', 150, 'No', 'Restaurant', '', 'Inactive', 1, 'Main Kitchen', 'Regular:150', '', 'ITM-004|ITM-005'],
];
const MENU_README = [
  'POTKO Menu Import',
  'One sheet, one row per dish. Each row carries its category: repeat the same Category ID, Category Name and Category Description on every dish of that category.',
  'Categories and kitchens that are not in POTKO yet are created. Ones that already exist (same Category ID, or same name) are used, never duplicated.',
  'Item ID and Category ID are your own IDs: 2 to 12 letters, digits or hyphens (ITM-001, CAT-001). Importing the file again updates the dishes with the same Item ID. Left empty, POTKO makes one.',
  'Item Name and Category Name are required. Item Type: Veg or Non-veg. Item Status: Active or Inactive (inactive dishes cannot be ordered).',
  'Base Price (INR): a number only. Open Price? Yes means the waiter types the price when ordering.',
  'Tax Mode: Restaurant (the restaurant tax), Custom (the Custom Tax Rate %, added or included as the restaurant tax setting says) or None.',
  'Portions and Prices: PortionName:Price|PortionName:Price, e.g. Half:180|Full:280. A single portion is simply the dish price.',
  'Add-ons and Prices: AddOnName:Price|AddOnName:Price, e.g. Extra Gravy:30|Extra Paneer:50.',
  'Kitchen Terminals: one or more kitchen names separated by |, e.g. Main Kitchen|Tandoor. Empty means the main kitchen.',
  'Suggested Item IDs (for Go Well With): Item IDs separated by |, of dishes in this file or already on the menu. POTKO shows their current name and price.',
  'Display Order (1 = First): the place of the dish in its category.',
  'Every row is checked and shown to you before anything is saved; rows with a problem are listed with the reason.',
  'The rows in Menu Import are demo data: replace them with your menu before importing. Pictures are added on each dish in the app.',
];
const TEMPLATES = { menu: { headers: MENU_HEADERS, rows: MENU_ROWS, readme: MENU_README } };

// A cell that starts like a formula would run as one when the file is opened in Excel.
const safeCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};
const csvLine = (cells) => cells.map((c) => { const s = safeCell(c); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');

// The menu file for either import (the same file serves both). Excel has the Menu Import sheet
// and a Read Me sheet; CSV holds the Menu Import rows only.
async function template(kind, format) {
  if (!['categories', 'items'].includes(kind)) throw new AppError(400, 'bad_input', 'Unknown template');
  const t = TEMPLATES.menu;
  if (format === 'csv') return Buffer.from(`\uFEFF${[t.headers, ...t.rows].map(csvLine).join('\r\n')}\r\n`, 'utf8');
  const readme = t.readme.map((line, i) => [i === 0 ? bold(line) : { value: line }]);
  return writeExcel([
    { sheet: 'Menu Import', data: [t.headers.map(bold), ...t.rows.map((r) => row(...r))] },
    { sheet: 'Read Me', data: readme },
  ]).toBuffer();
}

// One line per problem, with the row it came from. Safe to open in Excel.
function errorReport(records) {
  const lines = [csvLine(['row', 'kind', 'name', 'result', 'message'])];
  const add = (kind, r) => {
    for (const m of r.errors) lines.push(csvLine([r.rows.join(' '), kind, r.name, 'Not imported', m]));
    for (const m of r.warnings) lines.push(csvLine([r.rows.join(' '), kind, r.name, 'Warning', m]));
    if (r.result === 'skipped') lines.push(csvLine([r.rows.join(' '), kind, r.name, 'Skipped', r.result_message || 'Already on the menu']));
    if (r.result === 'failed' && r.result_message) lines.push(csvLine([r.rows.join(' '), kind, r.name, 'Not imported', r.result_message]));
  };
  for (const c of records.categories) add('Category', c);
  for (const i of records.items) add('Item', i);
  for (const o of records.orphans || []) lines.push(csvLine(['', 'Item', '', 'Not imported', o]));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

module.exports = { readFile, parseCsv, buildRecords, classify, mapColumns, template, errorReport, safeCell, FIELDS, REQUIRED };
