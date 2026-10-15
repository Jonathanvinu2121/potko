-- 002: the POS + KOT manager specification.
-- Dining areas, kitchen terminals and KOTs, tax and payments, staff access and sessions,
-- menu add-ons, imports, images, and a fuller audit record.
-- Additive only: nothing that existing orders, bills or logins rely on is removed or rewritten.

-- ---------- Restaurant ----------
ALTER TABLE restaurants
  ADD COLUMN profile jsonb NOT NULL DEFAULT '{}',       -- address, phone, email, gstin, logo_image_id
  ADD COLUMN next_kot_number int NOT NULL DEFAULT 1;

-- ---------- Pictures (menu items, areas, staff, logo) ----------
-- Small, already-compressed pictures kept in the database, so a free host with no disk still works.
CREATE TABLE images (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  mime          text NOT NULL,
  data          bytea NOT NULL,
  created_by    int REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Dining areas ----------
CREATE TABLE dining_areas (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'indoor' CHECK (kind IN ('indoor', 'outdoor', 'private', 'bar', 'custom')),
  description   text,
  active        boolean NOT NULL DEFAULT true,
  sort          int NOT NULL DEFAULT 0,
  image_id      int REFERENCES images(id),
  deleted_at    timestamptz                              -- a deleted area stays as a name on old orders
);
CREATE UNIQUE INDEX dining_areas_name_key ON dining_areas (restaurant_id, lower(name)) WHERE deleted_at IS NULL;

-- Every existing restaurant gets one area holding the tables it already has.
INSERT INTO dining_areas (restaurant_id, name, kind, description, sort)
SELECT id, 'Ground Floor', 'indoor', 'Main dining hall', 1 FROM restaurants;

-- ---------- Tables ----------
ALTER TABLE tables
  ADD COLUMN area_id         int REFERENCES dining_areas(id),
  ADD COLUMN kind            text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'vip', 'booth', 'outdoor', 'custom')),
  ADD COLUMN active          boolean NOT NULL DEFAULT true,
  ADD COLUMN shape           text NOT NULL DEFAULT 'square' CHECK (shape IN ('square', 'round', 'rectangle', 'booth')),
  ADD COLUMN size            text NOT NULL DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large')),
  ADD COLUMN pos_x           real,                       -- place on the area's layout, 0..1 of its width
  ADD COLUMN pos_y           real,
  ADD COLUMN sort            int NOT NULL DEFAULT 0,
  ADD COLUMN parent_table_id int REFERENCES tables(id),  -- T4.1 and T4.2 point at T4
  -- Put away: a split child whose bill closed or was merged back, or a table the manager deleted.
  -- The row stays so old orders still show where they were served.
  ADD COLUMN archived        boolean NOT NULL DEFAULT false;

-- A table name must be unique among the tables in use; put-away tables no longer hold their name.
ALTER TABLE tables DROP CONSTRAINT tables_restaurant_id_label_key;
CREATE UNIQUE INDEX tables_label_key ON tables (restaurant_id, lower(label)) WHERE NOT archived;

UPDATE tables t SET area_id = a.id, sort = t.id FROM dining_areas a WHERE a.restaurant_id = t.restaurant_id;
ALTER TABLE tables ALTER COLUMN area_id SET NOT NULL;

-- 'paid'  the bill is settled and the guests are still seated (the table can be closed or transferred)
-- 'split' a parent table while its children (T4.1, T4.2) are in use
ALTER TABLE tables DROP CONSTRAINT tables_status_check;
ALTER TABLE tables ADD CONSTRAINT tables_status_check CHECK (status IN
  ('free', 'occupied', 'order_placed', 'preparing', 'ready', 'all_delivered', 'needs_payment', 'paid', 'split'));

-- ---------- Kitchen terminals ----------
CREATE TABLE kitchen_terminals (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  is_default    boolean NOT NULL DEFAULT false,          -- items with no terminal of their own go here
  sort          int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX kitchen_terminals_name_key ON kitchen_terminals (restaurant_id, lower(name));
-- Only one terminal per restaurant is the default.
CREATE UNIQUE INDEX kitchen_terminals_default_key ON kitchen_terminals (restaurant_id) WHERE is_default;

INSERT INTO kitchen_terminals (restaurant_id, name, is_default, sort)
SELECT id, 'Main Kitchen', true, 1 FROM restaurants;

CREATE TABLE user_terminals (
  user_id     int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_id int NOT NULL REFERENCES kitchen_terminals(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, terminal_id)
);
INSERT INTO user_terminals (user_id, terminal_id)
SELECT u.id, k.id FROM users u JOIN kitchen_terminals k ON k.restaurant_id = u.restaurant_id WHERE u.role = 'chef';

-- ---------- Staff ----------
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'cashier', 'chef', 'waiter'));
ALTER TABLE users
  ADD COLUMN phone               text,
  ADD COLUMN email               text,
  ADD COLUMN permissions         jsonb NOT NULL DEFAULT '{}',  -- changes to the role's preset, e.g. {"reports.view": false}
  ADD COLUMN access              jsonb NOT NULL DEFAULT '{}',  -- waiter: {"areas": {"3": {"mode": "all"}, "4": {"mode": "tables", "tables": [9, 10]}}}; {} = everywhere
  ADD COLUMN can_collect_payment boolean NOT NULL DEFAULT true, -- waiter: take payments, or send the bill to the manager
  ADD COLUMN image_id            int REFERENCES images(id),
  ADD COLUMN created_at          timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_login_at       timestamptz,
  ADD COLUMN deleted_at          timestamptz;                  -- deleted staff stay as a name on old orders and reports

-- One row per sign-in on a device. The login token carries the session id, so a session can be ended from the server.
CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       int NOT NULL REFERENCES users(id),
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  device        text,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  end_reason    text                                     -- 'logout' | 'revoked' | 'credential_reset' | 'deleted'
);
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

-- ---------- Menu ----------
ALTER TABLE categories
  ADD COLUMN description text,
  ADD COLUMN active      boolean NOT NULL DEFAULT true,
  ADD COLUMN image_id    int REFERENCES images(id),
  ADD COLUMN deleted_at  timestamptz;

ALTER TABLE menu_items
  ADD COLUMN description     text,
  ADD COLUMN sort            int NOT NULL DEFAULT 0,
  ADD COLUMN tax_rate        numeric(5,2) CHECK (tax_rate >= 0 AND tax_rate <= 100), -- NULL = the restaurant's rate
  ADD COLUMN tax_mode        text CHECK (tax_mode IN ('inclusive', 'exclusive')),    -- NULL = the restaurant's mode
  ADD COLUMN terminal_id     int REFERENCES kitchen_terminals(id),                   -- NULL = the default terminal
  -- [{"name": "Add Ons", "required": false, "min": 0, "max": 3, "options": [{"name": "Extra Cheese", "price": 30}]}]
  ADD COLUMN modifier_groups jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN image_id        int REFERENCES images(id),
  ADD COLUMN deleted_at      timestamptz;
UPDATE menu_items SET sort = id;

-- ---------- KOTs: one ticket per order, terminal and send ----------
CREATE TABLE kots (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  order_id      int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  terminal_id   int NOT NULL REFERENCES kitchen_terminals(id),
  number        int NOT NULL,
  table_label   text,                                    -- as it was when the ticket was sent
  sent_by       int REFERENCES users(id),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, number)
);
CREATE INDEX kots_order_idx ON kots (order_id);

INSERT INTO kots (restaurant_id, order_id, terminal_id, number, table_label, sent_by, sent_at)
SELECT o.restaurant_id, o.id, k.id, row_number() OVER (PARTITION BY o.restaurant_id ORDER BY o.id), t.label, o.waiter_id, o.created_at
  FROM orders o
  JOIN kitchen_terminals k ON k.restaurant_id = o.restaurant_id AND k.is_default
  LEFT JOIN tables t ON t.id = o.table_id;
UPDATE restaurants r SET next_kot_number = COALESCE((SELECT max(number) FROM kots k WHERE k.restaurant_id = r.id), 0) + 1;

-- ---------- Order lines: tax, add-ons, kitchen routing and timings ----------
-- Old lines keep tax_rate 0: they were sold before tax was configured, and old bills must never change.
ALTER TABLE order_items
  ADD COLUMN tax_rate     numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_mode     text NOT NULL DEFAULT 'exclusive' CHECK (tax_mode IN ('inclusive', 'exclusive')),
  ADD COLUMN addons       jsonb NOT NULL DEFAULT '[]',   -- [{"group": "Add Ons", "name": "Extra Cheese", "price": 30}]; already inside unit_price
  ADD COLUMN terminal_id  int REFERENCES kitchen_terminals(id),
  ADD COLUMN kot_id       int REFERENCES kots(id),
  ADD COLUMN started_at   timestamptz,
  ADD COLUMN ready_at     timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN ready_by     int REFERENCES users(id),
  ADD COLUMN delivered_by int REFERENCES users(id);
UPDATE order_items i SET kot_id = k.id, terminal_id = k.terminal_id FROM kots k WHERE k.order_id = i.order_id;
CREATE INDEX order_items_kot_idx ON order_items (kot_id);

-- ---------- Orders: bill breakdown, bill request, split and merge links ----------
-- 'paid'   settled, table not yet closed      'merged'  folded into another order of the same split table
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('new', 'accepted', 'preparing', 'partly_ready', 'ready', 'delivered', 'paid', 'closed', 'cancelled', 'merged'));
ALTER TABLE orders DROP CONSTRAINT orders_payment_method_check; -- now a summary: one method's name, or 'split'
ALTER TABLE orders
  ADD COLUMN discount_type     text NOT NULL DEFAULT 'pct' CHECK (discount_type IN ('pct', 'amount')),
  ADD COLUMN discount_value    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN discount_reason   text,
  ADD COLUMN discount_by       int REFERENCES users(id),
  ADD COLUMN taxable           numeric(10,2) NOT NULL DEFAULT 0,  -- value the tax is charged on, after discount
  ADD COLUMN tax_total         numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN tax_lines         jsonb NOT NULL DEFAULT '[]',       -- [{"label": "CGST 2.5%", "amount": 40}]
  ADD COLUMN service_charge    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN round_off         numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN split_adjust      numeric(10,2) NOT NULL DEFAULT 0,  -- paise moved so split bills add up to the original
  ADD COLUMN paid_total        numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN bill_requested_at timestamptz,
  ADD COLUMN bill_requested_by int REFERENCES users(id),
  ADD COLUMN settled_by        int REFERENCES users(id),
  ADD COLUMN parent_order_id   int REFERENCES orders(id),         -- the order this one was split from
  ADD COLUMN merged_into_id    int REFERENCES orders(id);

UPDATE orders SET discount_value = discount_pct, taxable = subtotal - discount_amount;
UPDATE orders SET paid_total = total, settled_by = waiter_id WHERE paid_at IS NOT NULL;
UPDATE orders SET bill_requested_at = now(), bill_requested_by = waiter_id WHERE at_counter AND status NOT IN ('closed', 'cancelled');

-- ---------- Payments: several per bill (split tender), and refunds ----------
CREATE TABLE payments (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  order_id      int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
  method        text NOT NULL,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'successful' CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'cancelled')),
  reference     text,                                    -- UPI or card reference, when there is one
  received      numeric(10,2),                           -- cash handed over
  change_due    numeric(10,2),
  note          text,
  client_id     text,                                    -- made by the app: a retry never charges twice
  created_by    int REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, client_id)
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_restaurant_at_idx ON payments (restaurant_id, created_at);

INSERT INTO payments (restaurant_id, order_id, method, amount, created_by, created_at)
SELECT restaurant_id, id, COALESCE(payment_method, 'cash'), total, waiter_id, paid_at
  FROM orders WHERE paid_at IS NOT NULL AND total > 0;

-- ---------- Approvals ----------
ALTER TABLE approvals DROP CONSTRAINT approvals_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_type_check CHECK (type IN ('discount', 'cancel', 'void', 'refund'));

-- ---------- Audit: who (and as what), why, and what it touched. Rows can never be changed. ----------
ALTER TABLE audit_logs
  ADD COLUMN actor_role text,
  ADD COLUMN reason     text,
  ADD COLUMN refs       jsonb;                           -- {"order_id": 12, "table_id": 4, "payment_id": 7}
UPDATE audit_logs l SET actor_role = u.role FROM users u WHERE u.id = l.user_id;

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit records cannot be changed or deleted';
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ---------- Menu imports (CSV / Excel) ----------
-- A checked file waits here between "preview" and "import"; importing the same one twice does nothing new.
CREATE TABLE imports (
  id            text PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  user_id       int NOT NULL REFERENCES users(id),
  kind          text NOT NULL CHECK (kind IN ('categories', 'items')),
  filename      text NOT NULL,
  rows          jsonb NOT NULL,
  mode          text,
  summary       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  committed_at  timestamptz
);
