-- An Item ID belongs to a dish that is on the menu. A deleted dish no longer holds its Item ID, so a
-- menu file imported again after its dishes were deleted brings them back instead of failing, and
-- the dish form may give a new dish the Item ID of a deleted one. (Category IDs already work this way.)
DROP INDEX IF EXISTS menu_items_code_key;
CREATE UNIQUE INDEX menu_items_code_key ON menu_items (restaurant_id, upper(code)) WHERE deleted_at IS NULL;
