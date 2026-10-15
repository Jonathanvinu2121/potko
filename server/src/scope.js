// What each person is sent. The server is the one place that decides it: a screen never receives
// a table, a ticket or a price it is not meant to see, so hiding something in the app is never
// the only guard.
//   waiter   only the dining areas and tables assigned to them, and only their own orders
//   chef     only the dishes at their kitchen terminals (an order with none of them is not sent)
//   anyone without "may see prices"   dish prices are taken out; bill totals stay, because a
//            waiter who takes payments still needs the amount to collect
const { can } = require('./permissions');
const { tableAllowed } = require('./tables');

const isWaiter = (user) => user.role === 'waiter';
const isChef = (user) => user.role === 'chef';
const terminalsOf = (user) => (Array.isArray(user.terminals) ? user.terminals : []);

// The terminals a sent dish shows at (older lines carry only terminal_id).
const lineTerminals = (line) => (line.terminal_ids?.length ? line.terminal_ids : [line.terminal_id]);
const atMyTerminals = (user, line) => lineTerminals(line).some((id) => terminalsOf(user).includes(id));

function tableFor(user, table) {
  if (!table) return null;
  if (isWaiter(user) && !tableAllowed(user.access, table)) return null;
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
  return { ...order, items };
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

module.exports = { tableFor, areaFor, orderFor, itemFor, menuFor, atMyTerminals, lineTerminals };
