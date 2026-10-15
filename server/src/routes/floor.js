// Setting up the restaurant's space: dining areas, the tables in them (list and layout), and the
// kitchen terminals that tickets are routed to. Service status (free, occupied, ready) is never
// set here: it always follows from orders.
const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm } = require('../permissions');
const { forgetUser } = require('../auth');
const { audit } = require('../orders');
const { getTable, listTables } = require('../tables');
const ws = require('../ws/events');

const router = express.Router();
const manage = requirePerm('tables.manage');
const menuOrTables = requirePerm('tables.manage', 'menu.manage', 'staff.manage');
const staff = requirePerm('staff.manage');
const bad = (message) => new AppError(400, 'bad_input', message);
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const AREA_KINDS = ['indoor', 'outdoor', 'private', 'bar', 'custom'];
const TABLE_KINDS = ['normal', 'vip', 'booth', 'outdoor', 'custom'];
const SHAPES = ['square', 'round', 'rectangle', 'booth'];
const SIZES = ['small', 'medium', 'large'];

const AREA_SELECT = `
  SELECT a.id, a.name, a.kind, a.description, a.active, a.sort, a.image_id, a.floor_id, f.name AS floor_name,
         (SELECT count(*)::int FROM tables t WHERE t.area_id = a.id AND NOT t.archived AND t.parent_table_id IS NULL) AS table_count
    FROM dining_areas a JOIN floors f ON f.id = a.floor_id`;

// Areas come floor by floor, in the order the floors are listed.
async function listAreas(q, restaurantId) {
  const { rows } = await q.query(`${AREA_SELECT} WHERE a.restaurant_id = $1 AND a.deleted_at IS NULL ORDER BY f.sort, f.id, a.sort, a.id`, [restaurantId]);
  return rows;
}
async function listFloors(q, restaurantId) {
  const { rows } = await q.query(
    `SELECT f.id, f.name, f.active, f.sort,
            (SELECT count(*)::int FROM dining_areas a WHERE a.floor_id = f.id AND a.deleted_at IS NULL) AS area_count
       FROM floors f WHERE f.restaurant_id = $1 AND f.deleted_at IS NULL ORDER BY f.sort, f.id`,
    [restaurantId]
  );
  return rows;
}
async function ownFloor(q, restaurantId, floorId) {
  const { rows } = await q.query('SELECT id, name FROM floors WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [floorId, restaurantId]);
  if (!rows[0]) throw new AppError(400, 'bad_input', 'Choose a floor');
  return rows[0];
}
async function listTerminals(q, restaurantId) {
  const { rows } = await q.query(
    `SELECT k.id, k.name, k.active, k.is_default, k.sort,
            -- Dishes with no terminal of their own are cooked at the default one.
            (SELECT count(*)::int FROM menu_items m
              WHERE m.restaurant_id = k.restaurant_id AND m.deleted_at IS NULL
                AND (k.id = ANY(m.terminal_ids) OR (k.is_default AND cardinality(m.terminal_ids) = 0))) AS item_count,
            (SELECT count(*)::int FROM user_terminals ut JOIN users u ON u.id = ut.user_id WHERE ut.terminal_id = k.id AND u.deleted_at IS NULL) AS chef_count,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                        FROM user_terminals ut JOIN users u ON u.id = ut.user_id
                       WHERE ut.terminal_id = k.id AND u.deleted_at IS NULL AND u.role = 'chef'), '[]') AS chefs
       FROM kitchen_terminals k WHERE k.restaurant_id = $1 ORDER BY k.sort, k.id`,
    [restaurantId]
  );
  return rows;
}

// Everyone's screens re-read areas and terminals when they change.
const floorChanged = (restaurantId) => ws.toRestaurant(restaurantId, 'floor.updated', {});
const note = (req, action, entity, entityId, extra) => audit(db, { restaurantId: req.user.restaurantId, userId: req.user.id, action, entity, entityId, ...extra });
const nameTaken = (what) => (err) => { throw err.code === '23505' ? new AppError(409, 'name_taken', `There is already ${what} with that name`) : err; };

// ---------- Floors ----------

router.get('/floors', async (req, res) => {
  res.json({ floors: await listFloors(db, req.user.restaurantId) });
});

// POST /floors { name }
router.post('/floors', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const name = text(req.body?.name, 40);
  if (!name) throw bad('Give the floor a name, for example First Floor');
  const { rows } = await db
    .query(`INSERT INTO floors (restaurant_id, name, sort) VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM floors WHERE restaurant_id = $1)) RETURNING id`, [restaurantId, name])
    .catch(nameTaken('a floor'));
  await note(req, 'floor.add', 'floor', rows[0].id, { new: { name } });
  floorChanged(restaurantId);
  res.status(201).json({ floors: await listFloors(db, restaurantId), id: rows[0].id });
});

// PATCH /floors/:id { name?, active? }
router.patch('/floors/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query('SELECT * FROM floors WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_floor', 'No such floor');
  const fields = {};
  if (req.body?.name !== undefined) {
    fields.name = text(req.body.name, 40);
    if (!fields.name) throw bad('Give the floor a name');
  }
  if (req.body?.active !== undefined) {
    fields.active = req.body.active === true;
    if (!fields.active) {
      const busy = await db.query(
        `SELECT 1 FROM tables t JOIN dining_areas a ON a.id = t.area_id WHERE a.floor_id = $1 AND NOT t.archived AND t.status <> 'free' LIMIT 1`,
        [id]
      );
      if (busy.rows[0]) throw new AppError(409, 'floor_busy', `${before.name} has tables in use. Close them before switching the floor off.`);
    }
  }
  const cols = Object.keys(fields);
  if (cols.length) {
    await db.query(`UPDATE floors SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => fields[c])]).catch(nameTaken('a floor'));
    await note(req, 'floor.edit', 'floor', id, { old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: fields });
  }
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'tables.changed', {});
  res.json({ floors: await listFloors(db, restaurantId) });
});

// POST /floors/:id/move { direction: 'up' | 'down' }
router.post('/floors/:id/move', manage, async (req, res) => {
  await swapSort('floors', 'deleted_at IS NULL', req.user.restaurantId, Number(req.params.id), req.body?.direction);
  floorChanged(req.user.restaurantId);
  res.json({ floors: await listFloors(db, req.user.restaurantId) });
});

// DELETE /floors/:id — only a floor with no dining areas left on it.
router.delete('/floors/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query('SELECT * FROM floors WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_floor', 'No such floor');
  const areas = await db.query('SELECT count(*)::int AS n FROM dining_areas WHERE floor_id = $1 AND deleted_at IS NULL', [id]);
  if (areas.rows[0].n > 0) throw new AppError(409, 'floor_has_areas', `${before.name} still has ${areas.rows[0].n} dining area${areas.rows[0].n === 1 ? '' : 's'}. Move or delete them first.`);
  const others = await db.query('SELECT 1 FROM floors WHERE restaurant_id = $1 AND deleted_at IS NULL AND id <> $2 LIMIT 1', [restaurantId, id]);
  if (!others.rows[0]) throw new AppError(409, 'last_floor', 'A restaurant needs at least one floor');
  await db.query('UPDATE floors SET deleted_at = now(), active = false WHERE id = $1', [id]);
  await note(req, 'floor.delete', 'floor', id, { old: { name: before.name } });
  floorChanged(restaurantId);
  res.json({ floors: await listFloors(db, restaurantId) });
});

// ---------- Dining areas ----------

router.get('/areas', async (req, res) => {
  res.json({ areas: await listAreas(db, req.user.restaurantId) });
});

function readArea(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name, 40);
    if (!out.name) throw bad('Give the area a name, for example Ground Floor');
  }
  if (!partial || body.kind !== undefined) {
    out.kind = body.kind ?? 'indoor';
    if (!AREA_KINDS.includes(out.kind)) throw bad('Choose an area type');
  }
  if (body.description !== undefined) out.description = text(body.description, 120) || null;
  if (body.active !== undefined) out.active = body.active === true;
  if (body.image_id !== undefined) out.image_id = Number.isInteger(body.image_id) ? body.image_id : null;
  if (body.floor_id !== undefined) out.floor_id = Number(body.floor_id);
  return out;
}

// POST /areas { name, floor_id?, kind, description?, active?, tables? } — tables: how many to create now (T1, T2, ...).
// Without floor_id the area goes on the first floor.
router.post('/areas', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const fields = readArea(req.body || {}, false);
  const count = Number(req.body?.tables ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > 60) throw bad('Up to 60 tables can be added at once');

  const id = await db.tx(async (client) => {
    const floorId = fields.floor_id
      ? (await ownFloor(client, restaurantId, fields.floor_id)).id
      : (await client.query('SELECT id FROM floors WHERE restaurant_id = $1 AND deleted_at IS NULL ORDER BY sort, id LIMIT 1', [restaurantId])).rows[0].id;
    fields.floor_id = floorId;
    const { rows } = await client.query(
      `INSERT INTO dining_areas (restaurant_id, name, kind, description, active, image_id, floor_id, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(max(sort), 0) + 1 FROM dining_areas WHERE restaurant_id = $1))
       RETURNING id`,
      [restaurantId, fields.name, fields.kind, fields.description ?? null, fields.active ?? true, fields.image_id ?? null, floorId]
    );
    // New tables carry on from the highest T-number the restaurant already has.
    if (count > 0) {
      const top = await client.query(
        `SELECT COALESCE(max(substring(label from '^[Tt]([0-9]+)$')::int), 0) AS n FROM tables WHERE restaurant_id = $1 AND NOT archived`,
        [restaurantId]
      );
      for (let n = 1; n <= count; n += 1) {
        await client.query(
          `INSERT INTO tables (restaurant_id, label, seats, area_id, sort) VALUES ($1, $2, 4, $3, $4)`,
          [restaurantId, `T${top.rows[0].n + n}`, rows[0].id, top.rows[0].n + n]
        );
      }
    }
    await audit(client, { restaurantId, userId: req.user.id, action: 'area.add', entity: 'area', entityId: rows[0].id, new: { ...fields, tables: count } });
    return rows[0].id;
  }).catch(nameTaken('an area'));

  floorChanged(restaurantId);
  if (count > 0) ws.toRestaurant(restaurantId, 'tables.changed', {});
  const areas = await listAreas(db, restaurantId);
  res.status(201).json({ area: areas.find((a) => a.id === id) });
});

// PATCH /areas/:id { name?, kind?, description?, active?, image_id? }
router.patch('/areas/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query(`${AREA_SELECT} WHERE a.id = $1 AND a.restaurant_id = $2 AND a.deleted_at IS NULL`, [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_area', 'No such area');
  const fields = readArea(req.body || {}, true);
  if (fields.floor_id !== undefined) await ownFloor(db, restaurantId, fields.floor_id);
  if (fields.active === false) {
    const busy = await db.query(
      `SELECT 1 FROM tables WHERE area_id = $1 AND NOT archived AND status <> 'free' LIMIT 1`,
      [id]
    );
    if (busy.rows[0]) throw new AppError(409, 'area_busy', `${before.name} has tables in use. Close them before switching the area off.`);
  }
  const cols = Object.keys(fields);
  if (cols.length) {
    await db
      .query(`UPDATE dining_areas SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => fields[c])])
      .catch(nameTaken('an area'));
    await note(req, 'area.edit', 'area', id, { old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: fields });
  }
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'tables.changed', {});
  const areas = await listAreas(db, restaurantId);
  res.json({ area: areas.find((a) => a.id === id) });
});

// POST /areas/:id/move { direction: 'up' | 'down' } — the order areas are listed in.
router.post('/areas/:id/move', manage, async (req, res) => {
  await swapSort('dining_areas', 'deleted_at IS NULL', req.user.restaurantId, Number(req.params.id), req.body?.direction);
  floorChanged(req.user.restaurantId);
  res.json({ areas: await listAreas(db, req.user.restaurantId) });
});

// DELETE /areas/:id — only an area with no tables left in it. Move or delete its tables first.
router.delete('/areas/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query(`${AREA_SELECT} WHERE a.id = $1 AND a.restaurant_id = $2 AND a.deleted_at IS NULL`, [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_area', 'No such area');
  const left = await db.query(
    `SELECT count(*)::int AS tables,
            count(*) FILTER (WHERE status <> 'free')::int AS busy
       FROM tables WHERE area_id = $1 AND NOT archived`,
    [id]
  );
  if (left.rows[0].busy > 0) throw new AppError(409, 'area_busy', `${before.name} has ${left.rows[0].busy} table${left.rows[0].busy === 1 ? '' : 's'} in use. Close them first.`);
  if (left.rows[0].tables > 0) throw new AppError(409, 'area_has_tables', `${before.name} still has ${left.rows[0].tables} table${left.rows[0].tables === 1 ? '' : 's'}. Move them to another area or delete them first.`);
  const others = await db.query('SELECT 1 FROM dining_areas WHERE restaurant_id = $1 AND deleted_at IS NULL AND id <> $2 LIMIT 1', [restaurantId, id]);
  if (!others.rows[0]) throw new AppError(409, 'last_area', 'A restaurant needs at least one dining area');
  await db.query('UPDATE dining_areas SET deleted_at = now(), active = false WHERE id = $1', [id]);
  await note(req, 'area.delete', 'area', id, { old: { name: before.name, kind: before.kind } });
  floorChanged(restaurantId);
  res.json({ ok: true });
});

// Moves a row one place up or down among its siblings by swapping their sort numbers.
async function swapSort(table, where, restaurantId, id, direction, scope = '', scopeArgs = []) {
  if (!['up', 'down'].includes(direction)) throw bad('Move up or down');
  await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id, sort FROM ${table} WHERE restaurant_id = $1 AND ${where} ${scope} ORDER BY sort, id FOR UPDATE`,
      [restaurantId, ...scopeArgs]
    );
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) throw new AppError(404, 'not_found', 'That is no longer there');
    const other = direction === 'up' ? index - 1 : index + 1;
    if (other < 0 || other >= rows.length) return;
    // Renumber the whole list so that equal sort numbers (from older data) can never block a move.
    const order = rows.map((r) => r.id);
    [order[index], order[other]] = [order[other], order[index]];
    for (let n = 0; n < order.length; n += 1) await client.query(`UPDATE ${table} SET sort = $1 WHERE id = $2`, [n + 1, order[n]]);
  });
}

// Puts rows in the order they were dragged into: ids top to bottom get sort 1, 2, 3...
// where/params pick the rows that may be ordered together (one restaurant, one category, one area).
async function setOrder(table, where, params, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (wanted.length === 0) throw bad('Nothing to put in order');
  const found = await db.query(`SELECT id FROM ${table} WHERE ${where} AND id = ANY($${params.length + 1}::int[])`, [...params, wanted]);
  if (found.rows.length !== wanted.length) throw bad('The list changed while you were moving it. Try again.');
  await db.tx(async (client) => {
    for (let i = 0; i < wanted.length; i += 1) await client.query(`UPDATE ${table} SET sort = $1 WHERE id = $2`, [i + 1, wanted[i]]);
  });
}

// PUT /areas/order { ids } — the dining areas of one floor, top to bottom (dragged into order).
router.put('/areas/order', manage, async (req, res) => {
  const { restaurantId } = req.user;
  await setOrder('dining_areas', 'restaurant_id = $1 AND deleted_at IS NULL', [restaurantId], req.body?.ids);
  await note(req, 'area.reorder', 'area', null, { new: { ids: req.body?.ids } });
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'tables.changed', {});
  res.json({ areas: await listAreas(db, restaurantId) });
});

// PUT /areas/:id/tables/order { ids } — the tables of one dining area, top to bottom.
router.put('/areas/:id/tables/order', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const area = await ownArea(restaurantId, Number(req.params.id));
  await setOrder('tables', 'restaurant_id = $1 AND area_id = $2 AND NOT archived AND parent_table_id IS NULL', [restaurantId, area.id], req.body?.ids);
  await note(req, 'table.reorder', 'area', area.id, { new: { area: area.name, ids: req.body?.ids } });
  ws.toRestaurant(restaurantId, 'tables.changed', {});
  res.json({ ok: true });
});

// ---------- Tables ----------

// GET /tables — every table with its live state (configuration screens also want the switched-off ones).
router.get('/tables', async (req, res) => {
  res.json({ tables: await listTables(db, req.user.restaurantId) });
});

async function ownArea(restaurantId, areaId) {
  const { rows } = await db.query('SELECT id, name FROM dining_areas WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL', [areaId, restaurantId]);
  if (!rows[0]) throw bad('Choose a dining area');
  return rows[0];
}

function readTable(body, partial) {
  const out = {};
  if (!partial || body.label !== undefined) {
    out.label = text(body.label, 12);
    if (!out.label) throw bad('Give the table a name, for example T7');
    if (/\.\d+$/.test(out.label)) throw bad('Names ending in .1, .2 are kept for the parts of a split table');
  }
  if (!partial || body.seats !== undefined) {
    out.seats = Number(body.seats ?? 4);
    if (!Number.isInteger(out.seats) || out.seats < 1 || out.seats > 50) throw bad('Capacity is a number from 1 to 50');
  }
  if (body.kind !== undefined) { if (!TABLE_KINDS.includes(body.kind)) throw bad('Choose a table type'); out.kind = body.kind; }
  if (body.shape !== undefined) { if (!SHAPES.includes(body.shape)) throw bad('Choose a shape'); out.shape = body.shape; }
  if (body.size !== undefined) { if (!SIZES.includes(body.size)) throw bad('Choose a size'); out.size = body.size; }
  if (body.active !== undefined) out.active = body.active === true;
  for (const key of ['pos_x', 'pos_y']) {
    if (body[key] === undefined) continue;
    const value = body[key] === null ? null : Number(body[key]);
    if (value !== null && !(value >= 0 && value <= 1)) throw bad('That position is outside the layout');
    out[key] = value;
  }
  return out;
}

// POST /tables { label, seats, area_id, kind?, shape?, size?, active? }
router.post('/tables', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const fields = readTable(req.body || {}, false);
  const area = await ownArea(restaurantId, req.body?.area_id);
  const { rows } = await db
    .query(
      `INSERT INTO tables (restaurant_id, label, seats, area_id, kind, shape, size, active, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(sort), 0) + 1 FROM tables WHERE restaurant_id = $1))
       RETURNING id`,
      [restaurantId, fields.label, fields.seats, area.id, fields.kind ?? 'normal', fields.shape ?? 'square', fields.size ?? 'medium', fields.active ?? true]
    )
    .catch(nameTaken('a table'));
  await note(req, 'table.add', 'table', rows[0].id, { new: { ...fields, area: area.name }, refs: { table_id: rows[0].id } });
  const table = await getTable(db, restaurantId, rows[0].id);
  ws.tableToRestaurant(restaurantId, table);
  floorChanged(restaurantId);
  res.status(201).json({ table });
});

// PATCH /tables/:id { label?, seats?, area_id?, kind?, shape?, size?, active?, pos_x?, pos_y? }
router.patch('/tables/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = await getTable(db, restaurantId, id);
  if (!before || before.archived) throw new AppError(404, 'no_table', 'No such table');
  if (before.parent_table_id) throw new AppError(409, 'split_part', 'This is part of a split table. Merge it back to change it.');
  const fields = readTable(req.body || {}, true);
  if (req.body?.area_id !== undefined && Number(req.body.area_id) !== before.area_id) {
    fields.area_id = (await ownArea(restaurantId, req.body.area_id)).id;
    // A table moved to another area starts unplaced on that area's layout.
    if (fields.pos_x === undefined) { fields.pos_x = null; fields.pos_y = null; }
  }
  const busy = before.status !== 'free';
  if (busy && (fields.active === false || fields.area_id)) {
    throw new AppError(409, 'table_busy', `${before.label} is in use. Close it before ${fields.active === false ? 'switching it off' : 'moving it'}.`);
  }
  const cols = Object.keys(fields);
  if (cols.length) {
    await db
      .query(`UPDATE tables SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => fields[c])])
      .catch(nameTaken('a table'));
    const layoutOnly = cols.every((c) => c === 'pos_x' || c === 'pos_y');
    if (!layoutOnly) {
      await note(req, 'table.edit', 'table', id, { old: Object.fromEntries(cols.map((c) => [c, before[c]])), new: fields, refs: { table_id: id } });
    }
  }
  const table = await getTable(db, restaurantId, id);
  ws.tableToRestaurant(restaurantId, table);
  if (fields.area_id) floorChanged(restaurantId);
  res.json({ table });
});

// PUT /areas/:id/layout { positions: [{ id, x, y }] } — where each table sits on the area's plan (0..1).
router.put('/areas/:id/layout', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const area = await ownArea(restaurantId, Number(req.params.id));
  const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
  if (positions.length > 200) throw bad('Too many tables');
  const clean = positions.map((p) => ({ id: Number(p.id), x: p.x === null ? null : Number(p.x), y: p.y === null ? null : Number(p.y) }));
  if (clean.some((p) => !Number.isInteger(p.id) || (p.x !== null && !(p.x >= 0 && p.x <= 1)) || (p.y !== null && !(p.y >= 0 && p.y <= 1)))) throw bad('A table is outside the layout');
  await db.tx(async (client) => {
    for (const p of clean) {
      await client.query('UPDATE tables SET pos_x = $1, pos_y = $2 WHERE id = $3 AND restaurant_id = $4 AND area_id = $5', [p.x, p.y, p.id, restaurantId, area.id]);
    }
    await audit(client, { restaurantId, userId: req.user.id, action: 'layout.edit', entity: 'area', entityId: area.id, new: { area: area.name, tables: clean.length } });
  });
  ws.toRestaurant(restaurantId, 'tables.changed', {});
  res.json({ ok: true });
});

// DELETE /tables/:id — a table that is not in use. It is put away, so old orders still show it.
router.delete('/tables/:id', manage, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = await getTable(db, restaurantId, id);
  if (!before || before.archived) throw new AppError(404, 'no_table', 'No such table');
  if (before.status !== 'free' || before.order_id) throw new AppError(409, 'table_busy', `${before.label} is in use. Close it before deleting it.`);
  await db.query('UPDATE tables SET archived = true, active = false, locked_by = NULL, locked_at = NULL WHERE id = $1', [id]);
  await note(req, 'table.delete', 'table', id, { old: { label: before.label, seats: before.seats, area: before.area_name }, refs: { table_id: id } });
  ws.toRestaurant(restaurantId, 'table.removed', { id });
  floorChanged(restaurantId);
  res.json({ ok: true });
});

// ---------- Kitchen terminals ----------

router.get('/terminals', async (req, res) => {
  res.json({ terminals: await listTerminals(db, req.user.restaurantId) });
});

// POST /terminals { name }
router.post('/terminals', menuOrTables, async (req, res) => {
  const { restaurantId } = req.user;
  const name = text(req.body?.name, 40);
  if (!name) throw bad('Give the terminal a name, for example Tandoor');
  const { rows } = await db
    .query(
      `INSERT INTO kitchen_terminals (restaurant_id, name, sort) VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM kitchen_terminals WHERE restaurant_id = $1)) RETURNING id`,
      [restaurantId, name]
    )
    .catch(nameTaken('a terminal'));
  await note(req, 'terminal.add', 'terminal', rows[0].id, { new: { name } });
  floorChanged(restaurantId);
  res.status(201).json({ terminals: await listTerminals(db, restaurantId), id: rows[0].id });
});

// PATCH /terminals/:id { name?, active?, is_default? }
router.patch('/terminals/:id', menuOrTables, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query('SELECT * FROM kitchen_terminals WHERE id = $1 AND restaurant_id = $2', [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_terminal', 'No such terminal');
  const body = req.body || {};
  await db.tx(async (client) => {
    if (body.name !== undefined) {
      const name = text(body.name, 40);
      if (!name) throw bad('Give the terminal a name');
      await client.query('UPDATE kitchen_terminals SET name = $1 WHERE id = $2', [name, id]);
    }
    if (body.is_default === true && !before.is_default) {
      await client.query('UPDATE kitchen_terminals SET is_default = false WHERE restaurant_id = $1', [restaurantId]);
      await client.query('UPDATE kitchen_terminals SET is_default = true, active = true WHERE id = $1', [id]);
    }
    if (body.active !== undefined) {
      // Tickets always need somewhere to go: the default terminal cannot be switched off.
      if (body.active === false && (before.is_default && body.is_default !== false)) throw new AppError(409, 'default_terminal', 'Make another terminal the default before switching this one off');
      await client.query('UPDATE kitchen_terminals SET active = $1 WHERE id = $2', [body.active === true, id]);
    }
    await audit(client, { restaurantId, userId: req.user.id, action: 'terminal.edit', entity: 'terminal', entityId: id, old: { name: before.name, active: before.active, is_default: before.is_default }, new: body });
  }).catch(nameTaken('a terminal'));
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'menu.updated', {});
  res.json({ terminals: await listTerminals(db, restaurantId) });
});

// PUT /terminals/:id/chefs { userIds: [...] } — the chefs who work at this terminal. Their boards
// show its tickets from the next moment on. (The same assignment can be made from a chef's own record.)
router.put('/terminals/:id/chefs', staff, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const terminal = (await db.query('SELECT id, name FROM kitchen_terminals WHERE id = $1 AND restaurant_id = $2', [id, restaurantId])).rows[0];
  if (!terminal) throw new AppError(404, 'no_terminal', 'No such terminal');
  const wanted = [...new Set(Array.isArray(req.body?.userIds) ? req.body.userIds.map(Number) : [])].filter(Number.isInteger);
  const chefs = (await db.query(`SELECT id, name FROM users WHERE restaurant_id = $1 AND role = 'chef' AND deleted_at IS NULL AND id = ANY($2::int[])`, [restaurantId, wanted])).rows;
  if (chefs.length !== wanted.length) throw bad('Only chefs can be assigned to a kitchen terminal');
  const changed = await db.tx(async (client) => {
    const before = (await client.query('SELECT user_id FROM user_terminals WHERE terminal_id = $1', [id])).rows.map((r) => r.user_id);
    await client.query('DELETE FROM user_terminals WHERE terminal_id = $1 AND NOT (user_id = ANY($2::int[]))', [id, wanted]);
    await client.query('INSERT INTO user_terminals (user_id, terminal_id) SELECT unnest($1::int[]), $2 ON CONFLICT DO NOTHING', [wanted, id]);
    await audit(client, { restaurantId, userId: req.user.id, action: 'terminal.chefs', entity: 'terminal', entityId: id, old: { chefs: before }, new: { terminal: terminal.name, chefs: chefs.map((c) => c.name) } });
    return [...new Set([...before, ...wanted])].filter((u) => before.includes(u) !== wanted.includes(u));
  });
  // Each chef whose terminals changed re-reads their own record, so the board follows at once.
  for (const userId of changed) {
    forgetUser(userId);
    ws.toUser(restaurantId, userId, 'me.updated', {});
  }
  floorChanged(restaurantId);
  res.json({ terminals: await listTerminals(db, restaurantId) });
});

// PUT /terminals/:id/items { itemIds: [...] } — the dishes cooked at this terminal: exactly these.
// Usually a dish is at one terminal, but it may be ticked at several; its ticket then shows at each.
// Ticking a dish here adds this terminal to it, unticking takes this terminal away. A dish left with
// no terminal is cooked at the default one (so nothing can be taken off the default terminal that
// has no other terminal: give it to another terminal instead).
// Orders already in the kitchen are not touched; the change applies from the next order.
router.put('/terminals/:id/items', requirePerm('menu.manage'), async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const terminal = (await db.query('SELECT id, name, is_default FROM kitchen_terminals WHERE id = $1 AND restaurant_id = $2', [id, restaurantId])).rows[0];
  if (!terminal) throw new AppError(404, 'no_terminal', 'No such terminal');
  const wanted = [...new Set(Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number) : [])].filter(Number.isInteger);
  const found = await db.query('SELECT id FROM menu_items WHERE restaurant_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])', [restaurantId, wanted]);
  if (found.rows.length !== wanted.length) throw bad('One of these dishes is no longer on the menu');
  const counts = await db.tx(async (client) => {
    const off = await client.query(
      `UPDATE menu_items SET terminal_ids = array_remove(terminal_ids, $2), terminal_id = (array_remove(terminal_ids, $2))[1]
        WHERE restaurant_id = $1 AND $2 = ANY(terminal_ids) AND NOT (id = ANY($3::int[]))`,
      [restaurantId, id, wanted]
    );
    const removed = off.rowCount;
    // On the default terminal, a dish with no terminal of its own is already there.
    const on = await client.query(
      `UPDATE menu_items SET terminal_ids = terminal_ids || $1, terminal_id = COALESCE(terminal_id, $1)
        WHERE restaurant_id = $2 AND id = ANY($3::int[]) AND NOT ($1 = ANY(terminal_ids))
          AND NOT ($4 AND cardinality(terminal_ids) = 0)`,
      [id, restaurantId, wanted, terminal.is_default]
    );
    await audit(client, { restaurantId, userId: req.user.id, action: 'terminal.items', entity: 'terminal', entityId: id, new: { terminal: terminal.name, added: on.rowCount, removed } });
    return { added: on.rowCount, removed };
  });
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'menu.updated', {});
  res.json({ terminals: await listTerminals(db, restaurantId), ...counts });
});

// DELETE /terminals/:id — a terminal never used. Its dishes fall back to the default terminal.
router.delete('/terminals/:id', menuOrTables, async (req, res) => {
  const { restaurantId } = req.user;
  const id = Number(req.params.id);
  const before = (await db.query('SELECT * FROM kitchen_terminals WHERE id = $1 AND restaurant_id = $2', [id, restaurantId])).rows[0];
  if (!before) throw new AppError(404, 'no_terminal', 'No such terminal');
  if (before.is_default) throw new AppError(409, 'default_terminal', 'Make another terminal the default before deleting this one');
  // A terminal that already cooked something is part of old tickets and reports: it can only be switched off.
  const used = await db.query('SELECT 1 FROM order_items WHERE terminal_id = $1 LIMIT 1', [id]);
  if (used.rows[0]) throw new AppError(409, 'terminal_used', `${before.name} has past tickets, so it cannot be deleted. Switch it off instead.`);
  await db.tx(async (client) => {
    await client.query('UPDATE menu_items SET terminal_ids = array_remove(terminal_ids, $1), terminal_id = (array_remove(terminal_ids, $1))[1] WHERE $1 = ANY(terminal_ids) OR terminal_id = $1', [id]);
    await client.query('DELETE FROM user_terminals WHERE terminal_id = $1', [id]);
    await client.query('DELETE FROM kitchen_terminals WHERE id = $1', [id]);
    await audit(client, { restaurantId, userId: req.user.id, action: 'terminal.delete', entity: 'terminal', entityId: id, old: { name: before.name } });
  });
  floorChanged(restaurantId);
  ws.toRestaurant(restaurantId, 'menu.updated', {});
  res.json({ terminals: await listTerminals(db, restaurantId) });
});

module.exports = router;
module.exports.listAreas = listAreas;
module.exports.listFloors = listFloors;
module.exports.listTerminals = listTerminals;
module.exports.swapSort = swapSort;
module.exports.setOrder = setOrder;
