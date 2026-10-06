const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');

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

module.exports = router;
