// Database setup without needing psql.
//   npm run db:schema           tables only, no demo data: for a real restaurant (then: npm run restaurant:add)
//   npm run db:setup            tables plus demo data and demo logins, on an empty database
//   npm run db:migrate          bring an existing database up to date (the server also does this each time it starts)
//   npm run db:reset -- --yes   DELETE EVERYTHING in the database, then set it up again with demo data
//   npm run db:clear -- --yes   DELETE EVERYTHING, then empty tables only: a server ready for a client's
//                               first-run set-up in the app (needs SETUP_CODE on the server)
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { migratePool } = require('../migrate');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', name), 'utf8');

async function main() {
  const command = process.argv[2];
  if (!['schema', 'setup', 'reset', 'clear', 'migrate'].includes(command)) {
    console.error('Usage: node src/scripts/db.js schema | setup | migrate | reset --yes | clear --yes');
    process.exit(1);
  }
  const host = new URL(process.env.DATABASE_URL).host;

  if (command === 'reset' || command === 'clear') {
    if (!process.argv.includes('--yes')) {
      console.error(`This deletes every table and all data on ${host}.\nRun again with: npm run db:reset -- --yes`);
      process.exit(1);
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log(`Emptied the database on ${host}`);
  }

  if (command === 'migrate') {
    const applied = await migratePool(pool, (line) => console.log(line));
    console.log(applied === null ? `The database on ${host} is empty. Run "npm run db:setup" or "npm run db:schema" first.` : applied.length ? `Database on ${host} is up to date` : `Nothing to do: the database on ${host} was already up to date`);
    return;
  }

  // Version 1 tables first, then every change made since (sql/migrations).
  await pool.query(sql('schema.sql'));
  await migratePool(pool);
  if (command === 'schema' || command === 'clear') {
    console.log(`Empty tables created on ${host}. The first person to open the app sets up the restaurant (with the setup code), or add it here: npm run restaurant:add -- "Name" "Admin name" "A-101" "password" 1234`);
    return;
  }
  await pool.query(sql('seed.sql'));
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM tables) AS tables,
            (SELECT count(*) FROM menu_items) AS items`
  );
  console.log(`Database ready on ${host}: ${rows[0].users} users, ${rows[0].tables} tables, ${rows[0].items} menu items`);
  console.log('Test logins are listed at the top of sql/seed.sql');
}

main()
  .catch((err) => {
    console.error(err.code === '42P07' ? 'Tables already exist. Use "npm run db:reset -- --yes" to start again.' : err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
