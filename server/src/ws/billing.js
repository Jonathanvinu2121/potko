// Money and trust: discounts, manager approvals, asking for the bill, taking payment, refunds
// and closing the table. A waiter alone can never cancel cooked food or give a discount above
// their limit, and nothing marks a bill paid except a confirmed payment.
const bcrypt = require('bcryptjs');
const db = require('../db');
const { AppError } = require('../errors');
const { loginLimiter } = require('../auth');
const { getOrder, refreshOrder, audit, allSettled, amountDue, billFor, restaurantSettings, releaseTable, DEAD, SETTLED_SQL, TABLE_STATUS } = require('../orders');
const { discountPct } = require('../bill');
const { getApproval } = require('../approvals');
const { can, need } = require('../permissions');
const { approvalFor } = require('../scope');
const ws = require('./events');
const { publishOrder } = require('./publish');
const { lockOwnOrder, checkOwner, CLOSED } = require('./orders');

const text = (value, max) => String(value ?? '').trim().slice(0, max) || null;
const money = (value) => Math.round(Number(value) * 100) / 100;

// Reads a discount: { type: 'pct' | 'amount', value }. Older apps send { pct }.
function readDiscount(input) {
  const type = input?.type === 'amount' ? 'amount' : 'pct';
  const value = money(input?.value ?? input?.pct ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new AppError(400, 'bad_discount', 'Enter a discount amount');
  if (type === 'pct' && value > 100) throw new AppError(400, 'bad_pct', 'Enter a discount between 0 and 100 percent');
  return { type, value };
}

// Before a bill can be asked for or paid: nothing still with the kitchen or waiting to be
// delivered, and no request still waiting for a manager.
function checkBillable(order) {
  if (!allSettled(order)) throw new AppError(409, 'not_all_delivered', 'Serve or remove every item first');
  if (order.pending_approvals.length > 0) throw new AppError(409, 'approval_pending', 'A manager approval is still pending on this order');
}

// The person's approval PIN, checked on the server. Wrong tries are counted and lock the PIN
// for longer each time; nothing is approved on a wrong PIN.
async function verifyPin(user, pin) {
  const key = `pin:${user.id}`;
  const wait = loginLimiter.lockedFor(key);
  if (wait) throw new AppError(429, 'pin_locked', `Too many wrong PINs. Try again in ${wait > 90 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`}.`, { retryAfter: wait });
  const { rows } = await db.query('SELECT pin_hash FROM users WHERE id = $1', [user.id]);
  if (!rows[0]?.pin_hash) throw new AppError(409, 'no_pin', 'Set your approval PIN in Settings first');
  const ok = await bcrypt.compare(String(pin ?? ''), rows[0].pin_hash);
  if (!ok) {
    const locked = loginLimiter.fail(key);
    await audit(db, { restaurantId: user.restaurantId, userId: user.id, action: 'pin.failed', entity: 'user', entityId: user.id }).catch(() => {});
    if (locked) throw new AppError(429, 'pin_locked', `Too many wrong PINs. Try again in ${locked > 90 ? `${Math.ceil(locked / 60)} minutes` : `${locked} seconds`}.`, { retryAfter: locked });
    throw new AppError(403, 'wrong_pin', `Wrong PIN. ${loginLimiter.left(key)} tries left.`);
  }
  loginLimiter.clear(key);
}

// Locks an order someone is about to bill. Its waiter may, and so may anyone who takes
// payments or manages every order.
async function lockForBilling(client, user, orderId, { paidToo = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ${paidToo ? "('closed', 'cancelled', 'merged')" : SETTLED_SQL} FOR UPDATE`,
    [orderId, user.restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_order', 'This order is no longer open');
  // A waiter bills their own orders; the counter (cashier, manager) bills anyone's.
  const mine = rows[0].waiter_id === user.id;
  const counter = user.role !== 'waiter' && can(user, 'payments.collect');
  if (!mine && !counter && !can(user, 'orders.manage')) {
    throw new AppError(403, 'not_your_order', 'This order belongs to another waiter');
  }
  // Once its waiter closed the table, the bill is the counter's.
  if (rows[0].handed_over_at && user.role === 'waiter') throw new AppError(409, 'order_closed', CLOSED);
  return rows[0];
}

// discount.apply { orderId, type, value, reason } — within the person's own limit it applies at once.
// A value of 0 takes the discount off.
ws.on('discount.apply', async (user, payload) => {
  const discount = readDiscount(payload);
  const reason = text(payload.reason, 200);
  if (discount.value > 0 && !reason && payload.pct === undefined) throw new AppError(400, 'no_reason', 'Choose a reason for the discount');
  const order = await db.tx(async (client) => {
    const before = await lockForBilling(client, user, payload.orderId);
    if (discount.type === 'amount' && discount.value > before.subtotal) throw new AppError(400, 'bad_discount', 'The discount cannot be more than the bill');
    const pct = discountPct(discount.type, discount.value, before.subtotal);
    if (pct > user.discountLimit) {
      throw new AppError(409, 'above_limit', `You can give up to ${user.discountLimit}%. Ask for manager approval for more.`, { limit: user.discountLimit });
    }
    await client.query(
      'UPDATE orders SET discount_type = $1, discount_value = $2, discount_reason = $3, discount_by = $4 WHERE id = $5',
      [discount.type, discount.value, discount.value > 0 ? reason : null, discount.value > 0 ? user.id : null, before.id]
    );
    const fresh = await refreshOrder(client, user.restaurantId, before.id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'discount.apply',
      entity: 'order',
      entityId: before.id,
      old: { type: before.discount_type, value: before.discount_value, pct: before.discount_pct, total: before.total },
      new: { type: discount.type, value: discount.value, pct: fresh.discount_pct, amount: fresh.discount_amount, total: fresh.total },
      reason,
      refs: { order_id: before.id, table_id: before.table_id || undefined },
    });
    return fresh;
  });
  await publishOrder(order);
  return order;
});

// approval.request { type: 'discount' | 'cancel' | 'refund', orderId, itemId?, payload }
//   discount  payload { type, value, reason }: more than the person may give alone
//   cancel    payload { reason }: a dish the kitchen has started. If it was already served this
//             becomes a "void", which the manager sees as its own kind of request.
//   refund    payload { amount, method, reason }: money back on a paid bill
ws.on('approval.request', async (user, payload) => {
  let type = payload.type;
  if (!['discount', 'cancel', 'void', 'refund'].includes(type)) throw new AppError(400, 'bad_type', 'Unknown request');
  const reason = text(payload.payload?.reason, 200);
  const settings = await restaurantSettings(db, user.restaurantId);

  const { order, approvalId } = await db.tx(async (client) => {
    const row = type === 'refund'
      ? await lockForBilling(client, user, payload.orderId, { paidToo: true })
      : await lockOwnOrder(client, user, payload.orderId).catch(async (err) => {
          // A cashier is not the order's waiter but may still ask for a discount on its bill.
          if (err.code === 'not_your_order' && type === 'discount') return lockForBilling(client, user, payload.orderId);
          throw err;
        });
    const before = await getOrder(client, user.restaurantId, row.id);
    let itemId = null;
    let details;

    if (type === 'discount') {
      const discount = readDiscount(payload.payload);
      if (!reason) throw new AppError(400, 'no_reason', 'Give a reason for the discount');
      if (discount.type === 'amount' && discount.value > before.subtotal) throw new AppError(400, 'bad_discount', 'The discount cannot be more than the bill');
      const pct = discountPct(discount.type, discount.value, before.subtotal);
      if (pct <= user.discountLimit) throw new AppError(409, 'within_limit', `${discount.type === 'pct' ? `${pct}%` : `₹${discount.value}`} is within your limit. Apply it directly.`);
      const now = billFor({ ...before, discount_type: 'pct', discount_value: 0 }, settings);
      const then = billFor({ ...before, discount_type: discount.type, discount_value: discount.value }, settings);
      // What the manager is shown: the bill as it is, the change asked for, and the bill after it.
      details = { type: discount.type, value: discount.value, pct, reason, amount: then.discount_amount, total_before: now.total, total_after: then.total };
    } else if (type === 'refund') {
      need(user, 'payments.collect');
      if (!reason) throw new AppError(400, 'no_reason', 'Give a reason for the refund');
      const amount = money(payload.payload?.amount);
      const left = refundable(before);
      if (!(amount > 0) || amount > left) throw new AppError(400, 'bad_amount', `Up to ₹${left} can be refunded on this bill`);
      details = { amount, method: text(payload.payload?.method, 20) || 'cash', reason, paid: before.paid_total };
    } else {
      if (!reason) throw new AppError(400, 'no_reason', 'Give a reason for the cancel');
      const item = before.items.find((i) => i.id === Number(payload.itemId));
      if (!item) throw new AppError(404, 'no_item', 'That item is not on this order');
      if (!['preparing', 'ready', 'delivered'].includes(item.status)) {
        throw new AppError(409, 'not_needed', 'This item can still be removed without a manager');
      }
      itemId = item.id;
      type = item.status === 'delivered' ? 'void' : 'cancel';
      const without = billFor({ ...before, items: before.items.filter((i) => i.id !== item.id) }, settings);
      details = { reason, item_status: item.status, amount: money(item.qty * item.unit_price), total_before: before.total, total_after: without.total };
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
      reason,
      refs: { order_id: before.id, table_id: before.table_id || undefined, approval_id: inserted.rows[0].id },
    });
    return { order: await getOrder(client, user.restaurantId, before.id), approvalId: inserted.rows[0].id };
  });

  const approval = await getApproval(db, user.restaurantId, approvalId);
  await publishOrder(order); // the order now carries the pending request (the chef sees "cancel requested")
  ws.toEach(user.restaurantId, 'approval.requested', approval, (u, a) => (can(u, 'approvals.decide') || u.id === user.id ? approvalFor(u, a) : null));
  return approval;
});

// What can still be given back on a bill: what was paid, less what was already refunded.
function refundable(order) {
  const sum = (kind) => order.payments.filter((p) => p.kind === kind && p.status === 'successful').reduce((a, p) => a + p.amount, 0);
  return Math.max(0, money(sum('payment') - sum('refund')));
}

async function insertRefund(client, user, order, { amount, method, reason }, approvalId) {
  const left = refundable(order);
  if (!(amount > 0) || amount > left) throw new AppError(409, 'bad_amount', `Up to ₹${left} can be refunded on this bill`);
  const inserted = await client.query(
    `INSERT INTO payments (restaurant_id, order_id, kind, method, amount, note, created_by)
     VALUES ($1, $2, 'refund', $3, $4, $5, $6) RETURNING id`,
    [user.restaurantId, order.id, method || 'cash', amount, reason, user.id]
  );
  await audit(client, {
    restaurantId: user.restaurantId,
    userId: user.id,
    action: 'payment.refund',
    entity: 'order',
    entityId: order.id,
    old: { refundable: left },
    new: { amount, method: method || 'cash' },
    reason,
    refs: { order_id: order.id, payment_id: inserted.rows[0].id, approval_id: approvalId || undefined },
  });
}

// approval.decide { approvalId, approve, pin?, reason?, override? } — for people who may decide
// approvals. Approving needs their PIN. For a discount the approver may change what is given:
// override { type, value }.
ws.on('approval.decide', async (user, payload) => {
  need(user, 'approvals.decide');
  const approve = payload.approve === true;
  if (approve) await verifyPin(user, payload.pin);

  const { order, approvalId } = await db.tx(async (client) => {
    const found = await client.query(
      `SELECT * FROM approvals WHERE id = $1 AND restaurant_id = $2 AND status = 'pending' FOR UPDATE`,
      [payload.approvalId, user.restaurantId]
    );
    const approval = found.rows[0];
    if (!approval) throw new AppError(409, 'already_decided', 'This request was already decided');
    await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [approval.order_id]);
    const before = await getOrder(client, user.restaurantId, approval.order_id);
    const decision = text(payload.reason, 200);
    const result = {};

    if (approve && approval.type === 'discount') {
      const given = payload.override ? readDiscount(payload.override) : { type: approval.payload.type || 'pct', value: approval.payload.value ?? approval.payload.pct };
      if (given.type === 'amount' && given.value > before.subtotal) throw new AppError(400, 'bad_discount', 'The discount cannot be more than the bill');
      await client.query(
        'UPDATE orders SET discount_type = $1, discount_value = $2, discount_reason = $3, discount_by = $4 WHERE id = $5',
        [given.type, given.value, approval.payload.reason || decision, approval.requested_by, approval.order_id]
      );
      result.given = given;
    }
    if (approve && (approval.type === 'cancel' || approval.type === 'void')) {
      await client.query(
        `UPDATE order_items SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status IN ('preparing', 'ready', 'delivered')`,
        [approval.order_item_id]
      );
    }
    if (approve && approval.type === 'refund') {
      await insertRefund(client, user, before, approval.payload, approval.id);
    }
    await client.query(
      `UPDATE approvals
          SET status = $2, decided_by = $3, decided_at = now(), payload = payload || $4::jsonb
        WHERE id = $1`,
      [approval.id, approve ? 'approved' : 'rejected', user.id, JSON.stringify({ ...(decision ? { decision_reason: decision } : {}), ...result })]
    );
    const fresh = await refreshOrder(client, user.restaurantId, approval.order_id);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: `${approval.type}.${approve ? 'approved' : 'rejected'}`,
      entity: 'order',
      entityId: approval.order_id,
      old: { total: before.total, discount_type: before.discount_type, discount_value: before.discount_value },
      new: { ...approval.payload, ...result, total: fresh.total, itemId: approval.order_item_id || undefined, requestedBy: approval.requested_by, decision_reason: decision || undefined },
      reason: decision || approval.payload.reason || null,
      refs: { order_id: approval.order_id, table_id: before.table_id || undefined, approval_id: approval.id },
    });
    return { order: fresh, approvalId: approval.id };
  });

  const approval = await getApproval(db, user.restaurantId, approvalId);
  await publishOrder(order);
  // The person who asked hears at once; so does every approver's screen, to clear the inbox.
  ws.toEach(user.restaurantId, 'approval.decided', approval, (u, a) => (can(u, 'approvals.decide') || u.id === a.requested_by ? approvalFor(u, a) : null));
  return approval;
});

// bill.request { orderId } — the meal is over: the bill is wanted. Only when every dish is served,
// removed, unavailable or cancelled. The order joins the payment queue.
// ("table.close" is the same action under the name older apps use.)
async function requestBill(user, payload) {
  const order = await db.tx(async (client) => {
    const row = await lockOwnOrder(client, user, payload.orderId);
    const current = await getOrder(client, user.restaurantId, row.id);
    checkBillable(current);
    if (!current.bill_requested_at) {
      await client.query(
        'UPDATE orders SET bill_requested_at = now(), bill_requested_by = $1, at_counter = $2 WHERE id = $3',
        [user.id, !can(user, 'payments.collect'), current.id]
      );
      await audit(client, {
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'bill.request',
        entity: 'order',
        entityId: current.id,
        new: { total: current.total },
        refs: { order_id: current.id, table_id: current.table_id || undefined },
      });
    }
    if (current.table_id) await client.query(`UPDATE tables SET status = 'needs_payment' WHERE id = $1`, [current.table_id]);
    return getOrder(client, user.restaurantId, current.id);
  });
  await publishOrder(order);
  return order;
}
ws.on('bill.request', requestBill);
ws.on('table.close', requestBill);

// Records one payment on a bill. When the bill is fully paid the order becomes Paid; a table
// order then waits for "Close table", anything else is finished at once.
async function addPayment(client, user, orderId, { method, amount, received, reference, note, status, clientId, close }) {
  const settings = await restaurantSettings(client, user.restaurantId);
  if (!settings.payment_methods.includes(method)) throw new AppError(400, 'bad_method', 'Choose a payment method');
  const row = await lockForBilling(client, user, orderId);
  if (!can(user, 'payments.collect')) {
    throw new AppError(403, 'no_payment_permission', user.role === 'waiter' ? 'You cannot take payments. Send the bill to the manager.' : 'You do not have permission to take payments');
  }

  // The same payment sent twice (a retry after a lost answer) is recorded once.
  if (clientId) {
    const again = await client.query('SELECT 1 FROM payments WHERE restaurant_id = $1 AND client_id = $2', [user.restaurantId, clientId]);
    if (again.rows[0]) return getOrder(client, user.restaurantId, orderId);
  }

  const current = await getOrder(client, user.restaurantId, row.id);
  checkBillable(current);
  const due = amountDue(current);
  const pay = amount === undefined || amount === null ? due : money(amount);
  if (due > 0 && !(pay > 0)) throw new AppError(400, 'bad_amount', 'Enter the amount paid');
  if (pay > due) throw new AppError(400, 'overpaid', `Only ₹${due} is left to pay on this bill`);
  const failed = status === 'failed';

  let cash = null;
  let change = null;
  if (method === 'cash' && received !== undefined && received !== null && !failed) {
    cash = money(received);
    if (cash < pay) throw new AppError(400, 'short_cash', `₹${cash} received is less than ₹${pay}`);
    change = money(cash - pay);
  }

  let paymentId = null;
  if (pay > 0) {
    const inserted = await client.query(
      `INSERT INTO payments (restaurant_id, order_id, method, amount, status, reference, received, change_due, note, client_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [user.restaurantId, current.id, method, pay, failed ? 'failed' : 'successful', text(reference, 60), cash, change, text(note, 200), clientId || null, user.id]
    );
    paymentId = inserted.rows[0].id;
  }
  await audit(client, {
    restaurantId: user.restaurantId,
    userId: user.id,
    action: failed ? 'payment.failed' : 'payment.mark',
    entity: 'order',
    entityId: current.id,
    new: { method, amount: pay, total: current.total, due_before: due, reference: text(reference, 60) || undefined },
    refs: { order_id: current.id, table_id: current.table_id || undefined, payment_id: paymentId || undefined },
  });
  // A failed or cancelled attempt is on record, and the bill stays exactly as it was.
  if (failed) return getOrder(client, user.restaurantId, current.id);

  const paidTotal = money(current.paid_total + pay);
  const settled = paidTotal >= current.total;
  if (!settled) {
    await client.query('UPDATE orders SET paid_total = $1 WHERE id = $2', [paidTotal, current.id]);
    return getOrder(client, user.restaurantId, current.id);
  }

  const methods = new Set([...current.payments.filter((p) => p.kind === 'payment' && p.status === 'successful').map((p) => p.method), ...(pay > 0 ? [method] : [])]);
  const summary = methods.size > 1 ? 'split' : [...methods][0] || method;
  // A table order stays "Paid" until the table is closed; delivery and takeaway are finished now,
  // and so is an order whose waiter already closed the table (it may hold new guests by now).
  const handedOver = !!current.handed_over_at;
  const done = !current.table_id || close === true || handedOver;
  await client.query(
    `UPDATE orders
        SET paid_total = $1, payment_method = $2, paid_at = now(), settled_by = $3, at_counter = false,
            status = $4, closed_at = CASE WHEN $5 THEN now() ELSE NULL END
      WHERE id = $6`,
    [paidTotal, summary, user.id, done ? 'closed' : 'paid', done, current.id]
  );
  if (current.table_id && !handedOver) {
    if (done) await releaseTable(client, current.table_id);
    else await client.query(`UPDATE tables SET status = 'paid' WHERE id = $1`, [current.table_id]);
  }
  return getOrder(client, user.restaurantId, current.id);
}

// The tables to announce after an order's table may have been given back.
async function tablesAround(order) {
  if (!order.table_id) return [];
  const { rows } = await db.query('SELECT parent_table_id FROM tables WHERE id = $1', [order.table_id]);
  return [order.table_id, rows[0]?.parent_table_id];
}

// payment.add { orderId, method, amount?, received?, reference?, note?, status?, close? }
//   amount    leave out to pay everything that is due; a smaller amount is one part of a split payment
//   received  cash handed over: the change is worked out and saved
//   status    'failed' records an attempt that did not go through (the bill is not touched)
//   close     true closes the table as soon as the bill is fully paid
ws.on('payment.add', async (user, payload, actionId) => {
  const order = await db.tx((client) => addPayment(client, user, payload.orderId, { ...payload, clientId: actionId }));
  await publishOrder(order, { tables: await tablesAround(order) });
  return order;
});

// payment.mark { orderId, method } — older apps: pay everything by one method and close the table.
// 'counter' hands the bill to the manager's counter, which is now "ask for the bill".
ws.on('payment.mark', async (user, payload, actionId) => {
  if (payload.method === 'counter') return requestBill(user, payload);
  const order = await db.tx((client) => addPayment(client, user, payload.orderId, { method: payload.method, clientId: actionId, close: true }));
  await publishOrder(order, { tables: await tablesAround(order) });
  return order;
});

// order.close { orderId } — "Close table": the bill is paid and the guests have left.
ws.on('order.close', async (user, payload) => {
  const { order, tables } = await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ('closed', 'cancelled', 'merged') FOR UPDATE`,
      [payload.orderId, user.restaurantId]
    );
    const row = rows[0];
    if (!row) throw new AppError(404, 'no_order', 'This order is already closed');
    if (row.waiter_id !== user.id && !can(user, 'payments.collect')) checkOwner(user, row.waiter_id);
    if (!can(user, 'tables.close')) throw new AppError(403, 'forbidden', 'A manager or cashier closes this table');
    if (row.status !== 'paid') throw new AppError(409, 'not_paid', 'The table can be closed after the bill is paid');
    await client.query(`UPDATE orders SET status = 'closed', closed_at = now() WHERE id = $1`, [row.id]);
    const freed = row.table_id ? await releaseTable(client, row.table_id) : [];
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'table.close',
      entity: 'order',
      entityId: row.id,
      refs: { order_id: row.id, table_id: row.table_id || undefined },
    });
    return { order: await getOrder(client, user.restaurantId, row.id), tables: freed };
  });
  await publishOrder(order, { tables });
  return order;
});

// order.handover { orderId } — "Close Table" by a waiter who does not take payment: every dish is
// served, so the bill goes to the counter and the table is free at once for the next guests.
// From then on the order is locked; only a manager can reopen it (order.reopen) while its table
// is still free. A takeaway or delivery order goes to the counter the same way ("Close Order").
ws.on('order.handover', async (user, payload) => {
  if (!can(user, 'tables.close')) throw new AppError(403, 'forbidden', 'A manager or cashier closes this table');
  const { order, tables } = await db.tx(async (client) => {
    const row = await lockOwnOrder(client, user, payload.orderId);
    const current = await getOrder(client, user.restaurantId, row.id);
    checkBillable(current);
    await client.query(
      `UPDATE orders
          SET handed_over_at = now(), handed_over_by = $1, at_counter = true,
              bill_requested_at = COALESCE(bill_requested_at, now()), bill_requested_by = COALESCE(bill_requested_by, $1)
        WHERE id = $2`,
      [user.id, current.id]
    );
    const freed = current.table_id ? await releaseTable(client, current.table_id) : [];
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'table.handover',
      entity: 'order',
      entityId: current.id,
      new: { total: current.total },
      refs: { order_id: current.id, table_id: current.table_id || undefined },
    });
    return { order: await getOrder(client, user.restaurantId, current.id), tables: freed };
  });
  await publishOrder(order, { tables });
  return order;
});

// order.reopen { orderId } — a manager puts back a table its waiter closed: the order returns to its
// table, unlocked, so the waiter can add dishes, and leaves the payment queue until the table is
// closed again. Only while the bill is unpaid and the table is still free: no guests seated and
// no newer order on it since the closing.
ws.on('order.reopen', async (user, payload) => {
  need(user, 'orders.manage');
  const { order, tables } = await db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND restaurant_id = $2 AND handed_over_at IS NOT NULL AND status NOT IN ${SETTLED_SQL} FOR UPDATE`,
      [payload.orderId, user.restaurantId]
    );
    const row = rows[0];
    if (!row) throw new AppError(409, 'not_closed', 'Only a closed table whose bill is not paid yet can be reopened');
    const touched = [];
    if (row.table_id) {
      const table = (await client.query('SELECT * FROM tables WHERE id = $1 FOR UPDATE', [row.table_id])).rows[0];
      if (!table || table.archived || !table.active) {
        throw new AppError(409, 'table_gone', `${table?.label ?? 'This table'} is no longer in use. Put the extra dishes on a new order.`);
      }
      const newer = await client.query('SELECT 1 FROM orders WHERE table_id = $1 AND id <> $2 AND created_at > $3 LIMIT 1', [table.id, row.id, row.handed_over_at]);
      if (newer.rows[0] || table.status !== 'free' || table.locked_by || table.joined_to_id) {
        throw new AppError(409, 'table_taken', `${table.label} has new guests since it was closed. Put the extra dishes on a new order.`);
      }
      // The table carries on where it was when it was closed (served), held by the order's waiter.
      await client.query('UPDATE tables SET status = $1, locked_by = $2, locked_at = now() WHERE id = $3', [TABLE_STATUS[row.status] || 'all_delivered', row.waiter_id, table.id]);
      touched.push(table.id);
    }
    await client.query(
      `UPDATE orders
          SET handed_over_at = NULL, handed_over_by = NULL, at_counter = false, bill_requested_at = NULL, bill_requested_by = NULL
        WHERE id = $1`,
      [row.id]
    );
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'order.reopen',
      entity: 'order',
      entityId: row.id,
      old: { closed_at: row.handed_over_at, closed_by: row.handed_over_by },
      refs: { order_id: row.id, table_id: row.table_id || undefined },
    });
    return { order: await getOrder(client, user.restaurantId, row.id), tables: touched };
  });
  await publishOrder(order, { tables });
  return order;
});

// payment.refund { orderId, amount, method, reason, pin } — money back on a paid bill, by someone
// allowed to refund, confirmed with their PIN. The bill itself and its payments are never erased.
ws.on('payment.refund', async (user, payload) => {
  need(user, 'refunds.issue');
  const reason = text(payload.reason, 200);
  if (!reason) throw new AppError(400, 'no_reason', 'Give a reason for the refund');
  await verifyPin(user, payload.pin);
  const order = await db.tx(async (client) => {
    await client.query('SELECT id FROM orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE', [payload.orderId, user.restaurantId]);
    const current = await getOrder(client, user.restaurantId, Number(payload.orderId));
    if (!current || !current.paid_at) throw new AppError(409, 'not_paid', 'Only a paid bill can be refunded');
    await insertRefund(client, user, current, { amount: money(payload.amount), method: text(payload.method, 20), reason });
    return getOrder(client, user.restaurantId, current.id);
  });
  await publishOrder(order);
  return order;
});

module.exports = { verifyPin, checkBillable, DEAD };
