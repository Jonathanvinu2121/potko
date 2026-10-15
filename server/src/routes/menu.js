const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm, can } = require('../permissions');
const { audit } = require('../orders');
const ws = require('../ws/events');
const { swapSort, setOrder } = require('./floor');
const { menuFor, itemFor } = require('../scope');

// The terminal that cooks dishes with none of their own.
async function defaultTerminal(restaurantId) {
  const { rows } = await db.query('SELECT id FROM kitchen_terminals WHERE restaurant_id = $1 AND active ORDER BY is_default DESC, sort, id LIMIT 1', [restaurantId]);
  return rows[0]?.id ?? null;
}

const router = express.Router();
const manage = requirePerm('menu.manage');
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

// A menu item as the app sees it, with the ids of its "goes well with" suggestions.
const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.code, m.name, m.description, m.veg, m.sizes, m.price, m.customisations,
         m.modifier_groups, m.tax_rate, m.tax_mode, m.terminal_id, m.terminal_ids, m.open_price, m.image_id, m.sort,
         m.available, m.order_count,
         COALESCE((SELECT json_agg(a.suggested_item_id) FROM addon_links a WHERE a.item_id = m.id), '[]') AS addon_ids
    FROM menu_items m`;

const CATEGORY_SELECT = `
  SELECT c.id, c.name, c.prefix, c.sort, c.description, c.active, c.image_id,
         (SELECT count(*)::int FROM menu_items m WHERE m.category_id = c.id AND m.deleted_at IS NULL) AS item_count
    FROM categories c`;

// Every menu change is pushed to all screens, which then reload the menu.
const changed = (req) => ws.toRestaurant(req.user.restaurantId, 'menu.updated', {});

// GET /menu — the whole menu in one call. It is small, so the app searches it on the device
// and typing filters instantly without a round trip.
// Service screens get the categories that are switched on; ?all=1 (menu managers) gets everything.
router.get('/', async (req, res) => {
  const { restaurantId } = req.user;
  const all = req.query.all === '1' && can(req.user, 'menu.manage');
  const categories = await db.query(
    `${CATEGORY_SELECT} WHERE c.restaurant_id = $1 AND c.deleted_at IS NULL AND ($2 OR c.active) ORDER BY c.sort, c.id`,
    [restaurantId, all]
  );
  const items = await db.query(
    `${ITEM_SELECT} JOIN categories c ON c.id = m.category_id
      WHERE m.restaurant_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND ($2 OR c.active)
      ORDER BY c.sort, c.id, m.sort, m.id`,
    [restaurantId, all]
  );
  res.json(menuFor(req.user, { categories: categories.rows, items: items.rows }, await defaultTerminal(restaurantId)));
});

// GET /menu/search?q= — by name or code, case-insensitive ("imc14" finds IMC14).
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await db.query(
    `${ITEM_SELECT} WHERE m.restaurant_id = $1 AND m.deleted_at IS NULL AND (m.name ILIKE $2 OR m.code ILIKE $2) ORDER BY m.code LIMIT 30`,
    [req.user.restaurantId, like]
  );
  res.json({ items: rows.map((m) => itemFor(req.user, m)) });
});

// GET /menu/popular — most ordered first.
router.get('/popular', async (req, res) => {
  const { rows } = await db.query(
    `${ITEM_SELECT} JOIN categories c ON c.id = m.category_id
      WHERE m.restaurant_id = $1 AND m.available AND m.deleted_at IS NULL AND c.active AND c.deleted_at IS NULL
      ORDER BY m.order_count DESC, m.name LIMIT 8`,
    [req.user.restaurantId]
  );
  res.json({ items: rows.map((m) => itemFor(req.user, m)) });
});

// ---- Menu management ----

// Add-on groups: [{ name, required, min, max, options: [{ name, price }] }]
//   max 1 = choose one; max 0 = choose any number. A required group needs at least one choice.
function readGroups(input) {
  const groups = Array.isArray(input) ? input : [];
  if (groups.length > 10) throw bad('Up to 10 add-on groups on one item');
  const out = groups.map((g) => {
    const name = text(g.name, 30);
    if (!name) throw bad('Every add-on group needs a name');
    const options = (Array.isArray(g.options) ? g.options : []).map((o) => ({ name: text(o.name, 30), price: Math.round(Number(o.price || 0) * 100) / 100 }));
    if (options.length === 0) throw bad(`Add at least one option to ${name}`);
    if (options.length > 20) throw bad(`Up to 20 options in ${name}`);
    if (options.some((o) => !o.name || !(o.price >= 0))) throw bad(`Every option in ${name} needs a name and a price of 0 or more`);
    if (new Set(options.map((o) => o.name.toLowerCase())).size !== options.length) throw bad(`Two options in ${name} have the same name`);
    const max = Math.max(0, Math.min(options.length, Number.isInteger(Number(g.max)) ? Number(g.max) : 0));
    const required = g.required === true;
    const min = Math.max(required ? 1 : 0, Math.min(options.length, Number.isInteger(Number(g.min)) ? Number(g.min) : 0));
    if (max > 0 && min > max) throw bad(`${name}: the least to choose is more than the most`);
    return { name, required, min, max, options };
  });
  if (new Set(out.map((g) => g.name.toLowerCase())).size !== out.length) throw bad('Two add-on groups have the same name');
  return out;
}

// Reads and checks the editable fields of an item. `partial` allows fields to be left out (PATCH).
function readItem(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name, 80);
    if (!out.name) throw bad('Give the item a name');
  }
  if (body.description !== undefined) out.description = text(body.description, 200) || null;
  if (!partial || body.veg !== undefined) out.veg = body.veg !== false;
  if (!partial || body.sizes !== undefined) {
    const sizes = Array.isArray(body.sizes) ? body.sizes : [];
    out.sizes = sizes.map((s) => ({ label: text(s.label, 20), price: Number(s.price) }));
    if (out.sizes.some((s) => !s.label || !(s.price >= 0))) throw bad('Every portion needs a name and a price');
    if (new Set(out.sizes.map((s) => s.label.toLowerCase())).size !== out.sizes.length) throw bad('Two portions have the same name');
  }
  if (!partial || body.price !== undefined || out.sizes) {
    // With portions, the list price is the last (largest) portion; otherwise it is the price given.
    const price = out.sizes?.length ? out.sizes[out.sizes.length - 1].price : Number(body.price);
    if (!(price >= 0)) throw bad('Enter a price');
    out.price = price;
  }
  if (!partial || body.customisations !== undefined) {
    const chips = Array.isArray(body.customisations) ? body.customisations : [];
    out.customisations = [...new Set(chips.map((c) => text(c, 30)).filter(Boolean))].slice(0, 12);
  }
  if (body.modifier_groups !== undefined) out.modifier_groups = readGroups(body.modifier_groups);
  if (body.tax_rate !== undefined) {
    // null = use the restaurant's rate
    out.tax_rate = body.tax_rate === null || body.tax_rate === '' ? null : Number(body.tax_rate);
    if (out.tax_rate !== null && !(out.tax_rate >= 0 && out.tax_rate <= 100)) throw bad('The tax rate is between 0 and 100');
  }
  if (body.tax_mode !== undefined) {
    out.tax_mode = body.tax_mode || null;
    if (out.tax_mode !== null && !['inclusive', 'exclusive'].includes(out.tax_mode)) throw bad('The price either includes tax or tax is added on top');
  }
  if (body.available !== undefined) out.available = body.available === true;
  if (body.open_price !== undefined) out.open_price = body.open_price === true;
  if (body.image_id !== undefined) out.image_id = Number.isInteger(body.image_id) ? body.image_id : null;
  return out;
}

async function ownCategory(q, restaurantId, categoryId) {
  const { rows } = await q.query('SELECT * FROM categories WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [categoryId, restaurantId]);
  if (!rows[0]) throw bad('Choose a category');
  return rows[0];
}

// A dish is routed to one of the restaurant's own terminals, or (null) to the default one.
async function ownTerminal(q, restaurantId, terminalId) {
  if (terminalId === null || terminalId === undefined || terminalId === '') return null;
  const { rows } = await q.query('SELECT id FROM kitchen_terminals WHERE id = $1 AND restaurant_id = $2', [Number(terminalId), restaurantId]);
  if (!rows[0]) throw bad('Choose a kitchen terminal');
  return rows[0].id;
}

// The terminals a dish is shown at: the restaurant's own, in the order ticked. The first one is
// also kept in terminal_id (its KOT is numbered there). An empty list = the default terminal.
async function ownTerminals(q, restaurantId, input) {
  const ids = [...new Set((Array.isArray(input) ? input : []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0) return { terminal_id: null, terminal_ids: [] };
  const { rows } = await q.query('SELECT id FROM kitchen_terminals WHERE id = ANY($1::int[]) AND restaurant_id = $2', [ids, restaurantId]);
  if (rows.length !== ids.length) throw bad('Choose the kitchen terminals again');
  return { terminal_id: ids[0], terminal_ids: ids };
}

// Category prefix + next serial: the 3rd item in "Indian Main Course" (IMC) becomes IMC03.
async function nextCode(q, restaurantId, category) {
  const { rows } = await q.query(
    `SELECT COALESCE(max(substring(code from '[0-9]+$')::int), 0) + 1 AS serial
       FROM menu_items WHERE restaurant_id = $1 AND upper(code) LIKE upper($2) || '%'`,
    [restaurantId, category.prefix]
  );
  return `${category.prefix}${String(rows[0].serial).padStart(2, '0')}`;
}

// A short code prefix made from the category's name: "Indian Main Course" -> IMC, "Pizza" -> PIZ.
// If it is taken, letters are varied until a free one is found.
async function makePrefix(q, restaurantId, name) {
  const { rows } = await q.query('SELECT prefix FROM categories WHERE restaurant_id = $1', [restaurantId]);
  const used = new Set(rows.map((r) => r.prefix.toUpperCase()));
  const words = name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
  const letters = words.join('');
  const first = (words.length >= 2 ? words.map((w) => w[0]).join('') : letters).slice(0, 4);
  const tries = [first.length >= 2 ? first : null, letters.slice(0, 3), letters.slice(0, 4), `${letters[0] || 'C'}${letters.replace(/[AEIOU]/g, '').slice(1, 3)}`].filter((p) => p && /^[A-Z]{2,5}$/.test(p));
  for (const p of tries) if (!used.has(p)) return p;
  const base = (tries[0] || 'CAT').slice(0, 2);
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(base + c)) return base + c;
  for (let n = 0; n < 1000; n += 1) {
    const p = 'C' + String.fromCharCode(65 + Math.floor(n / 26) % 26) + String.fromCharCode(65 + (n % 26)) + 'X';
    if (!used.has(p)) return p;
  }
  throw bad('Could not make a code for this category. Try another name.');
}

async function setAddons(q, restaurantId, itemId, addonIds) {
  if (!Array.isArray(addonIds)) return;
  await q.query('DELETE FROM addon_links WHERE item_id = $1', [itemId]);
  const ids = [...new Set(addonIds.map(Number))].filter((id) => Number.isInteger(id) && id !== itemId);
  if (ids.length === 0) return;
  await q.query(
    `INSERT INTO addon_links (item_id, suggested_item_id)
     SELECT $1, id FROM menu_items WHERE restaurant_id = $2 AND id = ANY($3::int[])`,
    [itemId, restaurantId, ids]
  );
}

const uniqueCode = (err) => (err.code === '23505' ? new AppError(409, 'code_taken', 'Another item already uses that code') : err);
const JSON_COLS = ['sizes', 'modifier_groups'];

async function oneItem(q, restaurantId, id) {
  const { rows } = await q.query(`${ITEM_SELECT} WHERE m.restaurant_id = $1 AND m.id = $2 AND m.deleted_at IS NULL`, [restaurantId, id]);
  return rows[0];
}

// Saves a new item inside a transaction. Used by the form and by the importer.
async function insertItem(client, restaurantId, userId, category, fields, { code = null, terminalId = null, terminalIds = null, addonIds = null, action = 'menu.add' } = {}) {
  const itemCode = code || (await nextCode(client, restaurantId, category));
  const inserted = await client.query(
    `INSERT INTO menu_items (restaurant_id, category_id, code, name, description, veg, sizes, price, customisations, modifier_groups,
                             tax_rate, tax_mode, terminal_id, image_id, available, terminal_ids, open_price, sort)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
             (SELECT COALESCE(max(sort), 0) + 1 FROM menu_items WHERE category_id = $2))
     RETURNING id`,
    [
      restaurantId, category.id, itemCode, fields.name, fields.description ?? null, fields.veg ?? true, JSON.stringify(fields.sizes ?? []), fields.price,
      fields.customisations ?? [], JSON.stringify(fields.modifier_groups ?? []), fields.tax_rate ?? null, fields.tax_mode ?? null, terminalId,
      fields.image_id ?? null, fields.available ?? true, terminalIds ?? (terminalId ? [terminalId] : []), fields.open_price ?? false,
    ]
  );
  await setAddons(client, restaurantId, inserted.rows[0].id, addonIds);
  await audit(client, { restaurantId, userId, action, entity: 'menu_item', entityId: inserted.rows[0].id, new: { code: itemCode, category: category.name, ...fields } });
  return inserted.rows[0].id;
}

// Puts a dish at a position in its category (1 = first), moving the others down.
async function placeItem(client, categoryId, itemId, position) {
  const n = Number(position);
  if (!Number.isInteger(n) || n < 1) return;
  const { rows } = await client.query('SELECT id FROM menu_items WHERE category_id = $1 AND deleted_at IS NULL AND id <> $2 ORDER BY sort, id', [categoryId, itemId]);
  const ids = rows.map((r) => r.id);
  ids.splice(Math.min(n - 1, ids.length), 0, itemId);
  for (let i = 0; i < ids.length; i += 1) await client.query('UPDATE menu_items SET sort = $1 WHERE id = $2', [i + 1, ids[i]]);
}

// POST /menu/items { category_id, code?, name, description?, veg, price, sizes, customisations, modifier_groups?,
//                    tax_rate?, tax_mode?, terminal_id?, image_id?, available?, addonIds? }
//   code  the dish's item code (2 to 12 letters, digits or hyphens); left out, one is made
router.post('/items', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const fields = readItem(req.body || {}, false);
  const code = req.body?.code ? text(req.body.code, 13).toUpperCase() : null;
  if (code && !/^[A-Z0-9-]{2,12}$/.test(code)) throw bad('An item code is 2 to 12 letters, digits or hyphens');
  const category = await ownCategory(db, restaurantId, req.body?.category_id);
  const routed = req.body?.terminal_ids !== undefined
    ? await ownTerminals(db, restaurantId, req.body.terminal_ids)
    : { terminal_id: await ownTerminal(db, restaurantId, req.body?.terminal_id), terminal_ids: null };
  const id = await db
    .tx(async (client) => {
      const made = await insertItem(client, restaurantId, req.user.id, category, fields, { code, terminalId: routed.terminal_id, terminalIds: routed.terminal_ids, addonIds: req.body?.addonIds });
      if (req.body?.position !== undefined) await placeItem(client, category.id, made, req.body.position);
      return made;
    })
    .catch((err) => { throw uniqueCode(err); });
  changed(req);
  res.status(201).json({ item: await oneItem(db, restaurantId, id) });
});

// PATCH /menu/items/:id — any of the fields above; an admin may also change the code.
router.patch('/items/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const before = await oneItem(db, restaurantId, Number(req.params.id));
  if (!before) throw new AppError(404, 'no_item', 'No such menu item');
  const fields = readItem(req.body || {}, true);
  if (req.body?.category_id !== undefined && Number(req.body.category_id) !== before.category_id) {
    fields.category_id = (await ownCategory(db, restaurantId, req.body.category_id)).id;
  }
  if (req.body?.terminal_ids !== undefined) Object.assign(fields, await ownTerminals(db, restaurantId, req.body.terminal_ids));
  else if (req.body?.terminal_id !== undefined) {
    fields.terminal_id = await ownTerminal(db, restaurantId, req.body.terminal_id);
    fields.terminal_ids = fields.terminal_id ? [fields.terminal_id] : [];
  }
  if (req.body?.code !== undefined && String(req.body.code).trim().toUpperCase() !== before.code.toUpperCase()) {
    if (!can(req.user, 'staff.admin')) throw new AppError(403, 'forbidden', 'Only an admin can change a code');
    fields.code = text(req.body.code, 13).toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(fields.code)) throw bad('An item code is 2 to 12 letters, digits or hyphens');
  }
  await db.tx(async (client) => {
    const cols = Object.keys(fields);
    if (cols.length) {
      const values = cols.map((c) => (JSON_COLS.includes(c) ? JSON.stringify(fields[c]) : fields[c]));
      await client.query(`UPDATE menu_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [before.id, ...values]);
    }
    await setAddons(client, restaurantId, before.id, req.body?.addonIds);
    if (req.body?.position !== undefined) await placeItem(client, fields.category_id ?? before.category_id, before.id, req.body.position);
    await audit(client, {
      restaurantId, userId: req.user.id, action: 'menu.edit', entity: 'menu_item', entityId: before.id,
      old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: { name: before.name, ...fields },
    });
  }).catch((err) => { throw uniqueCode(err); });
  changed(req);
  res.json({ item: await oneItem(db, restaurantId, before.id) });
});

// PATCH /menu/items/:id/availability { available } — the one on/off switch of an item.
// Off: every waiter's menu shows it as unavailable at once.
// A chef may switch off (and on) the dishes cooked at their own terminals, when one runs out.
async function mayToggle(req, res, next) {
  if (can(req.user, 'menu.manage')) return next();
  if (req.user.role !== 'chef') return next(new AppError(403, 'forbidden', 'You do not have permission to do this'));
  const mine = Array.isArray(req.user.terminals) ? req.user.terminals : [];
  const { rows } = await db.query(
    `SELECT 1 FROM menu_items m WHERE m.id = $1 AND m.restaurant_id = $2 AND m.deleted_at IS NULL
        AND (m.terminal_ids && $3::int[]
             OR (cardinality(m.terminal_ids) = 0 AND (SELECT id FROM kitchen_terminals k WHERE k.restaurant_id = $2 AND k.active
                                                     ORDER BY k.is_default DESC, k.sort, k.id LIMIT 1) = ANY($3::int[])))`,
    [Number(req.params.id), req.user.restaurantId, mine]
  );
  return rows[0] ? next() : next(new AppError(403, 'forbidden', 'This dish is not cooked at your kitchen'));
}

router.patch('/items/:id/availability', mayToggle, async (req, res) => {
  const { restaurantId } = req.user;
  const available = req.body?.available === true;
  const { rows } = await db.query(
    'UPDATE menu_items SET available = $1 WHERE id = $2 AND restaurant_id = $3 AND deleted_at IS NULL RETURNING id, name',
    [available, Number(req.params.id), restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_item', 'No such menu item');
  await audit(db, { restaurantId, userId: req.user.id, action: available ? 'menu.available' : 'menu.out_of_stock', entity: 'menu_item', entityId: rows[0].id, new: { name: rows[0].name } });
  changed(req);
  ws.toPerm(restaurantId, 'overview.view', 'overview.changed', {});
  res.json({ item: await oneItem(db, restaurantId, rows[0].id) });
});

// POST /menu/items/:id/move { direction: 'up' | 'down' } — its place inside its category.
// POST /menu/items/:id/duplicate — a copy of the dish, "(copy)" added to its name, switched off
// until it is checked. It gets the next code in its category.
router.post('/items/:id/duplicate', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const src = (await db.query('SELECT * FROM menu_items WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [Number(req.params.id), restaurantId])).rows[0];
  if (!src) throw new AppError(404, 'no_item', 'No such menu item');
  const category = await ownCategory(db, restaurantId, src.category_id);
  const fields = {
    name: `${src.name} (copy)`.slice(0, 80), description: src.description, veg: src.veg, sizes: src.sizes, price: Number(src.price),
    customisations: src.customisations, modifier_groups: src.modifier_groups, tax_rate: src.tax_rate, tax_mode: src.tax_mode,
    image_id: src.image_id, available: false, open_price: src.open_price,
  };
  const id = await db.tx((client) => insertItem(client, restaurantId, req.user.id, category, fields, {
    terminalId: src.terminal_id, terminalIds: src.terminal_ids, action: 'menu.duplicate',
  }));
  changed(req);
  res.status(201).json({ item: await oneItem(db, restaurantId, id) });
});

router.post('/items/:id/move', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const item = await oneItem(db, restaurantId, Number(req.params.id));
  if (!item) throw new AppError(404, 'no_item', 'No such menu item');
  await swapSort('menu_items', 'deleted_at IS NULL', restaurantId, item.id, req.body?.direction, 'AND category_id = $2', [item.category_id]);
  changed(req);
  res.json({ ok: true });
});

// DELETE /menu/items/:id — off the menu for good. Past orders keep the dish as it was sold.
router.delete('/items/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const item = await oneItem(db, restaurantId, Number(req.params.id));
  if (!item) throw new AppError(404, 'no_item', 'No such menu item');
  await db.tx(async (client) => {
    await client.query('UPDATE menu_items SET deleted_at = now(), available = false WHERE id = $1', [item.id]);
    await client.query('DELETE FROM addon_links WHERE item_id = $1 OR suggested_item_id = $1', [item.id]);
    await audit(client, { restaurantId, userId: req.user.id, action: 'menu.delete', entity: 'menu_item', entityId: item.id, old: { code: item.code, name: item.name, price: item.price } });
  });
  changed(req);
  res.json({ ok: true });
});

// ---- Categories ----

function readCategory(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name, 40);
    if (!out.name) throw bad('Give the category a name');
  }
  if (body.description !== undefined) out.description = text(body.description, 120) || null;
  if (body.active !== undefined) out.active = body.active === true;
  if (body.image_id !== undefined) out.image_id = Number.isInteger(body.image_id) ? body.image_id : null;
  return out;
}

async function oneCategory(q, restaurantId, id) {
  const { rows } = await q.query(`${CATEGORY_SELECT} WHERE c.restaurant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`, [restaurantId, id]);
  return rows[0];
}

// Puts a category at a 1-based place in the list and renumbers the rest.
async function placeCategory(client, restaurantId, id, position) {
  const { rows } = await client.query('SELECT id FROM categories WHERE restaurant_id = $1 AND deleted_at IS NULL ORDER BY sort, id FOR UPDATE', [restaurantId]);
  const order = rows.map((r) => r.id).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, position - 1)), 0, id);
  for (let n = 0; n < order.length; n += 1) await client.query('UPDATE categories SET sort = $1 WHERE id = $2', [n + 1, order[n]]);
}

async function insertCategory(client, restaurantId, userId, fields, { position = null, action = 'category.add' } = {}) {
  const same = await client.query('SELECT 1 FROM categories WHERE restaurant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL', [restaurantId, fields.name]);
  if (same.rows[0]) throw new AppError(409, 'name_taken', `There is already a category named ${fields.name}`);
  const prefix = await makePrefix(client, restaurantId, fields.name);
  const { rows } = await client.query(
    `INSERT INTO categories (restaurant_id, name, prefix, description, active, image_id, sort)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(max(sort), 0) + 1 FROM categories WHERE restaurant_id = $1))
     RETURNING id`,
    [restaurantId, fields.name, prefix, fields.description ?? null, fields.active ?? true, fields.image_id ?? null]
  );
  if (Number.isInteger(position) && position > 0) await placeCategory(client, restaurantId, rows[0].id, position);
  await audit(client, { restaurantId, userId, action, entity: 'category', entityId: rows[0].id, new: { ...fields, prefix } });
  return rows[0].id;
}

// POST /menu/categories { name, description?, active?, position? }
router.post('/categories', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const fields = readCategory(req.body || {}, false);
  const id = await db.tx((client) => insertCategory(client, restaurantId, req.user.id, fields, { position: Number(req.body?.position) || null }));
  changed(req);
  res.status(201).json({ category: await oneCategory(db, restaurantId, id) });
});

// PATCH /menu/categories/:id { name?, description?, active?, position?, image_id? }
router.patch('/categories/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = await oneCategory(db, restaurantId, id);
  if (!before) throw new AppError(404, 'no_category', 'No such category');
  const fields = readCategory(req.body || {}, true);
  await db.tx(async (client) => {
    if (fields.name && fields.name.toLowerCase() !== before.name.toLowerCase()) {
      const same = await client.query('SELECT 1 FROM categories WHERE restaurant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3', [restaurantId, fields.name, id]);
      if (same.rows[0]) throw new AppError(409, 'name_taken', `There is already a category named ${fields.name}`);
    }
    const cols = Object.keys(fields);
    if (cols.length) await client.query(`UPDATE categories SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => fields[c])]);
    const position = Number(req.body?.position);
    if (Number.isInteger(position) && position > 0) await placeCategory(client, restaurantId, id, position);
    await audit(client, { restaurantId, userId: req.user.id, action: 'category.edit', entity: 'category', entityId: id, old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: { name: before.name, ...fields } });
  });
  changed(req);
  res.json({ category: await oneCategory(db, restaurantId, id) });
});

// POST /menu/categories/:id/move { direction: 'up' | 'down' }
// The ids in their new order, after a drag. Every id must belong to this restaurant (and, for
// dishes, to the category); anything not listed keeps its place after the listed ones.
// PUT /menu/categories/order { ids } — the categories, top to bottom.
router.put('/categories/order', manage, async (req, res) => {
  await setOrder('categories', 'restaurant_id = $1 AND deleted_at IS NULL', [req.user.restaurantId], req.body?.ids);
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: 'menu.reorder', entity: 'category', entityId: null, new: { ids: req.body?.ids } });
  changed(req);
  res.json({ ok: true });
});

// PUT /menu/categories/:id/order { ids } — the dishes of one category, top to bottom.
router.put('/categories/:id/order', manage, async (req, res) => {
  const category = await ownCategory(db, req.user.restaurantId, Number(req.params.id));
  await setOrder('menu_items', 'restaurant_id = $1 AND category_id = $2 AND deleted_at IS NULL', [req.user.restaurantId, category.id], req.body?.ids);
  await audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action: 'menu.reorder', entity: 'category', entityId: category.id, new: { ids: req.body?.ids } });
  changed(req);
  res.json({ ok: true });
});

router.post('/categories/:id/move', manage, async (req, res) => {
  await swapSort('categories', 'deleted_at IS NULL', req.user.restaurantId, Number(req.params.id), req.body?.direction);
  changed(req);
  res.json({ ok: true });
});

// DELETE /menu/categories/:id — the category and the items in it leave the menu.
// Past orders keep every dish as it was sold.
router.delete('/categories/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = await oneCategory(db, restaurantId, id);
  if (!before) throw new AppError(404, 'no_category', 'No such category');
  await db.tx(async (client) => {
    await client.query('DELETE FROM addon_links WHERE item_id IN (SELECT id FROM menu_items WHERE category_id = $1) OR suggested_item_id IN (SELECT id FROM menu_items WHERE category_id = $1)', [id]);
    await client.query('UPDATE menu_items SET deleted_at = now(), available = false WHERE category_id = $1 AND deleted_at IS NULL', [id]);
    await client.query('UPDATE categories SET deleted_at = now(), active = false WHERE id = $1', [id]);
    await audit(client, { restaurantId, userId: req.user.id, action: 'category.delete', entity: 'category', entityId: id, old: { name: before.name, items: before.item_count } });
  });
  changed(req);
  res.json({ ok: true, items: before.item_count });
});

module.exports = router;
Object.assign(module.exports, { readItem, readCategory, readGroups, insertItem, insertCategory, ownTerminal, setAddons, ITEM_SELECT, CATEGORY_SELECT, JSON_COLS });
