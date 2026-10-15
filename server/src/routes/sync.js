const express = require('express');
const db = require('../db');
const { ORDER_SELECT } = require('../orders');
const { listTables } = require('../tables');
const { APPROVAL_SELECT } = require('../approvals');
const { can } = require('../permissions');
const { tableFor, areaFor, orderFor } = require('../scope');
const { listAreas, listFloors, listTerminals } = require('./floor');

const router = express.Router();

// GET /sync — everything a screen needs to rebuild itself after a reconnect:
// dining areas and tables, kitchen terminals, the orders in progress with their items and
// payments, the approvals still waiting, and the waiter's ready count.
router.get('/', async (req, res) => {
  const { id: userId, restaurantId, role } = req.user;
  const isChef = role === 'chef';
  const everyOrder = isChef || can(req.user, 'orders.view');

  // A waiter gets their own orders; the kitchen and the office get every order in progress.
  // An order stays here until its table is closed, so a paid table can still be closed or moved.
  // The chef also gets orders finished during this service, for the board's Done tab.
  const orders = await db.query(
    `${ORDER_SELECT}
      WHERE o.restaurant_id = $1
        AND o.status NOT IN ('cancelled', 'merged')
        AND (o.status <> 'closed' OR ($3 AND o.created_at > now() - interval '18 hours'))
        AND ($2::int IS NULL OR o.waiter_id = $2)
      ORDER BY o.created_at`,
    [restaurantId, everyOrder ? null : userId, isChef]
  );

  // People who decide approvals see every waiting request; everyone else sees only their own.
  const approvals = await db.query(
    `${APPROVAL_SELECT}
      WHERE a.restaurant_id = $1 AND a.status = 'pending' AND ($2::int IS NULL OR a.requested_by = $2)
      ORDER BY a.created_at`,
    [restaurantId, can(req.user, 'approvals.decide') ? null : userId]
  );

  const readyCount = role === 'waiter'
    ? orders.rows.reduce((n, o) => n + (['paid', 'closed'].includes(o.status) ? 0 : o.items.filter((i) => i.status === 'ready').length), 0)
    : 0;

  // Each person gets only what is assigned to them (see scope.js).
  const me = req.user;
  const terminals = await listTerminals(db, restaurantId);
  res.json({
    floors: await listFloors(db, restaurantId),
    areas: (await listAreas(db, restaurantId)).filter((a) => areaFor(me, a)),
    tables: (await listTables(db, restaurantId)).map((t) => tableFor(me, t)).filter(Boolean),
    terminals: isChef ? terminals.filter((k) => (me.terminals || []).includes(k.id)) : terminals,
    orders: orders.rows.map((o) => orderFor(me, o)).filter(Boolean),
    approvals: approvals.rows,
    readyCount,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
