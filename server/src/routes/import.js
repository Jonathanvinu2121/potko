// Menu import from CSV or Excel:
//   template -> upload -> check and map columns -> preview -> choose "create new only" or
//   "update matching" -> import -> summary and a downloadable error report.
// Nothing on the menu is ever overwritten silently, and importing the same checked file twice
// changes nothing the second time.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm } = require('../permissions');
const { audit } = require('../orders');
const ws = require('../ws/events');
const importer = require('../importer');
const menu = require('./menu');

const router = express.Router();
router.use(requirePerm('menu.manage'));
const KINDS = ['categories', 'items'];

async function loadExisting(q, restaurantId) {
  const categories = (await q.query('SELECT id, code, name, description, active, sort FROM categories WHERE restaurant_id = $1 AND deleted_at IS NULL', [restaurantId])).rows;
  const items = (await q.query(
    `SELECT m.id, m.code, m.name, m.category_id, m.sizes, m.price, m.description, m.tax_rate, m.tax_mode, m.available, m.modifier_groups,
            m.terminal_id, m.terminal_ids, m.open_price,
            COALESCE((SELECT array_agg(s.code ORDER BY s.code) FROM addon_links a JOIN menu_items s ON s.id = a.suggested_item_id WHERE a.item_id = m.id), '{}') AS suggestion_codes
       FROM menu_items m WHERE m.restaurant_id = $1 AND m.deleted_at IS NULL`,
    [restaurantId]
  )).rows;
  const terminals = (await q.query('SELECT id, name, active FROM kitchen_terminals WHERE restaurant_id = $1', [restaurantId])).rows;
  return { categories, items, terminals };
}

// What the app shows for one record in the preview.
const brief = (kind) => (r) => ({
  kind,
  rows: r.rows,
  name: r.name,
  code: r.code ?? undefined,
  category: r.category ?? undefined,
  category_code: r.category_code ?? undefined,
  description: r.description,
  price: r.open_price ? undefined : r.price ?? undefined,
  open_price: r.open_price || undefined,
  portions: r.sizes?.length ? r.sizes : undefined,
  addons: r.groups?.length ? r.groups.flatMap((g) => g.options.map((o) => o.name)) : undefined,
  kitchens: r.terminals?.length ? r.terminals : undefined,
  new_kitchens: r.new_kitchens?.length ? r.new_kitchens : undefined,
  go_with: r.suggestions?.length ? r.suggestions : undefined,
  active: r.active,
  status: r.status,
  errors: r.errors,
  warnings: r.warnings,
  changes: r.changes,
  result: r.result,
  result_message: r.result_message,
});

// GET /menu/import/template?kind=categories|items&format=xlsx|csv — a file with the right
// headings, sample rows and (in Excel) a sheet that explains every column.
router.get('/template', async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'items';
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const file = await importer.template(kind, format);
  res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="POTKO_Menu_Import_Template.${format}"`);
  res.send(file);
});

// POST /menu/import/preview { kind, filename, data, mapping? }
//   data     the file as base64 (.csv or .xlsx, up to 5 MB)
//   mapping  { "<heading in the file>": "<field>" } when the headings differ from ours
// Answers with the headings and how each was read, every record with its problems, and counts.
router.post('/preview', async (req, res) => {
  const { restaurantId } = req.user;
  const kind = req.body?.kind;
  if (!KINDS.includes(kind)) throw new AppError(400, 'bad_input', 'Import categories or items');
  const sheets = await importer.readFile(req.body?.filename, req.body?.data);
  const chosen = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : null;
  const records = importer.buildRecords(sheets, kind, chosen);

  const fields = Object.entries(importer.FIELDS).map(([key, f]) => ({ key, label: f.label, required: importer.REQUIRED[kind].includes(key) }));
  const columns = records.headers.map((header, i) => ({ header, field: records.mapping[i] }));
  // Without the required columns nothing can be checked yet: the app asks which column is which.
  if (records.missing.length > 0) {
    return res.json({ needs_mapping: true, kind, filename: String(req.body.filename), sheet: records.sheet, columns, fields, missing: records.missing.map((f) => importer.FIELDS[f].label) });
  }

  if (records.row_count === 0) throw new AppError(400, 'bad_file', 'The file has its headings but no rows under them');

  const counts = importer.classify(records, await loadExisting(db, restaurantId));
  const id = crypto.randomBytes(12).toString('base64url');
  await db.query(
    'INSERT INTO imports (id, restaurant_id, user_id, kind, filename, rows) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, restaurantId, req.user.id, kind, String(req.body.filename).slice(0, 120), JSON.stringify(records)]
  );
  // Old previews nobody imported are cleared out.
  await db.query(`DELETE FROM imports WHERE restaurant_id = $1 AND committed_at IS NULL AND created_at < now() - interval '2 days'`, [restaurantId]);

  res.json({
    id,
    kind,
    filename: String(req.body.filename),
    sheet: records.sheet,
    columns,
    fields,
    counts,
    new_kitchens: records.new_kitchens || [],
    // Categories already on the menu that dishes of this file go into.
    reused: records.reused || [],
    orphans: records.orphans || [],
    records: [...records.categories.map(brief('category')), ...records.items.map(brief('item'))].slice(0, 500),
  });
});

// Why a row could not be saved, in words for the person importing.
const saveProblem = (err) => (err.status ? err.message : err.code === '23505' ? 'That Item ID or name is already used by another dish. Use another.' : 'Could not be saved');

// Runs one row's writes so that a failure undoes only that row.
async function row(client, record, fn) {
  await client.query('SAVEPOINT import_row');
  try {
    await fn();
    await client.query('RELEASE SAVEPOINT import_row');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT import_row');
    await client.query('RELEASE SAVEPOINT import_row');
    record.result = 'failed';
    record.result_message = saveProblem(err);
    if (!err.status && err.code !== '23505') console.error('import row failed:', err.message);
  }
}

// The first number of the advisory lock that lets one menu import run at a time per restaurant.
const IMPORT_LOCK = 7101;

// POST /menu/import/:id/commit { mode: 'create' | 'update' }
//   create  add what is new; anything already on the menu is skipped
//   update  add what is new and update what matches (by Item ID, else by category and name)
// A new category is created together with its dishes, and only if at least one of them is saved
// (or the file lists it without dishes). The summary is counted from what was actually saved.
router.post('/:id/commit', async (req, res) => {
  const { restaurantId } = req.user;
  const mode = req.body?.mode === 'update' ? 'update' : 'create';

  const result = await db.tx(async (client) => {
    // One import at a time: a second one waits, then sees what the first created, so two imports
    // at once cannot both create the same category.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [IMPORT_LOCK, restaurantId]);
    const found = await client.query('SELECT * FROM imports WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [req.params.id, restaurantId]);
    const job = found.rows[0];
    if (!job) throw new AppError(404, 'no_import', 'This import has expired. Upload the file again.');
    // Already imported (a retry after a lost answer): give the same summary, change nothing.
    if (job.committed_at) return { summary: job.summary, records: job.rows, repeated: true };

    const records = job.rows;
    // Previews made before version 2.0.2 kept the checks against the menu as plain errors.
    for (const r of [...records.categories, ...records.items]) {
      if (!r.derived) r.errors = r.errors.filter((e) => !e.startsWith('Category "') && !e.startsWith('Kitchen terminal "'));
    }
    // The menu may have changed since the preview, so everything is matched again now.
    importer.classify(records, await loadExisting(client, restaurantId));

    // Kitchens the file names that the restaurant did not have: made now, so their dishes can go to them.
    const madeKitchens = [];
    for (const name of records.new_kitchens || []) {
      const made = await client.query(
        `INSERT INTO kitchen_terminals (restaurant_id, name, sort)
         VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM kitchen_terminals WHERE restaurant_id = $1))
         ON CONFLICT DO NOTHING RETURNING id`,
        [restaurantId, name]
      );
      if (made.rows[0]) {
        madeKitchens.push(name);
        await audit(client, { restaurantId, userId: req.user.id, action: 'terminal.add', entity: 'terminal', entityId: made.rows[0].id, new: { name, from: 'menu import' } });
      }
    }
    const kitchens = (await client.query('SELECT id, name FROM kitchen_terminals WHERE restaurant_id = $1', [restaurantId])).rows;
    for (const item of records.items) {
      for (const name of item.new_kitchens || []) {
        const k = kitchens.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (k && !item.terminal_ids.includes(k.id)) item.terminal_ids.push(k.id);
      }
      item.terminal_id = item.terminal_ids?.[0] ?? null;
    }

    // Categories already on the menu: changed when updating, else left exactly as they are.
    for (const c of records.categories) {
      if (c.status === 'error') { c.result = 'failed'; continue; }
      if (c.status !== 'update') continue;
      if (mode !== 'update' || c.changes.length === 0) { c.result = 'skipped'; c.result_message = mode === 'update' ? 'Nothing to change' : 'Already on the menu'; continue; }
      await row(client, c, async () => {
        const set = {};
        if (c.name && c.changes.some((ch) => ch.field === 'Name')) set.name = c.name;
        if (c.code) set.code = c.code;
        if (c.description !== null) set.description = c.description || null;
        if (c.active !== null) set.active = c.active;
        const cols = Object.keys(set);
        if (cols.length) await client.query(`UPDATE categories SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [c.match_id, ...cols.map((k) => set[k])]);
        if (c.position !== null) await client.query('UPDATE categories SET sort = $1 WHERE id = $2', [c.position, c.match_id]);
        c.result = 'updated';
      });
    }

    // One dish into its category: a new dish, or (when updating) the dish it matches.
    const saveItem = async (item, category) => {
      const fields = {
        name: item.name,
        ...(item.description !== null ? { description: item.description || null } : {}),
        ...(item.veg !== null ? { veg: item.veg } : {}),
        sizes: item.sizes,
        price: item.price,
        ...(item.groups.length ? { modifier_groups: item.groups } : {}),
        ...(item.tax_rate !== null ? { tax_rate: item.tax_rate } : {}),
        ...(item.tax_mode !== null ? { tax_mode: item.tax_mode } : {}),
        // Tax mode Restaurant or None says exactly what the tax is, so it is always written.
        ...(item.tax_kind && item.tax_kind !== 'custom' ? { tax_rate: item.tax_rate, tax_mode: null } : {}),
        ...(item.open_price !== null && item.open_price !== undefined ? { open_price: item.open_price } : {}),
        ...(item.active !== null ? { available: item.active } : {}),
      };
      const into = { id: category.id, name: category.name };
      if (item.status === 'update') {
        if (mode !== 'update' || item.changes.length === 0) {
          item.result = 'skipped';
          const otherDish = item.match_by === 'code' && importer.sameKey(item.match_name) !== importer.sameKey(item.name);
          item.result_message = mode === 'update'
            ? 'Nothing to change'
            : otherDish ? `Item ID ${item.code} is already used by ${item.match_name}${item.match_category ? ` (${item.match_category})` : ''}` : 'Already on the menu';
          return;
        }
        await row(client, item, async () => {
          const set = { ...fields, category_id: category.id, ...(item.terminal_ids?.length ? { terminal_id: item.terminal_ids[0], terminal_ids: item.terminal_ids } : {}), ...(item.position !== null ? { sort: item.position } : {}) };
          const cols = Object.keys(set);
          const before = (await client.query(`SELECT ${cols.join(', ')} FROM menu_items WHERE id = $1`, [item.match_id])).rows[0];
          await client.query(
            `UPDATE menu_items SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
            [item.match_id, ...cols.map((k) => (menu.JSON_COLS.includes(k) ? JSON.stringify(set[k]) : set[k]))]
          );
          await audit(client, { restaurantId, userId: req.user.id, action: 'menu.import_update', entity: 'menu_item', entityId: item.match_id, old: before, new: set });
          item.saved_id = item.match_id;
          item.saved_category = into;
          item.result = 'updated';
        });
        return;
      }
      await row(client, item, async () => {
        const id = await menu.insertItem(client, restaurantId, req.user.id, category, { customisations: [], ...fields }, { code: item.code, terminalId: item.terminal_id ?? null, terminalIds: item.terminal_ids?.length ? item.terminal_ids : null, action: 'menu.import_add' });
        if (item.position !== null) await client.query('UPDATE menu_items SET sort = $1 WHERE id = $2', [item.position, id]);
        item.saved_id = id;
        item.saved_category = into;
        item.result = 'created';
      });
    };

    // Each new category with its dishes, as one unit: when none of its dishes can be saved, the
    // category is taken back out too, so no category is left behind empty because its dishes failed.
    for (const c of records.categories) {
      if (c.status !== 'new') continue;
      const mine = records.items.filter((i) => i.category_key === c.key && i.status !== 'error');
      await client.query('SAVEPOINT import_category');
      try {
        const id = await menu.insertCategory(client, restaurantId, req.user.id, { name: c.name, code: c.code, description: c.description, active: c.active ?? true }, { position: c.position, action: 'category.import' });
        const category = (await client.query('SELECT * FROM categories WHERE id = $1', [id])).rows[0];
        for (const item of mine) await saveItem(item, category);
        const tried = mine.filter((i) => i.result !== 'skipped');
        if (tried.length > 0 && tried.every((i) => i.result === 'failed')) {
          await client.query('ROLLBACK TO SAVEPOINT import_category');
          c.result = 'failed';
          c.result_message = 'Not created, because none of its dishes could be saved';
        } else {
          c.result = 'created';
          c.saved_id = id;
        }
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT import_category');
        c.result = 'failed';
        c.result_message = saveProblem(err);
        for (const item of mine) Object.assign(item, { result: 'failed', result_message: `Its category "${c.name}" could not be created: ${c.result_message}`, saved_id: undefined, saved_category: undefined });
      }
      await client.query('RELEASE SAVEPOINT import_category');
    }

    // The dishes for categories already on the menu.
    const categories = (await client.query('SELECT * FROM categories WHERE restaurant_id = $1 AND deleted_at IS NULL', [restaurantId])).rows;
    // A dish's category: the one it was matched to, else by its Category ID, else by name.
    const categoryOf = (item) =>
      categories.find((c) => c.id === item.category_match_id) ||
      (item.category_code && categories.find((c) => c.code && importer.sameKey(c.code) === importer.sameKey(item.category_code))) ||
      categories.find((c) => importer.sameKey(c.name) === importer.sameKey(item.category));
    for (const item of records.items) {
      if (item.result) continue; // saved, or not, with its new category above
      if (item.status === 'error') { item.result = 'failed'; continue; }
      const category = categoryOf(item);
      if (!category) { item.result = 'failed'; item.result_message = `Category "${item.category || item.category_code}" was not imported`; continue; }
      await saveItem(item, category);
    }

    // "Go well with": linked once every item of the file is on the menu, so a dish may point at
    // another dish further down the same file. Codes that match nothing were warned about.
    const linked = records.items.filter((i) => (i.result === 'created' || i.result === 'updated') && i.suggestions);
    if (linked.length) {
      const codes = (await client.query('SELECT id, code FROM menu_items WHERE restaurant_id = $1 AND deleted_at IS NULL', [restaurantId])).rows;
      const idOf = new Map(codes.map((r) => [r.code.toUpperCase(), r.id]));
      for (const item of linked) {
        await menu.setAddons(client, restaurantId, item.saved_id, item.suggestions.map((c) => idOf.get(c)).filter(Boolean));
      }
    }

    // The summary, counted from what was saved.
    const tally = (list) => ({
      created: list.filter((r) => r.result === 'created').length,
      updated: list.filter((r) => r.result === 'updated').length,
      skipped: list.filter((r) => r.result === 'skipped').length,
      failed: list.filter((r) => r.result === 'failed').length,
    });
    const cats = tally(records.categories);
    const items = tally(records.items);
    const made = records.categories.filter((c) => c.result === 'created');
    const madeIds = new Set(made.map((c) => c.saved_id));
    const reused = new Map();
    for (const item of records.items) {
      if ((item.result === 'created' || item.result === 'updated') && item.saved_category && !madeIds.has(item.saved_category.id)) reused.set(item.saved_category.id, item.saved_category.name);
    }
    const repeated = records.items.reduce((n, i) => n + (i.repeats || 0), 0);
    const failedRows = new Set([...records.categories, ...records.items].filter((r) => r.result === 'failed').flatMap((r) => r.rows));
    const summary = {
      mode,
      filename: job.filename,
      rows: records.row_count ?? null,
      created: cats.created + items.created,
      updated: cats.updated + items.updated,
      skipped: cats.skipped + items.skipped,
      failed: cats.failed + items.failed + (records.orphans || []).length,
      categories: cats,
      items,
      categories_created: made.map((c) => c.name),
      categories_reused: [...reused.values()],
      duplicates: items.skipped + repeated,
      repeated_rows: repeated,
      rows_failed: failedRows.size + (records.orphans || []).length,
      kitchens: madeKitchens,
      warnings: [...records.categories, ...records.items].reduce((n, r) => n + r.warnings.length, 0),
    };
    await client.query('UPDATE imports SET rows = $1, mode = $2, summary = $3, committed_at = now() WHERE id = $4', [JSON.stringify(records), mode, JSON.stringify(summary), job.id]);
    await audit(client, { restaurantId, userId: req.user.id, action: 'menu.import', entity: 'import', entityId: null, new: summary });
    return { summary, records };
  });

  if (!result.repeated) ws.toRestaurant(restaurantId, 'menu.updated', {});
  const problems = [...result.records.categories.map(brief('category')), ...result.records.items.map(brief('item'))].filter((r) => r.result === 'failed' || r.result === 'skipped' || r.warnings.length);
  res.json({ id: req.params.id, summary: result.summary, problems: problems.slice(0, 200) });
});

// GET /menu/import/:id/errors.csv — every row that was not imported, skipped or carries a warning.
router.get('/:id/errors.csv', async (req, res) => {
  const { rows } = await db.query('SELECT rows FROM imports WHERE id = $1 AND restaurant_id = $2', [req.params.id, req.user.restaurantId]);
  if (!rows[0]) throw new AppError(404, 'no_import', 'This import has expired');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="potko-import-report.csv"');
  res.send(importer.errorReport(rows[0].rows));
});

module.exports = router;
