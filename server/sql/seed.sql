-- POTKO seed data: 1 restaurant, 5 users, 6 tables, 6 categories, 25 menu items.
--
-- TEST LOGINS (change before a real restaurant uses this):
--   Admin    A-101      Manager  M-102      Chef  C-103
--   Waiter   W-104 (Maya)          Waiter   W-105 (Amit)
--   Password for all five: potko123
--   Approval PIN for the admin and the manager: 1234

INSERT INTO restaurants (id, name) VALUES (1, 'POTKO · Downtown');
SELECT setval(pg_get_serial_sequence('restaurants', 'id'), 1);

INSERT INTO users (restaurant_id, name, login_id, role, password_hash, pin_hash) VALUES
  (1, 'Anita',  'A-101', 'admin',   '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', '$2b$10$kp8uW8MqaKO4Prp3wYDaau7S1T9SSLOmGxHQPC4IXDyuPn03cY6t.'),
  (1, 'Rohan',  'M-102', 'manager', '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', '$2b$10$kp8uW8MqaKO4Prp3wYDaau7S1T9SSLOmGxHQPC4IXDyuPn03cY6t.'),
  (1, 'Sanjay', 'C-103', 'chef',    '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Maya',   'W-104', 'waiter',  '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL),
  (1, 'Amit',   'W-105', 'waiter',  '$2b$10$IWmWzAS0Txvy0SwacBPKr.Ku6AWexHytqCfILfQB/XJfvMJCXXrB.', NULL);

INSERT INTO tables (restaurant_id, label, seats) VALUES
  (1, 'T1', 4), (1, 'T2', 2), (1, 'T3', 6), (1, 'T4', 4), (1, 'T5', 4), (1, 'T6', 2);

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
