-- Category ID: the restaurant's own code for a category (e.g. CAT-001), as in the menu import
-- file. Optional; when given it is unique in the restaurant and a re-imported file matches by it.
ALTER TABLE categories ADD COLUMN code text;
CREATE UNIQUE INDEX categories_code_key ON categories (restaurant_id, upper(code)) WHERE code IS NOT NULL AND deleted_at IS NULL;
