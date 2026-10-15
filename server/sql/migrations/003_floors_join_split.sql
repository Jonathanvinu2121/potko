-- 003: floors above dining areas, tables joined for one party, and split parts that can stand free.
-- Additive only: nothing that existing orders, bills or logins rely on is removed or rewritten.

-- ---------- Floors ----------
-- A restaurant has floors (Ground Floor, First Floor); each floor has dining areas (Main Hall, Garden).
CREATE TABLE floors (
  id            serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  sort          int NOT NULL DEFAULT 0,
  deleted_at    timestamptz                              -- a deleted floor stays as a name on old records
);
CREATE UNIQUE INDEX floors_name_key ON floors (restaurant_id, lower(name)) WHERE deleted_at IS NULL;

-- Every existing restaurant gets one floor holding the areas it already has.
INSERT INTO floors (restaurant_id, name, sort)
SELECT id, 'Ground Floor', 1 FROM restaurants;

ALTER TABLE dining_areas ADD COLUMN floor_id int REFERENCES floors(id);
UPDATE dining_areas a SET floor_id = f.id FROM floors f WHERE f.restaurant_id = a.restaurant_id;
ALTER TABLE dining_areas ALTER COLUMN floor_id SET NOT NULL;

-- The same area name may be used on two floors (an "AC Hall" on each).
DROP INDEX dining_areas_name_key;
CREATE UNIQUE INDEX dining_areas_name_key ON dining_areas (restaurant_id, floor_id, lower(name)) WHERE deleted_at IS NULL;

-- The area migration 002 gave every restaurant carried the floor's name. It is now a hall on that floor.
UPDATE dining_areas a SET name = 'Main Hall'
 WHERE a.name = 'Ground Floor' AND a.description = 'Main dining hall' AND a.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM dining_areas o WHERE o.restaurant_id = a.restaurant_id AND lower(o.name) = 'main hall' AND o.deleted_at IS NULL);

-- ---------- Tables ----------
-- Joined tables: T4 pushed up against T3 for one big party points at T3. The order and the bill
-- stay on T3; T4 is given back when that order closes.
ALTER TABLE tables ADD COLUMN joined_to_id int REFERENCES tables(id);
CREATE INDEX tables_joined_to_idx ON tables (joined_to_id) WHERE joined_to_id IS NOT NULL;

-- A split part (T4.2) can now stand free, waiting for another party. Parts are put away together,
-- when the last party at the table has left or the parts are merged back.
