// Build step of the public demo: makes the demo restaurant's database once (tables, every migration,
// the demo data) and saves it as demo-db.tgz, so the demo server starts from it in about half a
// second instead of building it again on every start (src/demo.js).
//   node src/demo-snapshot.js
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
const out = path.join(__dirname, '..', 'demo-db.tgz');

(async () => {
  const pg = await PGlite.create();
  await pg.exec(sql('schema.sql'));
  const { migrate } = require('./migrate');
  await migrate({ run: (text) => pg.exec(text), rows: async (text) => (await pg.query(text)).rows });
  await pg.exec(sql('seed.sql'));
  const dishes = (await pg.query('SELECT count(*)::int AS n FROM menu_items')).rows[0].n;
  const file = await pg.dumpDataDir('gzip');
  fs.writeFileSync(out, Buffer.from(await file.arrayBuffer()));
  await pg.close();
  console.log(`demo database saved: ${path.basename(out)} (${Math.round(fs.statSync(out).size / 1024)} KB, ${dishes} dishes)`);
})().catch((err) => {
  console.error('demo snapshot failed:', err.message);
  process.exit(1);
});
