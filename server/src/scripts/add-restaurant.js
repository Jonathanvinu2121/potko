// Adds another restaurant with its first admin, who then sets up everything else in the app
// (tables, menu, staff) from the admin screens.
//
//   npm run restaurant:add -- "Street Feast Mall Road" "Priya" "A-201" "a-strong-password" 4321
//                              restaurant name         admin   Staff ID  password           approval PIN (optional)
require('dotenv').config({ quiet: true });

const { pool } = require('../db');
const { createRestaurant } = require('../restaurants');

async function main() {
  const [restaurantName, adminName, loginId, password, pin] = process.argv.slice(2);
  if (!restaurantName || !adminName || !loginId || !password) {
    console.error('Usage: npm run restaurant:add -- "<restaurant name>" "<admin name>" "<staff id>" "<password>" [pin]');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The restaurant, its admin, and one floor, dining area and kitchen terminal to start with.
    await createRestaurant(client, { restaurantName, adminName, loginId, password, pin });
    await client.query('COMMIT');
    console.log(`Added "${restaurantName}". ${adminName} can now sign in as Admin with the Staff ID ${loginId}.`);
    console.log('Next, in the app under More: add dining areas and tables (Tables), categories and dishes (Menu), and people (Staff).');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err.code === '23505' || err.code === 'login_taken' ? new Error(`The Staff ID ${loginId} is already used. Staff IDs are unique across all restaurants.`) : err;
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
