// Database migrations: the numbered files in sql/migrations, each applied once and in order.
// sql/schema.sql is the starting point (version 1); every later change to the tables is a migration,
// so a database with a restaurant's real data is upgraded in place and never rebuilt.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'sql', 'migrations');

// conn: { run(sql) -> runs one or many statements, rows(sql) -> array of rows }.
// Each file runs inside one transaction: it is applied completely or not at all.
async function migrate(conn, log = () => {}) {
  await conn.run('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await conn.rows('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    await conn.run('BEGIN');
    try {
      await conn.run(sql);
      await conn.run(`INSERT INTO schema_migrations (name) VALUES ('${file}')`);
      await conn.run('COMMIT');
    } catch (err) {
      await conn.run('ROLLBACK').catch(() => {});
      err.message = `Migration ${file} failed: ${err.message}`;
      throw err;
    }
    log(`Applied migration ${file}`);
    applied.push(file);
  }
  return applied;
}

// For the server and the scripts: migrate through one connection of the pg pool.
async function migratePool(pool, log) {
  const client = await pool.connect();
  try {
    const conn = { run: (sql) => client.query(sql), rows: async (sql) => (await client.query(sql)).rows };
    // An empty database has no tables to upgrade: "npm run db:setup" creates them first.
    const [{ exists }] = await conn.rows("SELECT to_regclass('public.restaurants') IS NOT NULL AS exists");
    if (!exists) return null;
    return await migrate(conn, log);
  } finally {
    client.release();
  }
}

module.exports = { migrate, migratePool };
