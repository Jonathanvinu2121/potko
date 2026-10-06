// Database setup without needing psql.
//   npm run db:schema           tables only, no demo data: for a real restaurant (then: npm run restaurant:add)
//   npm run db:setup            run sql/schema.sql then sql/seed.sql on an empty database (demo data and demo logins)
//   npm run db:reset -- --yes   DELETE EVERYTHING in the database, then set it up again
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'sql', name), 'utf8');

async function main() {
  const command = process.argv[2];
  if (!['schema', 'setup', 'reset'].includes(command)) {
    console.error('Usage: node src/scripts/db.js schema | setup | reset --yes');
    process.exit(1);
  }
  const host = new URL(process.env.DATABASE_URL).host;

  if (command === 'reset') {
    if (!process.argv.includes('--yes')) {
      console.error(`This deletes every table and all data on ${host}.\nRun again with: npm run db:reset -- --yes`);
      process.exit(1);
    }
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log(`Emptied the database on ${host}`);
  }

  await pool.query(sql('schema.sql'));
  if (command === 'schema') {
    console.log(`Empty tables created on ${host}. Now add your restaurant: npm run restaurant:add -- "Name" "Admin name" "A-101" "password" 1234`);
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
