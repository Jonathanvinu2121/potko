const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { AppError } = require('../errors');
const { can } = require('../permissions');
const { audit } = require('../orders');

const router = express.Router();

// GET /orders/recent-customers?type=delivery|takeaway
// The last few different customers (or cars) for that order type, to fill the details form in one tap.
router.get('/recent-customers', requireRole('waiter', 'manager', 'admin'), async (req, res) => {
  const type = req.query.type === 'takeaway' ? 'takeaway' : 'delivery';
  const { rows } = await db.query(
    `SELECT customer_name, customer_phone, delivery_address, car_number
       FROM orders
      WHERE restaurant_id = $1 AND type = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [req.user.restaurantId, type]
  );
  const seen = new Set();
  const customers = [];
  for (const row of rows) {
    const key = `${row.customer_name || ''}|${row.car_number || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    customers.push(row);
    if (customers.length === 6) break;
  }
  res.json({ customers });
});

// POST /orders/:id/receipt { kind: 'print' | 'share' } — the app says a bill was printed or sent.
// Nothing is printed here (the device prints); this keeps the record of who gave out a bill, and when.
router.post('/:id/receipt', async (req, res) => {
  if (!can(req.user, 'payments.collect') && !can(req.user, 'orders.view')) throw new AppError(403, 'forbidden', 'You do not have permission to do this');
  const id = Number(req.params.id);
  const kind = req.body?.kind === 'share' ? 'share' : 'print';
  const { rows } = await db.query('SELECT id, number, total, table_id, status FROM orders WHERE id = $1 AND restaurant_id = $2', [id, req.user.restaurantId]);
  const order = rows[0];
  if (!order) throw new AppError(404, 'no_order', 'No such order');
  if (!['paid', 'closed'].includes(order.status)) throw new AppError(409, 'not_paid', 'The bill can be printed after it is paid');
  await audit(db, {
    restaurantId: req.user.restaurantId, userId: req.user.id, action: `receipt.${kind}`, entity: 'order', entityId: id,
    new: { number: order.number, total: order.total },
    refs: { order_id: id, table_id: order.table_id || undefined },
  });
  res.json({ ok: true });
});

module.exports = router;
