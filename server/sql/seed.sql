-- POTKO seed data: 1 restaurant, 7 users, 3 floors, 4 dining areas, 20 tables, 4 kitchen terminals,
-- 6 categories, 25 menu items. Runs after sql/schema.sql and the migrations.
--
-- TEST LOGINS (change before a real restaurant uses this):
--   Admin    A-101      Manager  M-102      Chef  C-103
--   Waiter   W-104 (Maya)          Waiter   W-105 (Amit)
--   Cashier  K-106 (Neha)          Chef     C-107 (Vikram, Tandoor only)
--   Password for all of them: potko123
--   Approval PIN for the admin and the manager: 1234

INSERT INTO restaurants (id, name) VALUES (1, 'POTKO · Downtown');
SELECT setval(pg_get_serial_sequence('restaurants', 'id'), 1);

INSERT INTO users (restaurant_id, name, login_id, role, password_hash, pin_hash) VALUES
  (1, 'Anita',  'A-101', 'admin',   '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', '$2b$10$kp8uW8MqaKO4Prp3wYDaau7S1T9SSLOmGxHQPC4IXDyuPn03cY6t.'),
  (1, 'Rohan',  'M-102', 'manager', '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', '$2b$10$kp8uW8MqaKO4Prp3wYDaau7S1T9SSLOmGxHQPC4IXDyuPn03cY6t.'),
  (1, 'Sanjay', 'C-103', 'chef',    '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Maya',   'W-104', 'waiter',  '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Amit',   'W-105', 'waiter',  '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Neha',   'K-106', 'cashier', '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Vikram', 'C-107', 'chef',    '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL);

-- The restaurant's details (printed on bills) and how it bills. GSTIN is left for the restaurant to fill in.
UPDATE restaurants
   SET profile = '{"address": "123 Main Road, Downtown", "phone": "+91 98765 43210", "email": "", "gstin": "", "footer": "Thank you. Visit again!"}'
 WHERE id = 1;

-- Floors, and the dining areas on each.
INSERT INTO floors (id, restaurant_id, name, sort) VALUES
  (1, 1, 'Ground Floor', 1),
  (2, 1, 'First Floor',  2),
  (3, 1, 'Rooftop',      3);
SELECT setval(pg_get_serial_sequence('floors', 'id'), 3);

INSERT INTO dining_areas (id, restaurant_id, floor_id, name, kind, description, sort) VALUES
  (1, 1, 1, 'Main Hall',      'indoor',  'Main dining hall', 1),
  (2, 1, 2, 'Family Hall',    'indoor',  'Family dining',    2),
  (3, 1, 3, 'Open Air',       'outdoor', 'Open air dining',  3),
  (4, 1, 1, 'Private Dining', 'private', 'Event hall',       4);
SELECT setval(pg_get_serial_sequence('dining_areas', 'id'), 4);

-- Tables, with a place on each area's layout (0..1 across and down).
INSERT INTO tables (restaurant_id, label, seats, area_id, kind, shape, sort, pos_x, pos_y) VALUES
  (1, 'T1',  4, 1, 'normal', 'square',    1, 0.18, 0.14), (1, 'T2',  2, 1, 'normal', 'round',     2, 0.50, 0.14),
  (1, 'T3',  6, 1, 'vip',    'rectangle', 3, 0.82, 0.14), (1, 'T4',  4, 1, 'normal', 'square',    4, 0.18, 0.40),
  (1, 'T5',  4, 1, 'booth',  'round',     5, 0.50, 0.40), (1, 'T6',  2, 1, 'normal', 'square',    6, 0.82, 0.40),
  (1, 'T7',  4, 1, 'normal', 'round',     7, 0.18, 0.66), (1, 'T8',  2, 1, 'normal', 'square',    8, 0.50, 0.66),
  (1, 'T9',  6, 1, 'normal', 'round',     9, 0.82, 0.66), (1, 'T10', 4, 1, 'normal', 'square',   10, 0.50, 0.88),
  (1, 'T11', 4, 2, 'normal', 'square',   11, 0.20, 0.20), (1, 'T12', 4, 2, 'normal', 'square',   12, 0.50, 0.20),
  (1, 'T13', 6, 2, 'normal', 'rectangle',13, 0.80, 0.20), (1, 'T14', 2, 2, 'normal', 'round',    14, 0.20, 0.60),
  (1, 'T15', 2, 2, 'normal', 'round',    15, 0.50, 0.60), (1, 'T16', 8, 2, 'booth',  'rectangle',16, 0.80, 0.60),
  (1, 'R1',  4, 3, 'outdoor','round',    17, 0.25, 0.30), (1, 'R2',  4, 3, 'outdoor','round',    18, 0.75, 0.30),
  (1, 'R3',  6, 3, 'outdoor','rectangle',19, 0.50, 0.70), (1, 'P1', 12, 4, 'vip',    'rectangle',20, 0.50, 0.50);

-- Kitchen terminals: each dish is sent to one of these, and a chef sees only the terminals they work at.
INSERT INTO kitchen_terminals (id, restaurant_id, name, is_default, sort) VALUES
  (1, 1, 'Main Kitchen',   true,  1),
  (2, 1, 'Tandoor',        false, 2),
  (3, 1, 'Bar & Drinks',   false, 3),
  (4, 1, 'Dessert Counter', false, 4);
SELECT setval(pg_get_serial_sequence('kitchen_terminals', 'id'), 4);

-- Sanjay runs every terminal; Vikram only the tandoor.
INSERT INTO user_terminals (user_id, terminal_id)
SELECT u.id, k.id FROM users u, kitchen_terminals k WHERE u.login_id = 'C-103';
INSERT INTO user_terminals (user_id, terminal_id)
SELECT u.id, 2 FROM users u WHERE u.login_id = 'C-107';

-- Maya works the Ground Floor and the Rooftop; Amit works everywhere but sends bills to the manager.
UPDATE users SET access = '{"areas": {"1": {"mode": "all"}, "3": {"mode": "all"}}}' WHERE login_id = 'W-104';
UPDATE users SET can_collect_payment = false, payment_access = 'close' WHERE login_id = 'W-105';
UPDATE users SET discount_limit_pct = 10 WHERE login_id = 'K-106';

INSERT INTO categories (id, restaurant_id, name, prefix, sort) VALUES
  (1, 1, 'Starters',           'STR', 1),
  (2, 1, 'Indian Main Course', 'IMC', 2),
  (3, 1, 'Breads',             'BRD', 3),
  (4, 1, 'Rice & Biryani',     'RIC', 4),
  (5, 1, 'Drinks',             'DRK', 5),
  (6, 1, 'Desserts',           'DES', 6);
SELECT setval(pg_get_serial_sequence('categories', 'id'), 6);

INSERT INTO menu_items (restaurant_id, category_id, code, name, veg, sizes, price, customisations, order_count) VALUES
  -- Starters
  (1, 1, 'STR01', 'Veg Spring Roll',      true,  '[]', 140, '{More spicy,Less oil,No onion}', 34),
  (1, 1, 'STR02', 'Hara Bhara Kebab',     true,  '[]', 160, '{More spicy,Less salt,Extra chutney}', 28),
  (1, 1, 'STR03', 'Chicken 65',           false, '[{"label":"Half","price":130},{"label":"Full","price":220}]', 220, '{More spicy,Less spicy,No onion}', 61),
  (1, 1, 'STR04', 'Fish Amritsari',       false, '[]', 260, '{More spicy,Less salt,Extra chutney}', 19),
  -- Indian Main Course
  (1, 2, 'IMC11', 'Butter Chicken',       false, '[{"label":"Half","price":220},{"label":"Full","price":360}]', 360, '{More spicy,Less spicy,Less salt,Extra creamy,No onion}', 142),
  (1, 2, 'IMC12', 'Chicken Curry',        false, '[{"label":"Half","price":220},{"label":"Medium","price":280},{"label":"Full","price":320}]', 320, '{More spicy,Less spicy,Less salt,No onion,Extra gravy}', 88),
  (1, 2, 'IMC13', 'Dal Makhani',          true,  '[{"label":"Half","price":150},{"label":"Full","price":240}]', 240, '{More spicy,Less salt,Extra creamy,No onion}', 97),
  (1, 2, 'IMC14', 'Chicken Tikka',        false, '[{"label":"Half","price":180},{"label":"Full","price":320}]', 320, '{More spicy,Less spicy,No onion,Extra chutney}', 110),
  (1, 2, 'IMC15', 'Paneer Tikka',         true,  '[{"label":"Half","price":160},{"label":"Full","price":280}]', 280, '{More spicy,Less spicy,No onion,Extra chutney}', 104),
  (1, 2, 'IMC16', 'Paneer Butter Masala', true,  '[{"label":"Half","price":170},{"label":"Full","price":290}]', 290, '{More spicy,Less spicy,Less salt,Extra creamy,No onion}', 76),
  (1, 2, 'IMC17', 'Kadai Paneer',         true,  '[{"label":"Half","price":170},{"label":"Full","price":290}]', 290, '{More spicy,Less spicy,Less salt,No onion,Extra gravy}', 41),
  -- Breads
  (1, 3, 'BRD01', 'Tandoori Roti',        true,  '[]', 20,  '{Extra butter,No butter,Well done}', 131),
  (1, 3, 'BRD02', 'Butter Naan',          true,  '[]', 50,  '{Extra butter,Less butter,Well done}', 156),
  (1, 3, 'BRD03', 'Garlic Naan',          true,  '[]', 60,  '{Extra butter,Less garlic,Well done}', 83),
  (1, 3, 'BRD04', 'Lachha Paratha',       true,  '[]', 45,  '{Extra butter,No butter,Well done}', 37),
  -- Rice & Biryani
  (1, 4, 'RIC01', 'Jeera Rice',           true,  '[{"label":"Half","price":70},{"label":"Full","price":110}]', 110, '{Less salt,Extra jeera}', 92),
  (1, 4, 'RIC02', 'Veg Biryani',          true,  '[{"label":"Half","price":150},{"label":"Full","price":240}]', 240, '{More spicy,Mild spice,No onion}', 58),
  (1, 4, 'RIC03', 'Chicken Biryani',      false, '[{"label":"Half","price":190},{"label":"Full","price":300}]', 300, '{More spicy,Mild spice,No onion}', 101),
  (1, 4, 'RIC04', 'Steamed Rice',         true,  '[]', 90,  '{}', 22),
  -- Drinks
  (1, 5, 'DRK01', 'Lime Soda',            true,  '[]', 70,  '{No ice,Less sugar,Salted}', 118),
  (1, 5, 'DRK02', 'Lime Cooler',          true,  '[]', 80,  '{No ice,Less sugar,Extra lime}', 64),
  (1, 5, 'DRK03', 'Masala Chaas',         true,  '[]', 50,  '{No ice,Less salt,More spicy}', 47),
  (1, 5, 'DRK04', 'Sweet Lassi',          true,  '[]', 80,  '{No ice,Less sugar}', 55),
  -- Desserts
  (1, 6, 'DES01', 'Gulab Jamun',          true,  '[]', 80,  '{Served warm}', 49),
  (1, 6, 'DES02', 'Rasmalai',             true,  '[]', 110, '{}', 31);

-- "Goes well with": curries suggest breads and rice, tikkas and biryanis suggest drinks.
INSERT INTO addon_links (item_id, suggested_item_id)
SELECT m.id, s.id FROM menu_items m, menu_items s
WHERE m.code IN ('IMC11', 'IMC12', 'IMC13', 'IMC16', 'IMC17') AND s.code IN ('BRD01', 'BRD02', 'RIC01');

INSERT INTO addon_links (item_id, suggested_item_id)
SELECT m.id, s.id FROM menu_items m, menu_items s
WHERE m.code IN ('IMC14', 'IMC15', 'STR03') AND s.code IN ('BRD02', 'DRK01');

INSERT INTO addon_links (item_id, suggested_item_id)
SELECT m.id, s.id FROM menu_items m, menu_items s
WHERE m.code IN ('RIC02', 'RIC03') AND s.code IN ('DRK03', 'DRK04');

-- Where each dish is cooked. Anything not listed goes to the default terminal (Main Kitchen).
UPDATE menu_items SET terminal_id = 2 WHERE code IN ('IMC14', 'IMC15', 'STR02', 'BRD01', 'BRD02', 'BRD03', 'BRD04');
UPDATE menu_items SET terminal_id = 3 WHERE code LIKE 'DRK%';
UPDATE menu_items SET terminal_id = 4 WHERE code LIKE 'DES%';
UPDATE menu_items SET terminal_ids = ARRAY[terminal_id] WHERE terminal_id IS NOT NULL;
UPDATE menu_items SET sort = id;

-- Priced add-ons and descriptions on a few dishes.
UPDATE menu_items SET description = 'Tender chicken in a creamy tomato gravy',
       modifier_groups = '[{"name": "Add Ons", "required": false, "min": 0, "max": 0, "options": [{"name": "Extra Butter", "price": 20}, {"name": "Extra Gravy", "price": 40}]}]'
 WHERE code = 'IMC11';
UPDATE menu_items SET description = 'Cottage cheese grilled in the tandoor',
       modifier_groups = '[{"name": "Add Ons", "required": false, "min": 0, "max": 0, "options": [{"name": "Extra Cheese", "price": 30}, {"name": "Mint Chutney", "price": 10}]}]'
 WHERE code = 'IMC15';
UPDATE menu_items SET description = 'Long-grain rice layered with spiced chicken',
       modifier_groups = '[{"name": "Served with", "required": true, "min": 1, "max": 1, "options": [{"name": "Raita", "price": 0}, {"name": "Salan", "price": 0}]}, {"name": "Add Ons", "required": false, "min": 0, "max": 0, "options": [{"name": "Boiled Egg", "price": 20}]}]'
 WHERE code = 'RIC03';
UPDATE menu_items SET description = 'Fresh lime with soda' WHERE code = 'DRK01';
