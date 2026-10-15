// Creating a restaurant with its first admin. Used by the first-run set-up in the app
// (POST /auth/setup) and by `npm run restaurant:add`, so both start a restaurant the same way.
const bcrypt = require('bcryptjs');
const { AppError } = require('./errors');

const bad = (message) => new AppError(400, 'bad_input', message);

// Checks what a person typed; returns it tidied, or throws with a message for the screen.
function readNewRestaurant(input) {
  const restaurantName = String(input.restaurantName ?? '').trim().slice(0, 80);
  const adminName = String(input.adminName ?? '').trim().slice(0, 60);
  const loginId = String(input.loginId ?? '').trim();
  const password = String(input.password ?? '');
  const pin = input.pin === undefined || input.pin === null || input.pin === '' ? null : String(input.pin).trim();
  if (restaurantName.length < 2) throw bad('Enter the restaurant name');
  if (adminName.length < 2) throw bad('Enter your name');
  if (!/^[A-Za-z0-9._@+-]{3,60}$/.test(loginId)) throw bad('A Staff ID is 3 to 60 letters, digits, dots or dashes. An email address works too.');
  if (password.length < 6) throw bad('The password needs at least 6 characters');
  if (pin !== null && !/^\d{4}$/.test(pin)) throw bad('The approval PIN is 4 digits');
  return { restaurantName, adminName, loginId, password, pin };
}

// Inside a transaction: the restaurant, its admin, and the one floor, dining area and kitchen
// terminal every restaurant starts with (more are added in the app). Returns { restaurantId, userId }.
async function createRestaurant(client, input) {
  const r = readNewRestaurant(input);
  const taken = await client.query('SELECT 1 FROM users WHERE lower(login_id) = lower($1)', [r.loginId]);
  if (taken.rows[0]) throw new AppError(409, 'login_taken', `The Staff ID ${r.loginId} is already used. Choose another.`);
  const restaurant = await client.query('INSERT INTO restaurants (name) VALUES ($1) RETURNING id', [r.restaurantName]);
  const restaurantId = restaurant.rows[0].id;
  const user = await client.query(
    `INSERT INTO users (restaurant_id, name, login_id, password_hash, pin_hash, role)
     VALUES ($1, $2, $3, $4, $5, 'admin') RETURNING id`,
    [restaurantId, r.adminName, r.loginId, await bcrypt.hash(r.password, 10), r.pin ? await bcrypt.hash(r.pin, 10) : null]
  );
  const floor = await client.query(`INSERT INTO floors (restaurant_id, name, sort) VALUES ($1, 'Ground Floor', 1) RETURNING id`, [restaurantId]);
  await client.query(`INSERT INTO dining_areas (restaurant_id, floor_id, name, kind, description, sort) VALUES ($1, $2, 'Main Hall', 'indoor', 'Main dining hall', 1)`, [restaurantId, floor.rows[0].id]);
  await client.query(`INSERT INTO kitchen_terminals (restaurant_id, name, is_default, sort) VALUES ($1, 'Main Kitchen', true, 1)`, [restaurantId]);
  return { restaurantId, userId: user.rows[0].id, ...r };
}

module.exports = { createRestaurant, readNewRestaurant };
