// How the kitchen reads an order. Everything here is worked out from the items' statuses,
// which only the server changes.

// Dishes the kitchen is (or was) making: not denied, removed or cancelled.
export const liveItems = (order) => order.items.filter((i) => !['unavailable', 'removed', 'cancelled'].includes(i.status));

// The order type is the biggest thing on a kitchen card: DINE-IN T5 / DELIVERY Rahul / CAR PB10AB1234.
export function kitchenLabel(order) {
  if (order.type === 'dine_in') return `DINE-IN ${order.table_label}`;
  if (order.type === 'delivery') return `DELIVERY ${order.customer_name}`;
  return `CAR ${order.car_number || order.customer_name}`;
}

// Where an order sits for the chef:
//   'new'        something waits to be accepted or denied
//   'accepted'   accepted, cooking not started
//   'preparing'  cooking
//   'done'       every dish is ready or delivered
//   null         nothing left for the kitchen (every dish denied or removed)
export function kitchenStage(order) {
  const live = liveItems(order);
  if (live.length === 0) return null;
  const has = (status) => live.some((i) => i.status === status);
  if (has('sent')) return 'new';
  if (has('accepted')) return 'accepted';
  if (has('preparing')) return 'preparing';
  return 'done';
}

// "1 of 3 ready"
export function progress(order) {
  const live = liveItems(order);
  return { ready: live.filter((i) => i.status === 'ready' || i.status === 'delivered').length, total: live.length };
}
