const { Pool, types } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.');
  process.exit(1);
}

// Money columns are numeric(10,2); pg returns numeric as a string by default.
types.setTypeParser(1700, parseFloat);

// Neon needs TLS, a Postgres on this machine does not.
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
// The local database (npm run db:local) is single-connection, so the pool is kept to one there.
const pool = new Pool({ connectionString, ssl: local ? false : true, max: local ? 1 : 5 });

// Neon drops idle connections when it sleeps; without this handler that would crash the server.
pool.on('error', (err) => console.error('Idle database connection lost:', err.message));

const query = (text, params) => pool.query(text, params);

// Runs fn inside one transaction: everything is saved, or nothing is.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
