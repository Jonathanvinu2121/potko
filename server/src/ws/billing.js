// Money and trust: discounts, manager approvals, closing a table and taking payment.
// A waiter alone can never cancel cooked food or give a discount above their limit.
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { loginLimiter } = require('../auth');
const { getOrder, refreshOrder, audit, allSettled } = require('../orders');
const { getApproval } = require('../approvals');
const ws = require('./events');
const { publishOrder } = require('./publish');
const { lockOwnOrder } = require('./orders');

const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;
const MANAGERS = ['manager', 'admin'];

function readPct(value) {
  const pct = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new AppError(400, 'bad_pct', 'Enter a discount between 0 and 100');
  return pct;
}

async function discountLimit(client, userId) {
  const { rows } = await client.query('SELECT discount_limit_pct FROM users WHERE id = $1', [userId]);
  return rows[0].discount_limit_pct;
}

// Before a bill can be closed or paid: nothing still with the kitchen or waiting to be delivered,
// and no request still waiting for a manager.
function checkBillable(order) {
  if (!allSettled(order)) throw new AppError(409, 'not_all_delivered', 'Deliver or remove every item first');
  if (order.pending_approvals.length > 0) throw new AppError(409, 'approval_pending', 'A manager approval is still pending on this order');
}

// discount.apply { orderId, pct } — within the waiter's own limit it applies at once.
ws.on('discount.apply', async (user, payload) => {
  ws.need(user, 'waiter');
  const pct = readPct(payload.pct);
  const order = await db.tx(async (client) => {
    const before = await lockOwnOrder(client, user, payload.orderId);
    const limit = await discountLimit(client, user.id);
    if (pct > limit) throw new AppError(409, 'above_limit', `You can give up to ${limit}%. Ask for manager approval for more.`);
    await client.query('UPDATE orders SET discount_pct = $1 WHERE id = $2', [pct, before.id]);
    const fresh = await refreshOrder(client, user.restaurantId, before.id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'discount.apply',
      entity: 'order',
      entityId: before.id,
      old: { pct: before.discount_pct, total: before.total },
      new: { pct, total: fresh.total },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// approval.request { type: 'discount' | 'cancel', orderId, itemId?, payload: { pct?, reason } }
ws.on('approval.request', async (user, payload) => {
  ws.need(user, 'waiter');
  const type = payload.type;
  if (type !== 'discount' && type !== 'cancel') throw new AppError(400, 'bad_type', 'Unknown request');
  const reason = text(payload.payload?.reason, 200);

  const { order, approvalId } = await db.tx(async (client) => {
    const before = await lockOwnOrder(client, user, payload.orderId);
    let itemId = null;
    let details;

    if (type === 'discount') {
      const pct = readPct(payload.payload?.pct);
      const limit = await discountLimit(client, user.id);
      if (pct <= limit) throw new AppError(409, 'within_limit', `${pct}% is within your limit. Apply it directly.`);
      details = { pct, reason };
    } else {
      if (!reason) throw new AppError(400, 'no_reason', 'Give a reason for the cancel');
      const item = await client.query('SELECT id, status, name_snapshot FROM order_items WHERE id = $1 AND order_id = $2', [
        payload.itemId,
        before.id,
      ]);
      if (!item.rows[0]) throw new AppError(404, 'no_item', 'That item is not on this order');
      if (!['preparing', 'ready', 'delivered'].includes(item.rows[0].status)) {
        throw new AppError(409, 'not_needed', 'This item can still be removed without a manager');
      }
      itemId = item.rows[0].id;
      details = { reason };
    }

    const waiting = await client.query(
      `SELECT 1 FROM approvals
        WHERE order_id = $1 AND type = $2 AND status = 'pending' AND order_item_id IS NOT DISTINCT FROM $3::int`,
      [before.id, type, itemId]
    );
    if (waiting.rows[0]) throw new AppError(409, 'already_requested', 'This is already waiting for a manager');

    const inserted = await client.query(
      `INSERT INTO approvals (restaurant_id, order_id, order_item_id, type, requested_by, payload)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [user.restaurantId, before.id, itemId, type, user.id, JSON.stringify(details)]
    );
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: `${type}.request`,
      entity: 'order',
      entityId: before.id,
      new: { ...details, itemId: itemId || undefined },
    });
    return { order: await getOrder(client, user.restaurantId, before.id), approvalId: inserted.rows[0].id };
  });

  const approval = await getApproval(db, user.restaurantId, approvalId);
  await publishOrder(order); // the order now carries the pending request (the chef sees "cancel requested")
  ws.toRoles(user.restaurantId, MANAGERS, 'approval.requested', approval);
  ws.toUser(user.restaurantId, user.id, 'approval.requested', approval);
  return approval;
});

// approval.decide { approvalId, approve, pin?, reason? } — manager or admin only. Approving needs their PIN.
ws.on('approval.decide', async (user, payload) => {
  ws.need(user, ...MANAGERS);
  const approve = payload.approve === true;

  if (approve) {
    const key = `pin:${user.id}`;
    const wait = loginLimiter.lockedFor(key);
    if (wait) throw new AppError(429, 'pin_locked', `Too many wrong PINs. Try again in ${wait} seconds.`);
    const { rows } = await db.query('SELECT pin_hash FROM users WHERE id = $1', [user.id]);
    if (!rows[0]?.pin_hash) throw new AppError(409, 'no_pin', 'Set your approval PIN in Settings first');
    const ok = await bcrypt.compare(String(payload.pin ?? ''), rows[0].pin_hash);
    if (!ok) {
      loginLimiter.fail(key);
      throw new AppError(403, 'wrong_pin', 'Wrong PIN');
    }
    loginLimiter.clear(key);
  }

  const { order, approvalId } = await db.tx(async (client) => {
    const found = await client.query(
      `SELECT * FROM approvals WHERE id = $1 AND restaurant_id = $2 AND status = 'pending' FOR UPDATE`,
      [payload.approvalId, user.restaurantId]
    );
    const approval = found.rows[0];
    if (!approval) throw new AppError(409, 'already_decided', 'This request was already decided');

    if (approve && approval.type === 'discount') {
      await client.query('UPDATE orders SET discount_pct = $1 WHERE id = $2', [approval.payload.pct, approval.order_id]);
    }
    if (approve && approval.type === 'cancel') {
      await client.query(
        `UPDATE order_items SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status IN ('preparing', 'ready', 'delivered')`,
        [approval.order_item_id]
      );
    }
    const decision = text(payload.reason, 200);
    await client.query(
      `UPDATE approvals
          SET status = $2, decided_by = $3, decided_at = now(), payload = payload || $4::jsonb
        WHERE id = $1`,
      [approval.id, approve ? 'approved' : 'rejected', user.id, JSON.stringify(decision ? { decision_reason: decision } : {})]
    );
    const fresh = await refreshOrder(client, user.restaurantId, approval.order_id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: `${approval.type}.${approve ? 'approved' : 'rejected'}`,
      entity: 'order',
      entityId: approval.order_id,
      new: { ...approval.payload, itemId: approval.order_item_id || undefined, requestedBy: approval.requested_by, decision_reason: decision || undefined },
    });
    return { order: fresh, approvalId: approval.id };
  });

  const approval = await getApproval(db, user.restaurantId, approvalId);
  await publishOrder(order);
  // The waiter who asked hears at once; so does every manager screen, to clear the inbox.
  ws.toUser(user.restaurantId, approval.requested_by, 'approval.decided', approval);
  ws.toRoles(user.restaurantId, MANAGERS, 'approval.decided', approval);
  return approval;
});

// table.close { orderId } — the meal is over: move to the bill. Only when every dish is delivered,
// removed, unavailable or cancelled. (Delivery and takeaway use the same step as "Complete order".)
ws.on('table.close', async (user, payload) => {
  ws.need(user, 'waiter');
  const order = await db.tx(async (client) => {
    await lockOwnOrder(client, user, payload.orderId);
    const current = await getOrder(client, user.restaurantId, payload.orderId);
    checkBillable(current);
    if (current.table_id) await client.query(`UPDATE tables SET status = 'needs_payment' WHERE id = $1`, [current.table_id]);
    return current;
  });
  await publishOrder(order);
  return order;
});

// payment.mark { orderId, method: 'cash' | 'upi' | 'card' | 'counter' }
//   cash / upi / card  the order is paid and closed; a dine-in table becomes free
//   counter            (waiter, when the restaurant allows it) hand the bill to the manager's counter
ws.on('payment.mark', async (user, payload) => {
  ws.need(user, 'waiter', ...MANAGERS);
  const method = payload.method;
  if (!['cash', 'upi', 'card', 'counter'].includes(method)) throw new AppError(400, 'bad_method', 'Choose a payment method');

  const order = await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ('closed', 'cancelled') FOR UPDATE`,
      [payload.orderId, user.restaurantId]
    );
    if (!rows[0]) throw new AppError(404, 'no_order', 'This order is no longer open');
    if (user.role === 'waiter' && rows[0].waiter_id !== user.id) {
      throw new AppError(403, 'not_your_order', 'This order belongs to another waiter');
    }
    const current = await getOrder(client, user.restaurantId, rows[0].id);
    checkBillable(current);

    if (method === 'counter') {
      if (user.role !== 'waiter') throw new AppError(400, 'bad_method', 'Choose cash, UPI or card');
      const settings = await client.query('SELECT settings FROM restaurants WHERE id = $1', [user.restaurantId]);
      if (settings.rows[0].settings.payment_at !== 'counter') {
        throw new AppError(409, 'counter_off', 'Counter payment is switched off for this restaurant');
      }
      await client.query('UPDATE orders SET at_counter = true WHERE id = $1', [current.id]);
      if (current.table_id) await client.query(`UPDATE tables SET status = 'needs_payment' WHERE id = $1`, [current.table_id]);
      await audit(client, {
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'payment.counter',
        entity: 'order',
        entityId: current.id,
        new: { total: current.total },
      });
      return getOrder(client, user.restaurantId, current.id);
    }

    await client.query(
      `UPDATE orders SET payment_method = $1, paid_at = now(), status = 'closed', closed_at = now(), at_counter = false WHERE id = $2`,
      [method, current.id]
    );
    if (current.table_id) {
      await client.query(`UPDATE tables SET status = 'free', locked_by = NULL, locked_at = NULL WHERE id = $1`, [current.table_id]);
    }
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'payment.mark',
      entity: 'order',
      entityId: current.id,
      new: { method, total: current.total, discount_pct: current.discount_pct },
    });
    return getOrder(client, user.restaurantId, current.id);
  });
  await publishOrder(order);
  return order;
});
