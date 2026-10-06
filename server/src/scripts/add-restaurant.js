// Adds another restaurant with its first admin, who then sets up everything else in the app
// (tables, menu, staff) from the admin screens.
//
//   npm run restaurant:add -- "Street Feast Mall Road" "Priya" "A-201" "a-strong-password" 4321
//                              restaurant name         admin   Staff ID  password           approval PIN (optional)
require('dotenv').config({ quiet: true });

const bcrypt = require('bcryptjs');
const { pool } = require('../db');

async function main() {
  const [restaurantName, adminName, loginId, password, pin] = process.argv.slice(2);
  if (!restaurantName || !adminName || !loginId || !password) {
    console.error('Usage: npm run restaurant:add -- "<restaurant name>" "<admin name>" "<staff id>" "<password>" [pin]');
    process.exit(1);
  }
  if (password.length < 6) throw new Error('The password needs at least 6 characters');
  if (pin && !/^\d{4,6}$/.test(pin)) throw new Error('The PIN must be 4 to 6 digits');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const restaurant = await client.query('INSERT INTO restaurants (name) VALUES ($1) RETURNING id', [restaurantName]);
    await client.query(
      `INSERT INTO users (restaurant_id, name, login_id, password_hash, pin_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [restaurant.rows[0].id, adminName, loginId, await bcrypt.hash(password, 10), pin ? await bcrypt.hash(pin, 10) : null]
    );
    await client.query('COMMIT');
    console.log(`Added "${restaurantName}". ${adminName} can now sign in as Admin with the Staff ID ${loginId}.`);
    console.log('Next, in the app: add tables (Tables), categories and dishes (Menu), and people (Staff).');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err.code === '23505' ? new Error(`The Staff ID ${loginId} is already used. Staff IDs are unique across all restaurants.`) : err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
