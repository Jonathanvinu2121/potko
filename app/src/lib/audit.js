// Turns an audit-log row into a sentence a manager can read at a glance.
import { money, plural } from './format';
import { methodLabel } from './orders';
import { ROLE_LABEL } from './roles';

const pct = (v) => `${v}%`;
// "20% discount" or "₹100 off", from the new discount fields or the older percent-only ones.
const discount = (d = {}) => (d.type === 'amount' ? `${money(d.value)} off` : `${pct(d.value ?? d.pct ?? 0)} discount`);
const because = (e, text = e.reason || e.new?.reason) => (text ? `: ${text}` : '');
const table = (label) => (label ? `table ${label}` : 'a table');

const CHANGED = {
  name: 'name', login_id: 'login ID', role: 'role', active: 'active or inactive', discount_limit_pct: 'discount limit', password: 'password',
  pin: 'PIN', phone: 'phone', email: 'email', image_id: 'photo', access: 'areas and tables', can_collect_payment: 'payment permission',
  permissions: 'permissions', terminals: 'kitchen terminals',
};
const fields = (changes = {}) => Object.keys(changes).map((k) => CHANGED[k] ?? k.replace(/_/g, ' ')).join(', ');

const WORDS = {
  'order.create': (e) => `Sent order #${e.new?.number} to the kitchen (${plural(e.new?.items ?? 0, 'item')})`,
  'order.addItems': (e) => `Added ${(e.new?.items || []).join(', ')}`,
  'item.edit': (e) => `Edited an item: ${e.old?.qty}× → ${e.new?.qty}×${e.new?.size ? ` ${e.new.size}` : ''}`,
  'item.remove': (e) => `Removed ${e.old?.qty}× ${e.old?.name}`,
  'item.unavailable': (e) => `Kitchen could not make ${plural(e.new?.itemIds?.length ?? 1, 'item')}${because(e)}`,

  'discount.apply': (e) => `Applied ${discount(e.new)}${e.new?.amount ? ` (${money(e.new.amount)})` : ''}${because(e)}`,
  'discount.request': (e) => `Asked for ${discount(e.new)}${because(e)}`,
  'discount.approved': (e) => `Approved ${discount(e.new)}`,
  'discount.rejected': (e) => `Rejected ${discount(e.new)}${because(e, e.new?.decision_reason)}`,
  'cancel.request': (e) => `Asked to cancel a dish${because(e)}`,
  'cancel.approved': () => 'Approved the cancellation',
  'cancel.rejected': (e) => `Rejected the cancellation${because(e, e.new?.decision_reason)}`,
  'void.request': (e) => `Asked to void a dish${because(e)}`,
  'void.approved': () => 'Approved the void',
  'void.rejected': (e) => `Rejected the void${because(e, e.new?.decision_reason)}`,
  'refund.request': (e) => `Asked for a refund of ${money(e.new?.amount)}${because(e)}`,
  'refund.approved': (e) => `Approved a refund of ${money(e.new?.amount)}`,
  'refund.rejected': (e) => `Rejected a refund${because(e, e.new?.decision_reason)}`,
  'pin.failed': () => 'Entered a wrong approval PIN',

  'bill.request': (e) => `Asked for the bill (${money(e.new?.total)})`,
  'payment.mark': (e) => `Took ${money(e.new?.amount ?? e.new?.total)} by ${methodLabel(e.new?.method)}`,
  'payment.failed': (e) => `${methodLabel(e.new?.method)} payment of ${money(e.new?.amount)} failed`,
  'payment.counter': (e) => `Sent the bill (${money(e.new?.total)}) to the counter`,
  'payment.refund': (e) => `Refunded ${money(e.new?.amount)} by ${methodLabel(e.new?.method)}${because(e)}`,
  'receipt.print': (e) => `Printed bill #${e.new?.number ?? ''}`.trim(),
  'receipt.share': (e) => `Shared bill #${e.new?.number ?? ''}`.trim(),
  'table.close': () => 'Closed the table',
  'table.split': (e) => `Split ${table(e.old?.table)} into ${(e.new?.parts || []).map((p) => p.table).join(', ')}`,
  'table.merge': (e) => `Merged ${(e.old?.tables || (e.old?.parts || []).map((p) => p.table)).join(', ')} into ${table(e.new?.table)}`,
  'table.join': (e) => `Joined ${(e.old?.tables || []).join(' + ')} for one party`,
  'table.unjoin': (e) => `Separated ${(e.new?.freed || []).join(', ')} from ${table(e.new?.table)}`,
  'table.transfer': (e) => `Moved the order from ${table(e.old?.table)} to ${table(e.new?.table)}`,

  'menu.add': (e) => `Added menu item ${e.new?.code} ${e.new?.name}`,
  'menu.edit': (e) => `Edited ${e.new?.name ?? 'a menu item'}`,
  'menu.delete': (e) => `Deleted menu item ${e.old?.name ?? ''}`.trim(),
  'menu.out_of_stock': (e) => `Switched off ${e.new?.name ?? 'a menu item'}`,
  'menu.available': (e) => `Switched ${e.new?.name ?? 'a menu item'} back on`,
  'menu.import': (e) => `Imported a menu file: ${e.new?.created ?? 0} added, ${e.new?.updated ?? 0} updated, ${e.new?.failed ?? e.new?.errors ?? 0} left out`,
  'menu.import_add': (e) => `Imported menu item ${e.new?.code ?? ''} ${e.new?.name ?? ''}`.trim(),
  'menu.import_update': (e) => `Updated a menu item from an imported file (${fields(e.new)})`,
  'category.add': (e) => `Added category ${e.new?.name}`,
  'category.import': (e) => `Imported category ${e.new?.name}`,
  'category.edit': (e) => `Edited category ${e.new?.name ?? ''}`.trim(),
  'category.delete': (e) => `Deleted category ${e.old?.name ?? ''}`.trim(),
  'menu.reorder': (e) => (e.entity_id ? 'Changed the order of the dishes in a category' : 'Changed the order of the menu categories'),

  'floor.add': (e) => `Added floor ${e.new?.name}`,
  'floor.edit': (e) => `Edited floor ${e.new?.name ?? e.old?.name ?? ''}`.trim(),
  'floor.delete': (e) => `Deleted floor ${e.old?.name ?? ''}`.trim(),
  'area.add': (e) => `Added dining area ${e.new?.name}${e.new?.tables ? ` with ${plural(e.new.tables, 'table')}` : ''}`,
  'area.edit': (e) => `Edited dining area ${e.new?.name ?? e.old?.name ?? ''}`.trim(),
  'area.delete': (e) => `Deleted dining area ${e.old?.name ?? ''}`.trim(),
  'area.reorder': () => 'Changed the order of the dining areas',
  'table.reorder': (e) => `Changed the order of the tables in ${e.new?.area ?? 'a dining area'}`,
  'table.add': (e) => `Added ${table(e.new?.label)}`,
  'table.edit': (e) => `Edited ${table(e.new?.label ?? e.old?.label)}`,
  'table.delete': (e) => `Deleted ${table(e.old?.label)}`,
  'layout.edit': (e) => `Rearranged the layout of ${e.new?.area ?? 'an area'}`,
  'terminal.add': (e) => `Added kitchen terminal ${e.new?.name}`,
  'terminal.edit': (e) => `Changed kitchen terminal ${e.old?.name ?? ''}`.trim(),
  'terminal.chefs': (e) => `Set the chefs at ${e.new?.terminal ?? 'a kitchen terminal'}: ${(e.new?.chefs || []).join(', ') || 'nobody'}`,
  'terminal.delete': (e) => `Deleted kitchen terminal ${e.old?.name ?? ''}`.trim(),

  'user.add': (e) => `Added ${e.new?.name} (${ROLE_LABEL[e.new?.role] ?? e.new?.role}, ${e.new?.login_id})`,
  'user.edit': (e) => `Changed ${fields(e.new) || 'the account'}`,
  'user.delete': (e) => `Deleted ${e.old?.name ?? 'a staff member'}`,
  'session.login': (e) => `Signed in${e.new?.developer_mode ? ' (developer mode)' : ''}${e.new?.device ? ` on ${e.new.device}` : ''}`,
  'session.logout': () => 'Signed out',
  'session.logout_all': () => 'Signed out of every device',
  'session.revoke': () => 'Was signed out of one device',
  'session.revoke_all': () => 'Was signed out of every device',
  'password.change': () => 'Changed their password',
  'otp.generate': () => 'Made a one-time login code',
  'pin.set': () => 'Changed their approval PIN',
  'restaurant.edit': () => 'Changed the restaurant settings',
};

export const describe = (entry) => (WORDS[entry.action] ? WORDS[entry.action](entry) : entry.action.replace(/[._]/g, ' '));

// A short title for an account's own timeline: "Signed in", "Password changed", "Account created".
const TITLES = {
  'user.add': 'Account created',
  'user.delete': 'Account deleted',
  'session.login': 'Signed in',
  'session.logout': 'Signed out',
  'session.logout_all': 'Signed out of every device',
  'session.revoke': 'Signed out by a manager',
  'session.revoke_all': 'Signed out of every device by a manager',
  'password.change': 'Password changed',
  'pin.set': 'Approval PIN changed',
  'pin.failed': 'Wrong approval PIN',
  'otp.generate': 'One-time login code made',
};
export function accountEvent(entry) {
  if (entry.action === 'user.edit') {
    const n = entry.new || {};
    if (n.password) return { title: 'Password reset', tone: 'warning' };
    if (n.active === false) return { title: 'Account deactivated', tone: 'error' };
    if (n.active === true) return { title: 'Account activated', tone: 'success' };
    if (n.role) return { title: `Role changed to ${ROLE_LABEL[n.role] ?? n.role}`, tone: 'primary' };
    if (n.terminals) return { title: 'Kitchen terminals updated', tone: 'primary' };
    if (n.access || n.can_collect_payment !== undefined) return { title: 'Table access updated', tone: 'primary' };
    if (n.permissions) return { title: 'Permissions updated', tone: 'primary' };
    return { title: `Profile updated (${fields(n)})`, tone: 'primary' };
  }
  const tone = entry.action === 'session.login' || entry.action === 'user.add' ? 'success' : /logout|revoke|failed|delete/.test(entry.action) ? 'error' : 'warning';
  return { title: TITLES[entry.action] ?? describe(entry), tone };
}

export const when = (iso) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The start and end of a local day as ISO times, for the history endpoints.
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
