// Pictures: menu items, categories, dining areas, staff photos and the restaurant logo.
// The app shrinks a picture before sending it; here it is checked and kept in the database.
const express = require('express');
const db = require('../db');
const { AppError } = require('../errors');
const { requirePerm } = require('../permissions');

const router = express.Router();
const MAX_BYTES = 400 * 1024;
// The first bytes of a file say what it really is, whatever its name claims.
const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

// POST /images { data } — data: the picture as base64 (JPEG, PNG or WebP, up to 400 KB).
router.post('/', requirePerm('menu.manage', 'tables.manage', 'staff.manage', 'settings.manage'), async (req, res) => {
  const raw = String(req.body?.data || '').replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(raw, 'base64');
  if (data.length < 100) throw new AppError(400, 'bad_image', 'That picture could not be read');
  if (data.length > MAX_BYTES) throw new AppError(413, 'image_too_big', 'That picture is too big. Choose a smaller one.');
  const kind = SIGNATURES.find((s) => s.test(data));
  if (!kind) throw new AppError(400, 'bad_image', 'Use a JPEG or PNG picture');
  const { rows } = await db.query(
    'INSERT INTO images (restaurant_id, mime, data, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.user.restaurantId, kind.mime, data, req.user.id]
  );
  res.status(201).json({ id: rows[0].id });
});

// GET /images/:id — the picture itself. A picture never changes once saved, so it is cached for good.
router.get('/:id', async (req, res) => {
  const { rows } = await db.query('SELECT mime, data FROM images WHERE id = $1 AND restaurant_id = $2', [Number(req.params.id) || 0, req.user.restaurantId]);
  if (!rows[0]) throw new AppError(404, 'no_image', 'No such picture');
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(rows[0].data);
});

module.exports = router;
