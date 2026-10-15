-- 004: the "finals" design (2026-10-14). Additive only.

-- A dish can be shown at several kitchen terminals. menu_items.terminal_id stays the first of
-- them (its KOT is numbered there); terminal_ids holds all of them. Empty = the default terminal.
ALTER TABLE menu_items ADD COLUMN terminal_ids int[] NOT NULL DEFAULT '{}';
UPDATE menu_items SET terminal_ids = ARRAY[terminal_id] WHERE terminal_id IS NOT NULL;

-- Every terminal that shows this dish, copied when the dish is sent (so a later menu change never
-- moves a ticket that is already in a kitchen).
ALTER TABLE order_items ADD COLUMN terminal_ids int[] NOT NULL DEFAULT '{}';
UPDATE order_items SET terminal_ids = ARRAY[terminal_id] WHERE terminal_id IS NOT NULL;
CREATE INDEX order_items_terminal_ids_idx ON order_items USING gin (terminal_ids);

-- "Open Price": the dish has no fixed price; the price is typed in when it is ordered.
ALTER TABLE menu_items ADD COLUMN open_price boolean NOT NULL DEFAULT false;

-- A waiter's payment permission has three levels:
--   take   generates the bill and takes the payment
--   close  closes the table; the payment is handled by a manager or cashier
--   none   can neither close the table nor take payments
ALTER TABLE users ADD COLUMN payment_access text NOT NULL DEFAULT 'take' CHECK (payment_access IN ('take', 'close', 'none'));
UPDATE users SET payment_access = CASE WHEN can_collect_payment THEN 'take' ELSE 'close' END;
