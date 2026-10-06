// A Postgres for your own machine with nothing to install (npm run db:local).
// For development and trying the app only: real restaurants use Neon.
// Data is kept in server/.pgdata; delete that folder to start again from the seed data.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const PORT = 5433;
const dataDir = path.join(__dirname, '..', '..', '.pgdata');
const sql = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', name), 'utf8');

async function main() {
  const db = await PGlite.create(dataDir);

  // First start: create the tables and load the sample data.
  const { rows } = await db.query("SELECT to_regclass('public.users') AS users");
  if (!rows[0].users) {
    await db.exec(sql('schema.sql'));
    await db.exec(sql('seed.sql'));
    console.log('Created the tables and loaded the seed data');
  }

  // A few connections, so "npm run db:reset" can get in while the server holds its one connection.
  const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 4 });
  await server.start();
  console.log(`Local database ready: postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log('Leave this window open. Press Ctrl+C to stop.');

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is in use. Is the local database already running?` : err);
  process.exit(1);
});
