const express = require('express');
const db = require('../db');
const { ORDER_SELECT } = require('../orders');
const { TABLE_SELECT } = require('../tables');
const { APPROVAL_SELECT } = require('../approvals');

const router = express.Router();

// GET /sync — everything a screen needs to rebuild itself after a reconnect:
// tables, active orders with their items, pending approvals and the waiter's ready count.
router.get('/', async (req, res) => {
  const { id: userId, restaurantId, role } = req.user;
  const isWaiter = role === 'waiter';

  const tables = await db.query(`${TABLE_SELECT} WHERE t.restaurant_id = $1 ORDER BY t.id`, [restaurantId]);

  // A waiter gets their own open orders; chef, manager and admin get every open order.
  // The chef also gets orders closed during this service, for the board's Done tab.
  const orders = await db.query(
    `${ORDER_SELECT}
      WHERE o.restaurant_id = $1
        AND o.status <> 'cancelled'
        AND (o.status <> 'closed' OR ($3 AND o.created_at > now() - interval '18 hours'))
        AND ($2::int IS NULL OR o.waiter_id = $2)
      ORDER BY o.created_at`,
    [restaurantId, isWaiter ? userId : null, role === 'chef']
  );

  // Managers and admins see every pending request; everyone else sees only their own.
  const seesAll = role === 'manager' || role === 'admin';
  const approvals = await db.query(
    `${APPROVAL_SELECT}
      WHERE a.restaurant_id = $1 AND a.status = 'pending' AND ($2::int IS NULL OR a.requested_by = $2)
      ORDER BY a.created_at`,
    [restaurantId, seesAll ? null : userId]
  );

  const readyCount = isWaiter
    ? orders.rows.reduce((n, o) => n + o.items.filter((i) => i.status === 'ready').length, 0)
    : 0;

  res.json({
    tables: tables.rows,
    orders: orders.rows,
    approvals: approvals.rows,
    readyCount,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
