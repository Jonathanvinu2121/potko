// Runs one SQL statement against the database in .env and prints the rows. A development helper.
//   node src/scripts/sql.js "SELECT count(*) FROM orders"
require('dotenv').config({ quiet: true });

const { pool } = require('../db');

pool
  .query(process.argv[2])
  .then((result) => {
    const results = Array.isArray(result) ? result : [result];
    for (const r of results) console.log(r.rows?.length ? JSON.stringify(r.rows, null, 1) : `${r.command} ${r.rowCount ?? ''}`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
