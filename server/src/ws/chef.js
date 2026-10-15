// Kitchen actions. A ticket has one decision: start preparing, or deny some of its dishes. Each
// action checks the item is in the right previous status, so a stale screen or a bypassed app
// can never skip a step (for example, mark a dish ready that nobody started).
// A chef only ever acts on the dishes routed to the terminals they are assigned to.
const db = require('../db');
const { AppError } = require('../errors');
const { refreshOrder, audit, SETTLED_SQL } = require('../orders');
const ws = require('./events');
const { publishOrder } = require('./publish');

const DENY_REASONS = { out_of_stock: 'Out of stock', too_busy: 'Kitchen too busy', other: 'Other' };
const PREP_MINUTES = [10, 15, 20, 30];

// The terminals this chef works at. Without any, there is nothing for them to act on.
function terminalsOf(user) {
  ws.need(user, 'chef');
  const ids = Array.isArray(user.terminals) ? user.terminals : [];
  if (ids.length === 0) throw new AppError(403, 'no_terminal', 'You are not assigned to a kitchen terminal. Ask a manager.');
  return ids;
}

// Locks the order row for the length of the transaction, so two chef screens cannot act on it at once.
async function lockOrder(client, restaurantId, orderId) {
  const { rows } = await client.query(
    `SELECT id FROM orders WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ${SETTLED_SQL} FOR UPDATE`,
    [orderId, restaurantId]
  );
  if (!rows[0]) throw new AppError(404, 'no_order', 'This order is no longer open');
}

// chef.accept { orderId } — every new item at my terminals becomes Accepted (step 1 of the
// kitchen: Accept, then Start preparing, then Ready).
ws.on('chef.accept', async (user, { orderId }) => {
  const terminals = terminalsOf(user);
  const order = await db.tx(async (client) => {
    await lockOrder(client, user.restaurantId, orderId);
    const accepted = await client.query(
      `UPDATE order_items SET status = 'accepted', updated_at = now()
        WHERE order_id = $1 AND status = 'sent' AND terminal_ids && $2::int[]`,
      [orderId, terminals]
    );
    if (accepted.rowCount === 0) throw new AppError(409, 'nothing_to_accept', 'Nothing new to accept on this order');
    return refreshOrder(client, user.restaurantId, orderId);
  });
  await publishOrder(order);
  return order;
});

// chef.deny { orderId, itemIds, reason, note } — the ticked items become Unavailable with one
// shared reason; everything else new at my terminals is accepted. The waiter is alerted.
ws.on('chef.deny', async (user, { orderId, itemIds, reason, note }) => {
  const terminals = terminalsOf(user);
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds.map(Number) : [])].filter(Number.isInteger);
  if (ids.length === 0) throw new AppError(400, 'no_items', 'Tick at least one item');
  if (!DENY_REASONS[reason]) throw new AppError(400, 'no_reason', 'Choose a reason');
  const cleanNote = String(note ?? '').trim().slice(0, 200);
  const reasonText = cleanNote ? `${DENY_REASONS[reason]} — ${cleanNote}` : DENY_REASONS[reason];

  const { order, accepted } = await db.tx(async (client) => {
    await lockOrder(client, user.restaurantId, orderId);
    const denied = await client.query(
      `UPDATE order_items SET status = 'unavailable', unavailable_reason = $3, updated_at = now()
        WHERE order_id = $1 AND id = ANY($2::int[]) AND status IN ('sent', 'accepted') AND terminal_ids && $4::int[]`,
      [orderId, ids, reasonText, terminals]
    );
    // All or nothing: if any ticked item has moved on (already cooking, removed by the waiter), stop.
    if (denied.rowCount !== ids.length) {
      throw new AppError(409, 'cannot_deny', 'Some of these items can no longer be denied. Check the order again.');
    }
    const more = await client.query(
      `UPDATE order_items SET status = 'accepted', updated_at = now()
        WHERE order_id = $1 AND status = 'sent' AND terminal_ids && $2::int[]`,
      [orderId, terminals]
    );
    const fresh = await refreshOrder(client, user.restaurantId, orderId);
    await audit(client, {
      restaurantId: user.restaurantId,
      userId: user.id,
      action: 'item.unavailable',
      entity: 'order',
      entityId: orderId,
      new: { itemIds: ids, reason: reasonText },
      reason: reasonText,
      refs: { order_id: orderId },
    });
    return { order: fresh, accepted: more.rowCount };
  });

  await publishOrder(order);
  ws.toUser(user.restaurantId, order.waiter_id, 'chef.denied', {
    orderId: order.id,
    itemIds: ids,
    reason: reasonText,
    accepted,
    unavailable: ids.length,
  });
  return { order, accepted, unavailable: ids.length };
});

// chef.start { orderId, prepMinutes? } — every dish waiting at my terminals becomes Preparing, in
// one step. From here the waiter cannot edit them.
ws.on('chef.start', async (user, { orderId, prepMinutes }) => {
  const terminals = terminalsOf(user);
  const minutes = PREP_MINUTES.includes(prepMinutes) ? prepMinutes : null;
  const order = await db.tx(async (client) => {
    await lockOrder(client, user.restaurantId, orderId);
    const started = await client.query(
      `UPDATE order_items SET status = 'preparing', updated_at = now(), started_at = now()
        WHERE order_id = $1 AND status IN ('sent', 'accepted') AND terminal_ids && $2::int[]`,
      [orderId, terminals]
    );
    if (started.rowCount === 0) throw new AppError(409, 'nothing_to_start', 'Nothing on this order is waiting to be started');
    if (minutes) await client.query('UPDATE orders SET prep_minutes = $1 WHERE id = $2', [minutes, orderId]);
    return refreshOrder(client, user.restaurantId, orderId);
  });
  await publishOrder(order);
  return order;
});

// chef.itemReady { itemId } — one item is ready; the waiter gets it at once (roti before curry).
ws.on('chef.itemReady', async (user, { itemId }) => {
  const terminals = terminalsOf(user);
  const order = await db.tx(async (client) => {
    const ready = await client.query(
      `UPDATE order_items i SET status = 'ready', updated_at = now(), ready_at = now(), ready_by = $3
         FROM orders o
        WHERE i.id = $1 AND o.id = i.order_id AND o.restaurant_id = $2 AND i.status = 'preparing'
          AND i.terminal_ids && $4::int[]
        RETURNING i.order_id`,
      [itemId, user.restaurantId, user.id, terminals]
    );
    if (!ready.rows[0]) throw new AppError(409, 'not_preparing', 'This item is not being prepared');
    return refreshOrder(client, user.restaurantId, ready.rows[0].order_id);
  });
  await publishOrder(order);
  return order;
});

// chef.allReady { orderId } — everything still cooking at my terminals is ready.
ws.on('chef.allReady', async (user, { orderId }) => {
  const terminals = terminalsOf(user);
  const order = await db.tx(async (client) => {
    await lockOrder(client, user.restaurantId, orderId);
    const ready = await client.query(
      `UPDATE order_items SET status = 'ready', updated_at = now(), ready_at = now(), ready_by = $3
        WHERE order_id = $1 AND status = 'preparing' AND terminal_ids && $2::int[]`,
      [orderId, terminals, user.id]
    );
    if (ready.rowCount === 0) throw new AppError(409, 'not_preparing', 'Nothing on this order is being prepared');
    return refreshOrder(client, user.restaurantId, orderId);
  });
  await publishOrder(order);
  return order;
});
