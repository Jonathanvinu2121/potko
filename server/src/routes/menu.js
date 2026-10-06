const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requireRole } = require('../auth');
const { audit } = require('../orders');
const ws = require('../ws/events');

const router = express.Router();
const managers = requireRole('manager', 'admin');
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);

// A menu item as the app sees it, with the ids of its "goes well with" suggestions.
const ITEM_SELECT = `
  SELECT m.id, m.category_id, m.code, m.name, m.veg, m.sizes, m.price, m.customisations,
         m.available, m.order_count,
         COALESCE((SELECT json_agg(a.suggested_item_id) FROM addon_links a WHERE a.item_id = m.id), '[]') AS addon_ids
    FROM menu_items m`;

// Every menu change is pushed to all screens, which then reload the menu.
const changed = (req) => ws.toRestaurant(req.user.restaurantId, 'menu.updated', {});

// GET /menu — the whole menu in one call. It is small, so the app searches it on the device
// and typing filters instantly without a round trip.
router.get('/', async (req, res) => {
  const { restaurantId } = req.user;
  const categories = await db.query(
    'SELECT id, name, prefix, sort FROM categories WHERE restaurant_id = $1 ORDER BY sort, id',
    [restaurantId]
  );
  const items = await db.query(`${ITEM_SELECT} WHERE m.restaurant_id = $1 ORDER BY m.category_id, m.code`, [restaurantId]);
  res.json({ categories: categories.rows, items: items.rows });
});

// GET /menu/search?q= — by name or code, case-insensitive ("imc14" finds IMC14).
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await db.query(
    `${ITEM_SELECT} WHERE m.restaurant_id = $1 AND (m.name ILIKE $2 OR m.code ILIKE $2) ORDER BY m.code LIMIT 30`,
    [req.user.restaurantId, like]
  );
  res.json({ items: rows });
});

// GET /menu/popular — most ordered first.
router.get('/popular', async (req, res) => {
  const { rows } = await db.query(
    `${ITEM_SELECT} WHERE m.restaurant_id = $1 AND m.available ORDER BY m.order_count DESC, m.name LIMIT 8`,
    [req.user.restaurantId]
  );
  res.json({ items: rows });
});

// ---- Menu management (manager and admin) ----

// Reads and checks the editable fields of an item. `partial` allows fields to be left out (PATCH).
function readItem(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name, 80);
    if (!out.name) throw bad('Give the item a name');
  }
  if (!partial || body.veg !== undefined) out.veg = body.veg !== false;
  if (!partial || body.sizes !== undefined) {
    const sizes = Array.isArray(body.sizes) ? body.sizes : [];
    out.sizes = sizes.map((s) => ({ label: text(s.label, 20), price: Number(s.price) }));
    if (out.sizes.some((s) => !s.label || !(s.price >= 0))) throw bad('Every size needs a name and a price');
    if (new Set(out.sizes.map((s) => s.label.toLowerCase())).size !== out.sizes.length) throw bad('Two sizes have the same name');
  }
  if (!partial || body.price !== undefined || out.sizes) {
    // With sizes, the list price is the last (largest) size; otherwise it is the price given.
    const price = out.sizes?.length ? out.sizes[out.sizes.length - 1].price : Number(body.price);
    if (!(price >= 0)) throw bad('Enter a price');
    out.price = price;
  }
  if (!partial || body.customisations !== undefined) {
    const chips = Array.isArray(body.customisations) ? body.customisations : [];
    out.customisations = [...new Set(chips.map((c) => text(c, 30)).filter(Boolean))].slice(0, 12);
  }
  return out;
}

async function ownCategory(restaurantId, categoryId) {
  const { rows } = await db.query('SELECT * FROM categories WHERE id = $1 AND restaurant_id = $2', [categoryId, restaurantId]);
  if (!rows[0]) throw bad('Choose a category');
  return rows[0];
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

async function oneItem(restaurantId, id) {
  const { rows } = await db.query(`${ITEM_SELECT} WHERE m.restaurant_id = $1 AND m.id = $2`, [restaurantId, id]);
  return rows[0];
}

// POST /menu/items { category_id, name, veg, price, sizes, customisations, addonIds }
router.post('/items', managers, async (req, res) => {
  const { restaurantId } = req.user;
  const fields = readItem(req.body || {}, false);
  const category = await ownCategory(restaurantId, req.body?.category_id);
  const id = await db.tx(async (client) => {
    const code = await nextCode(client, restaurantId, category);
    const inserted = await client.query(
      `INSERT INTO menu_items (restaurant_id, category_id, code, name, veg, sizes, price, customisations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [restaurantId, category.id, code, fields.name, fields.veg, JSON.stringify(fields.sizes), fields.price, fields.customisations]
    );
    await setAddons(client, restaurantId, inserted.rows[0].id, req.body?.addonIds);
    await audit(client, { restaurantId, userId: req.user.id, action: 'menu.add', entity: 'menu_item', entityId: inserted.rows[0].id, new: { code, ...fields } });
    return inserted.rows[0].id;
  }).catch((err) => { throw uniqueCode(err); });
  changed(req);
  res.status(201).json({ item: await oneItem(restaurantId, id) });
});

// PATCH /menu/items/:id — any of the fields above; an admin may also change the code.
router.patch('/items/:id', managers, async (req, res) => {
  const { restaurantId } = req.user;
  const before = await oneItem(restaurantId, Number(req.params.id));
  if (!before) throw new AppError(404, 'no_item', 'No such menu item');
  const fields = readItem(req.body || {}, true);
  if (req.body?.category_id !== undefined) fields.category_id = (await ownCategory(restaurantId, req.body.category_id)).id;
  if (req.body?.code !== undefined && req.body.code !== before.code) {
    if (req.user.role !== 'admin') throw new AppError(403, 'forbidden', 'Only an admin can change a code');
    fields.code = text(req.body.code, 12).toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(fields.code)) throw bad('A code is 2 to 12 letters and digits');
  }
  await db.tx(async (client) => {
    const cols = Object.keys(fields);
    if (cols.length) {
      const values = cols.map((c) => (c === 'sizes' ? JSON.stringify(fields[c]) : fields[c]));
      await client.query(
        `UPDATE menu_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [before.id, ...values]
      );
    }
    await setAddons(client, restaurantId, before.id, req.body?.addonIds);
    await audit(client, {
      restaurantId, userId: req.user.id, action: 'menu.edit', entity: 'menu_item', entityId: before.id,
      old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: fields,
    });
  }).catch((err) => { throw uniqueCode(err); });
  changed(req);
  res.json({ item: await oneItem(restaurantId, before.id) });
});

// PATCH /menu/items/:id/availability { available } — Available / Out of stock. Every waiter menu updates at once.
router.patch('/items/:id/availability', managers, async (req, res) => {
  const { restaurantId } = req.user;
  const available = req.body?.available === true;
  const { rows } = await db.query(
    'UPDATE menu_items SET available = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING id',
    [available, Number(req.params.id), restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_item', 'No such menu item');
  await audit(db, { restaurantId, userId: req.user.id, action: available ? 'menu.available' : 'menu.out_of_stock', entity: 'menu_item', entityId: rows[0].id });
  changed(req);
  res.json({ item: await oneItem(restaurantId, rows[0].id) });
});

// POST /menu/categories { name, prefix }
router.post('/categories', managers, async (req, res) => {
  const name = text(req.body?.name, 40);
  const prefix = text(req.body?.prefix, 5).toUpperCase();
  if (!name) throw bad('Give the category a name');
  if (!/^[A-Z]{2,5}$/.test(prefix)) throw bad('The prefix is 2 to 5 letters, for example IMC');
  const { rows } = await db
    .query(
      `INSERT INTO categories (restaurant_id, name, prefix, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(max(sort), 0) + 1 FROM categories WHERE restaurant_id = $1))
       RETURNING id, name, prefix, sort`,
      [req.user.restaurantId, name, prefix]
    )
    .catch((err) => { throw err.code === '23505' ? new AppError(409, 'prefix_taken', 'Another category already uses that prefix') : err; });
  changed(req);
  res.status(201).json({ category: rows[0] });
});

// PATCH /menu/categories/:id { name }
router.patch('/categories/:id', managers, async (req, res) => {
  const name = text(req.body?.name, 40);
  if (!name) throw bad('Give the category a name');
  const { rows } = await db.query(
    'UPDATE categories SET name = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING id, name, prefix, sort',
    [name, Number(req.params.id), req.user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_category', 'No such category');
  changed(req);
  res.json({ category: rows[0] });
});

module.exports = router;
