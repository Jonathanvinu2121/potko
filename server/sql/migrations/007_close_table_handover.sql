-- Close Table by a waiter who does not take payment: the bill goes to the counter, the table is free
-- at once for the next guests, and the order is locked until it is paid. A manager can reopen it on
-- its table while that table is still free (no newer order since the closing).
ALTER TABLE orders ADD COLUMN handed_over_at timestamptz;
ALTER TABLE orders ADD COLUMN handed_over_by integer REFERENCES users(id);
