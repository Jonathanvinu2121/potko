// How the waiter and manager screens read an order. Everything is worked out from what the
// server last sent; nothing here changes an order.

// Dishes that are not (or no longer) being served.
export const DEAD = ['unavailable', 'removed', 'cancelled'];

export const isOpen = (order) => order.status !== 'closed' && order.status !== 'cancelled';

// Label, colour and icon for each dish status. Status is never shown by colour alone.
export const ITEM_STATUS = {
  sent: { label: 'Sent', tone: 'neutral', icon: 'send-outline' },
  accepted: { label: 'Accepted', tone: 'primary', icon: 'check' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'lock-outline' },
  ready: { label: 'Ready', tone: 'success', icon: 'check-circle-outline' },
  delivered: { label: 'Delivered', tone: 'neutral', icon: 'check-all' },
  unavailable: { label: 'Unavailable', tone: 'error', icon: 'close-circle-outline' },
  removed: { label: 'Removed', tone: 'neutral', icon: 'minus-circle-outline' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'cancel' },
};

export const ORDER_STATUS = {
  new: { label: 'Sent to kitchen', tone: 'neutral', icon: 'send-outline' },
  accepted: { label: 'Accepted', tone: 'primary', icon: 'check' },
  preparing: { label: 'In kitchen', tone: 'warning', icon: 'pot-steam-outline' },
  partly_ready: { label: 'Partly ready', tone: 'success', icon: 'check-circle-outline' },
  ready: { label: 'Ready', tone: 'success', icon: 'check-circle-outline' },
  delivered: { label: 'All delivered', tone: 'success', icon: 'check-all' },
  closed: { label: 'Paid', tone: 'neutral', icon: 'cash-check' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'cancel' },
};

export const TYPE_LABEL = { dine_in: 'Dine-in', delivery: 'Delivery', takeaway: 'Takeaway' };
export const TYPE_ICON = { dine_in: 'silverware-fork-knife', delivery: 'moped-outline', takeaway: 'car-outline' };

export const itemsWith = (order, ...statuses) => order.items.filter((i) => statuses.includes(i.status));
export const readyItems = (order) => itemsWith(order, 'ready');
export const unavailableItems = (order) => itemsWith(order, 'unavailable');

// Dishes that count on the bill and on "5 items": everything not dead.
export const liveItems = (order) => order.items.filter((i) => !DEAD.includes(i.status));

// Nothing left to cook or deliver: every dish is delivered or dead. Only then can the bill be closed.
export const allSettled = (order) => order.items.every((i) => i.status === 'delivered' || DEAD.includes(i.status));

// Requests still waiting for a manager.
export const cancelRequested = (order, itemId) =>
  order.pending_approvals.some((a) => a.type === 'cancel' && a.order_item_id === itemId);
export const pendingDiscount = (order) => order.pending_approvals.find((a) => a.type === 'discount') ?? null;
