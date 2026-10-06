-- POTKO schema (PostgreSQL). Run once on an empty database, then run seed.sql.
-- Money is numeric(10,2). Every table that holds restaurant data carries restaurant_id.

CREATE TABLE restaurants (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  -- payment_at: 'waiter' | 'counter'.  otp_roles: roles that need a one-time code at login.
  settings          jsonb NOT NULL DEFAULT '{"payment_at": "waiter", "otp_roles": []}',
  next_order_number int NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id                 serial PRIMARY KEY,
  restaurant_id      int NOT NULL REFERENCES restaurants(id),
  name               text NOT NULL,
  login_id           text NOT NULL,
  password_hash      text NOT NULL,
  pin_hash           text,                       -- manager/admin approval PIN
  role               text NOT NULL CHECK (role IN ('admin', 'manager', 'chef', 'waiter')),
  discount_limit_pct numeric(5,2) NOT NULL DEFAULT 3,
  active             boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX users_login_id_key ON users (lower(login_id));

-- One-time login codes made in the manager/admin app (no SMS).
CREATE TABLE login_otps (
  user_id    int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE tables (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  label         text NOT NULL,
  seats         int NOT NULL DEFAULT 4,
  status        text NOT NULL DEFAULT 'free' CHECK (status IN
                  ('free', 'occupied', 'order_placed', 'preparing', 'ready', 'all_delivered', 'needs_payment')),
  locked_by     int REFERENCES users(id),
  locked_at     timestamptz,
  UNIQUE (restaurant_id, label)
);

CREATE TABLE categories (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name          text NOT NULL,
  prefix        text NOT NULL,                   -- e.g. 'IMC' for Indian Main Course
  sort          int NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, prefix)
);

CREATE TABLE menu_items (
  id             serial PRIMARY KEY,
  restaurant_id  int NOT NULL REFERENCES restaurants(id),
  category_id    int NOT NULL REFERENCES categories(id),
  code           text NOT NULL,                  -- category prefix + serial, e.g. 'IMC14'
  name           text NOT NULL,
  veg            boolean NOT NULL DEFAULT true,
  sizes          jsonb NOT NULL DEFAULT '[]',    -- [{"label": "Half", "price": 180}, ...]; empty = one size
  price          numeric(10,2) NOT NULL,         -- price when there are no sizes
  customisations text[] NOT NULL DEFAULT '{}',   -- chips offered on the item sheet
  available      boolean NOT NULL DEFAULT true,
  order_count    int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX menu_items_code_key ON menu_items (restaurant_id, upper(code));

-- "Goes well with"
CREATE TABLE addon_links (
  item_id           int NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  suggested_item_id int NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, suggested_item_id)
);

CREATE TABLE orders (
  id               serial PRIMARY KEY,
  restaurant_id    int NOT NULL REFERENCES restaurants(id),
  number           int NOT NULL,
  client_id        text UNIQUE,                  -- made by the app; a double tap cannot create two orders
  type             text NOT NULL CHECK (type IN ('dine_in', 'delivery', 'takeaway')),
  table_id         int REFERENCES tables(id),
  guests           int,
  customer_name    text,
  customer_phone   text,
  delivery_address text,
  car_number       text,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN
                     ('new', 'accepted', 'preparing', 'partly_ready', 'ready', 'delivered', 'closed', 'cancelled')),
  waiter_id        int NOT NULL REFERENCES users(id),
  prep_minutes     int,
  discount_pct     numeric(5,2) NOT NULL DEFAULT 0,
  discount_amount  numeric(10,2) NOT NULL DEFAULT 0,
  subtotal         numeric(10,2) NOT NULL DEFAULT 0,
  total            numeric(10,2) NOT NULL DEFAULT 0,
  payment_method   text CHECK (payment_method IN ('cash', 'upi', 'card')),
  at_counter       boolean NOT NULL DEFAULT false,  -- sent to the manager counter for payment
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  UNIQUE (restaurant_id, number),
  CHECK (type <> 'dine_in' OR table_id IS NOT NULL),
  CHECK (type <> 'delivery' OR customer_name IS NOT NULL),
  CHECK (type <> 'takeaway' OR customer_name IS NOT NULL OR car_number IS NOT NULL)
);
CREATE INDEX orders_restaurant_status_idx ON orders (restaurant_id, status);

CREATE TABLE order_items (
  id                 serial PRIMARY KEY,
  order_id           int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id       int NOT NULL REFERENCES menu_items(id),
  name_snapshot      text NOT NULL,              -- name and price are copied so menu edits never change old bills
  veg                boolean NOT NULL DEFAULT true,
  size               text,
  qty                int NOT NULL CHECK (qty > 0),
  unit_price         numeric(10,2) NOT NULL,
  customisations     text[] NOT NULL DEFAULT '{}',
  note               text,
  allergy_note       text,
  status             text NOT NULL DEFAULT 'sent' CHECK (status IN
                       ('sent', 'accepted', 'preparing', 'ready', 'delivered', 'unavailable', 'removed', 'cancelled')),
  unavailable_reason text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE approvals (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  order_id      int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id int REFERENCES order_items(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('discount', 'cancel')),
  requested_by  int NOT NULL REFERENCES users(id),
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by    int REFERENCES users(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_restaurant_status_idx ON approvals (restaurant_id, status);

CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  user_id       int REFERENCES users(id),
  action        text NOT NULL,
  entity        text NOT NULL,
  entity_id     int,
  old           jsonb,
  new           jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_restaurant_at_idx ON audit_logs (restaurant_id, at DESC);
