// How the waiter and manager screens read an order. Everything is worked out from what the
// server last sent; nothing here changes an order.

// Dishes that are not (or no longer) being served.
export const DEAD = ['unavailable', 'removed', 'cancelled'];

// Still being served or billed: dishes can be added and the bill is not settled.
export const isOpen = (order) => !['paid', 'closed', 'cancelled', 'merged'].includes(order.status);
// Still holding a table (a paid table is occupied until it is closed).
export const onFloor = (order) => !['closed', 'cancelled', 'merged'].includes(order.status);

// Label, colour and icon for each dish status. Status is never shown by colour alone.
export const ITEM_STATUS = {
  sent: { label: 'Sent', tone: 'neutral', icon: 'send-outline' },
  accepted: { label: 'Accepted', tone: 'primary', icon: 'check' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'pot-steam-outline' },
  ready: { label: 'Ready', tone: 'success', icon: 'check-circle-outline' },
  delivered: { label: 'Served', tone: 'neutral', icon: 'check-all' },
  unavailable: { label: 'Unavailable', tone: 'error', icon: 'close-circle-outline' },
  removed: { label: 'Removed', tone: 'neutral', icon: 'minus-circle-outline' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'cancel' },
};

export const ORDER_STATUS = {
  new: { label: 'Sent to kitchen', tone: 'neutral', icon: 'send-outline' },
  accepted: { label: 'Accepted', tone: 'primary', icon: 'check' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'pot-steam-outline' },
  partly_ready: { label: 'Partly ready', tone: 'success', icon: 'check-circle-outline' },
  ready: { label: 'Ready to serve', tone: 'success', icon: 'check-circle-outline' },
  delivered: { label: 'Served', tone: 'success', icon: 'check-all' },
  paid: { label: 'Paid', tone: 'success', icon: 'cash-check' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'cash-check' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'cancel' },
  merged: { label: 'Merged', tone: 'neutral', icon: 'call-merge' },
};

// What an order is waiting for, in the words used everywhere: a served order whose bill was asked
// for is "Bill requested", one with part of the money taken is "Payment pending".
export function orderStage(order) {
  if (isOpen(order) && order.paid_total > 0) return { key: 'payment_pending', label: 'Payment pending', tone: 'warning', icon: 'cash-clock' };
  if (isOpen(order) && order.bill_requested_at) return { key: 'bill_requested', label: 'Bill requested', tone: 'warning', icon: 'receipt-text-outline' };
  return { key: order.status, ...ORDER_STATUS[order.status] };
}

// Everything that is true of an order right now, as short tags: where its dishes are in the
// kitchen, what the bill is waiting for, and any request waiting for a manager. One order can
// carry several at once ("2 ready", "1 preparing", "Discount waiting"). Most pressing first.
export function orderTags(order) {
  const tags = [];
  const count = (...statuses) => order.items.filter((i) => statuses.includes(i.status)).reduce((n, i) => n + i.qty, 0);
  const open = isOpen(order);
  if (order.status === 'cancelled') return [{ key: 'cancelled', label: 'Cancelled', tone: 'neutral', icon: 'cancel' }];
  if (order.status === 'merged') return [{ key: 'merged', label: 'Merged', tone: 'neutral', icon: 'call-merge' }];

  const unavailable = count('unavailable');
  if (open && unavailable) tags.push({ key: 'unavailable', label: `${unavailable} unavailable`, tone: 'error', icon: 'close-circle-outline' });
  for (const a of order.pending_approvals || []) {
    const what = a.type === 'discount' ? 'Discount' : a.type === 'refund' ? 'Refund' : a.type === 'void' ? 'Void' : 'Cancel';
    if (!tags.some((x) => x.key === `wait-${a.type}`)) tags.push({ key: `wait-${a.type}`, label: `${what} waiting`, tone: 'warning', icon: 'timer-sand' });
  }
  if (open) {
    const ready = count('ready');
    const preparing = count('preparing');
    const accepted = count('accepted');
    const sent = count('sent');
    const served = count('delivered');
    if (ready) tags.push({ key: 'ready', label: `${ready} ready`, tone: 'success', icon: 'check-circle-outline' });
    if (preparing) tags.push({ key: 'preparing', label: `${preparing} preparing`, tone: 'warning', icon: 'pot-steam-outline' });
    if (accepted) tags.push({ key: 'accepted', label: `${accepted} accepted`, tone: 'primary', icon: 'check' });
    if (sent) tags.push({ key: 'sent', label: `${sent} sent`, tone: 'neutral', icon: 'send-outline' });
    if (served && !ready && !preparing && !accepted && !sent) tags.push({ key: 'served', label: 'All served', tone: 'primary', icon: 'check-all' });
    else if (served) tags.push({ key: 'served', label: `${served} served`, tone: 'neutral', icon: 'check-all' });
    if (order.paid_total > 0) tags.push({ key: 'part-paid', label: 'Part paid', tone: 'warning', icon: 'cash-clock' });
    else if (order.bill_requested_at) tags.push({ key: 'bill', label: order.at_counter ? 'Bill at counter' : 'Bill requested', tone: 'error', icon: 'receipt-text-outline' });
  } else if (order.status === 'paid') {
    tags.push({ key: 'paid', label: 'Paid', tone: 'success', icon: 'cash-check' });
  } else {
    tags.push({ key: 'closed', label: 'Closed', tone: 'neutral', icon: 'cash-check' });
  }
  if (order.discount_amount > 0) tags.push({ key: 'discount', label: order.discount_type === 'amount' ? 'Discount' : `${order.discount_value}% off`, tone: 'primary', icon: 'tag-outline' });
  return tags.length ? tags : [{ key: order.status, ...ORDER_STATUS[order.status] }];
}

// Table states as the floor shows them. `tint` and `line` are theme colour names for the card.
export const TABLE_STATUS = {
  free: { label: 'Available', short: 'Free', tone: 'neutral', icon: 'check', tint: 'card', line: 'border', dot: 'success' },
  occupied: { label: 'Occupied', short: 'Seated', tone: 'primary', icon: 'account-check-outline', tint: 'primaryTint', line: 'primary', dot: 'primary' },
  order_placed: { label: 'Occupied', short: 'Order placed', tone: 'primary', icon: 'send-check-outline', tint: 'primaryTint', line: 'primary', dot: 'primary' },
  preparing: { label: 'Preparing', short: 'Preparing', tone: 'warning', icon: 'pot-steam-outline', tint: 'warningTint', line: 'warning', dot: 'warning' },
  ready: { label: 'Ready to serve', short: 'Ready', tone: 'success', icon: 'check-circle-outline', tint: 'successTint', line: 'success', dot: 'success' },
  all_delivered: { label: 'Served', short: 'Served', tone: 'primary', icon: 'check-all', tint: 'primaryTint', line: 'primary', dot: 'primary' },
  needs_payment: { label: 'Bill requested', short: 'Bill requested', tone: 'error', icon: 'receipt-text-outline', tint: 'errorTint', line: 'error', dot: 'error' },
  paid: { label: 'Paid', short: 'Paid', tone: 'success', icon: 'cash-check', tint: 'successTint', line: 'success', dot: 'success' },
  split: { label: 'Split', short: 'Split', tone: 'neutral', icon: 'call-split', tint: 'card', line: 'border', dot: 'textSecondary' },
};

// The filters above the floor and the list. A table or order belongs to exactly one.
export const FLOOR_FILTERS = [
  { key: 'free', label: 'Available', statuses: ['free'] },
  { key: 'occupied', label: 'Occupied', statuses: ['occupied', 'order_placed', 'all_delivered', 'paid'] },
  { key: 'preparing', label: 'Preparing', statuses: ['preparing'] },
  { key: 'ready', label: 'Ready to serve', statuses: ['ready'] },
  { key: 'bill', label: 'Bill requested', statuses: ['needs_payment'] },
];

export const TYPE_LABEL = { dine_in: 'Dine-in', delivery: 'Delivery', takeaway: 'Takeaway' };
export const TYPE_ICON = { dine_in: 'silverware-fork-knife', delivery: 'moped-outline', takeaway: 'car-outline' };

export const METHODS = {
  cash: { label: 'Cash', icon: 'cash' },
  upi: { label: 'UPI', icon: 'qrcode-scan' },
  card: { label: 'Card', icon: 'credit-card-outline' },
  paytm: { label: 'Paytm', icon: 'wallet-outline' },
  phonepe: { label: 'PhonePe', icon: 'cellphone-text' },
  other: { label: 'Other', icon: 'dots-horizontal' },
  split: { label: 'Split', icon: 'call-split' },
};
export const methodLabel = (key) => METHODS[key]?.label ?? key;

export const itemsWith = (order, ...statuses) => order.items.filter((i) => statuses.includes(i.status));
export const readyItems = (order) => itemsWith(order, 'ready');
export const unavailableItems = (order) => itemsWith(order, 'unavailable');

// Dishes that count on the bill and on "5 items": everything not dead.
export const liveItems = (order) => order.items.filter((i) => !DEAD.includes(i.status));
export const itemCount = (order) => liveItems(order).reduce((n, i) => n + i.qty, 0);

// Nothing left to cook or deliver: every dish is delivered or dead. Only then can the bill be asked for.
export const allSettled = (order) => order.items.every((i) => i.status === 'delivered' || DEAD.includes(i.status));

// What is still to pay.
export const amountDue = (order) => Math.max(0, Math.round((order.total - (order.paid_total || 0)) * 100) / 100);
export const goodPayments = (order) => (order.payments || []).filter((p) => p.status === 'successful');
export const refundedTotal = (order) => goodPayments(order).filter((p) => p.kind === 'refund').reduce((sum, p) => sum + p.amount, 0);

// Requests still waiting for a manager.
export const cancelRequested = (order, itemId) =>
  order.pending_approvals.some((a) => (a.type === 'cancel' || a.type === 'void') && a.order_item_id === itemId);
export const pendingDiscount = (order) => order.pending_approvals.find((a) => a.type === 'discount') ?? null;

// The discount on a bill in words: "20%" or "₹100".
export const discountText = (order) =>
  order.discount_amount > 0 ? (order.discount_type === 'amount' ? 'fixed' : `${order.discount_value}%`) : null;

export const APPROVAL_TYPES = {
  discount: { label: 'Discount', title: 'Discount Approval', icon: 'tag-outline', tone: 'primary' },
  cancel: { label: 'Cancellation', title: 'Cancellation Approval', icon: 'close-circle-outline', tone: 'error' },
  void: { label: 'Void', title: 'Void Item Approval', icon: 'delete-outline', tone: 'warning' },
  refund: { label: 'Refund', title: 'Refund Approval', icon: 'cash-refund', tone: 'warning' },
};
