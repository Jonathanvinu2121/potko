// What each person is sent. The server is the one place that decides it: a screen never receives
// a table, a ticket or a price it is not meant to see, so hiding something in the app is never
// the only guard.
//   waiter   only the dining areas and tables assigned to them, and only their own orders
//   chef     only the dishes at their kitchen terminals (an order with none of them is not sent)
//   anyone without "may see prices"   dish prices are taken out; bill totals stay, because a
//            waiter who takes payments still needs the amount to collect
//   anyone without "may see bills" (a waiter who does not take payment)   the bill's amounts are
//            taken out as well: totals, tax, payments, and the amounts on their own requests
const { can } = require('./permissions');
const { tableAllowed } = require('./tables');

// An order's money, as the bill shows it. Sent as null to someone who may not see bills.
const BILL_FIELDS = ['subtotal', 'discount_amount', 'discount_pct', 'discount_value', 'taxable', 'tax_total', 'tax_lines',
  'service_charge', 'round_off', 'split_adjust', 'total', 'paid_total'];
// Amounts a request carries (the bill before and after it, the dish's price, what was paid).
const REQUEST_AMOUNTS = ['amount', 'total_before', 'total_after', 'paid', 'value'];

const isWaiter = (user) => user.role === 'waiter';
const isChef = (user) => user.role === 'chef';
const terminalsOf = (user) => (Array.isArray(user.terminals) ? user.terminals : []);

// The terminals a sent dish shows at (older lines carry only terminal_id).
const lineTerminals = (line) => (line.terminal_ids?.length ? line.terminal_ids : [line.terminal_id]);
const atMyTerminals = (user, line) => lineTerminals(line).some((id) => terminalsOf(user).includes(id));

function tableFor(user, table) {
  if (!table) return null;
  if (isWaiter(user) && !tableAllowed(user.access, table)) return null;
  if (!can(user, 'bills.view') && table.order_total != null) return { ...table, order_total: null };
  return table;
}

function areaFor(user, area) {
  const areas = user.access?.areas;
  if (!isWaiter(user) || !areas || Object.keys(areas).length === 0) return area;
  return areas[String(area.id)] ? area : null;
}

function withoutLinePrices(line) {
  const { unit_price, ...rest } = line;
  return { ...rest, addons: (line.addons || []).map(({ price, ...a }) => a) };
}

function orderFor(user, order) {
  if (!order) return null;
  if (isWaiter(user) && order.waiter_id !== user.id && !can(user, 'orders.view')) return null;
  let items = order.items || [];
  if (isChef(user)) {
    items = items.filter((line) => atMyTerminals(user, line));
    if (items.length === 0) return null;
  }
  if (!can(user, 'prices.view')) items = items.map(withoutLinePrices);
  if (!can(user, 'bills.view')) return { ...withoutBill(order), items };
  return { ...order, items };
}

function withoutAmounts(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = { ...payload };
  for (const key of REQUEST_AMOUNTS) delete out[key];
  return out;
}

function withoutBill(order) {
  const out = { ...order };
  for (const key of BILL_FIELDS) if (key in out) out[key] = null;
  out.payments = (order.payments || []).map(({ amount, received, change_due, ...p }) => p);
  out.pending_approvals = (order.pending_approvals || []).map((a) => ({ ...a, payload: withoutAmounts(a.payload) }));
  return out;
}

// A manager request as this person may see it: their own request without the bill's amounts when
// they may not see bills.
function approvalFor(user, approval) {
  if (!approval || can(user, 'bills.view')) return approval;
  return { ...approval, order_subtotal: null, order_total: null, item_amount: null, payload: withoutAmounts(approval.payload) };
}

// What a waiter gets back from their own action: an order, a table or a request shaped exactly as
// the live updates send it to them (no prices or bill they may not see).
// (Split and merge answers carry bill summaries, not orders: floor.js shapes those itself.)
const isOrder = (value) => !!value && Array.isArray(value.items) && 'waiter_id' in value;
const isTable = (value) => !!value && 'seats' in value && 'area_id' in value && !('items' in value);
function replyFor(user, result) {
  if (!isWaiter(user) || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (isOrder(result)) return orderFor(user, result);
  if ('requested_by' in result && 'payload' in result) return approvalFor(user, result);
  if (isTable(result)) return tableFor(user, result);
  const out = { ...result };
  if (isOrder(out.order)) out.order = orderFor(user, out.order);
  if (Array.isArray(out.orders)) out.orders = out.orders.map((o) => (isOrder(o) ? orderFor(user, o) : o)).filter(Boolean);
  if (Array.isArray(out.tables)) out.tables = out.tables.map((t) => (isTable(t) ? tableFor(user, t) : t)).filter(Boolean);
  if (isTable(out.table)) out.table = tableFor(user, out.table);
  return out;
}

// A dish as it appears on the menu for this person.
function itemFor(user, item) {
  if (can(user, 'prices.view')) return item;
  const { price, ...rest } = item;
  return {
    ...rest,
    sizes: (item.sizes || []).map(({ price: p, ...s }) => s),
    modifier_groups: (item.modifier_groups || []).map((g) => ({ ...g, options: (g.options || []).map(({ price: p, ...o }) => o) })),
    price_hidden: true,
  };
}

// The menu for this person. A chef gets only the dishes cooked at their terminals.
function menuFor(user, menu, defaultTerminalId) {
  let items = menu.items;
  if (isChef(user)) {
    const mine = terminalsOf(user);
    items = items.filter((m) => {
      const at = m.terminal_ids?.length ? m.terminal_ids : [m.terminal_id ?? defaultTerminalId];
      return at.some((id) => mine.includes(id));
    });
    const used = new Set(items.map((m) => m.category_id));
    return { categories: menu.categories.filter((c) => used.has(c.id)), items: items.map((m) => itemFor(user, m)) };
  }
  return { ...menu, items: items.map((m) => itemFor(user, m)) };
}

module.exports = { tableFor, areaFor, orderFor, approvalFor, replyFor, itemFor, menuFor, atMyTerminals, lineTerminals };
