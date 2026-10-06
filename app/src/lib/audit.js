// Turns an audit-log row into a sentence a manager can read at a glance.

const pct = (v) => `${v}%`;

const WORDS = {
  'order.create': (e) => `Sent order #${e.new?.number} to the kitchen (${e.new?.items} items)`,
  'order.addItems': (e) => `Added ${(e.new?.items || []).join(', ')}`,
  'item.edit': (e) => `Edited an item: ${e.old?.qty}× → ${e.new?.qty}×${e.new?.size ? ` ${e.new.size}` : ''}`,
  'item.remove': (e) => `Removed ${e.old?.qty}× ${e.old?.name}`,
  'item.unavailable': (e) => `Kitchen could not make ${e.new?.itemIds?.length} item(s): ${e.new?.reason}`,
  'cancel.request': (e) => `Asked to cancel a cooking item: ${e.new?.reason}`,
  'cancel.approved': (e) => `Approved the cancel${e.new?.reason ? ` (${e.new.reason})` : ''}`,
  'cancel.rejected': (e) => `Rejected the cancel${e.new?.decision_reason ? `: ${e.new.decision_reason}` : ''}`,
  'discount.apply': (e) => `Applied ${pct(e.new?.pct)} discount (was ${pct(e.old?.pct)})`,
  'discount.request': (e) => `Asked for ${pct(e.new?.pct)} discount${e.new?.reason ? `: ${e.new.reason}` : ''}`,
  'discount.approved': (e) => `Approved ${pct(e.new?.pct)} discount`,
  'discount.rejected': (e) => `Rejected ${pct(e.new?.pct)} discount${e.new?.decision_reason ? `: ${e.new.decision_reason}` : ''}`,
  'payment.mark': (e) => `Took payment by ${e.new?.method}: ₹${e.new?.total}`,
  'payment.counter': (e) => `Sent the bill (₹${e.new?.total}) to the manager counter`,
  'menu.add': (e) => `Added menu item ${e.new?.code} ${e.new?.name}`,
  'menu.edit': (e) => `Edited a menu item (${Object.keys(e.new || {}).join(', ')})`,
  'menu.out_of_stock': () => 'Marked a menu item out of stock',
  'menu.available': () => 'Marked a menu item available',
  'user.add': (e) => `Added ${e.new?.name} (${e.new?.role}, ${e.new?.login_id})`,
  'user.edit': (e) => `Changed a staff member: ${Object.keys(e.new || {}).join(', ')}`,
  'otp.generate': () => 'Made a one-time login code',
  'pin.set': () => 'Changed their approval PIN',
  'restaurant.edit': () => 'Changed the restaurant settings',
};

export const describe = (entry) => (WORDS[entry.action] ? WORDS[entry.action](entry) : entry.action);

export const when = (iso) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The start and end of a local day as ISO times, for the report and history endpoints.
// offset 0 = today, -1 = yesterday.
export function dayRange(offset = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString(), label: offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) };
}

export const rangeQuery = (range) => `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
