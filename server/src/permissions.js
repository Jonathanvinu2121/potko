// Who may do what. A role gives a preset; a person's own record can switch single permissions on
// or off on top of it. Every route and live action checks these on the server: hiding a button
// in the app is never the authorization.
const { AppError } = require('./errors');

const PERMISSIONS = {
  'overview.view': 'See the Overview',
  'orders.view': 'See every order and the floor',
  'orders.manage': 'Add items, split, merge, transfer and close tables on any order',
  'payments.collect': 'Take payments',
  'prices.view': 'See prices on the menu and on orders',
  'bills.view': 'See bills and totals',
  'approvals.decide': 'Approve or reject requests with the PIN',
  'refunds.issue': 'Refund a paid bill',
  'tables.manage': 'Set up dining areas and tables',
  'menu.manage': 'Change the menu',
  'staff.view': 'See the staff list',
  'staff.manage': 'Add and change waiters, chefs and cashiers',
  'staff.admin': 'Add and change managers and admins, and anyone’s permissions',
  'reports.view': 'See reports',
  'settings.manage': 'Change restaurant settings',
  'audit.view': 'See the audit log',
};
const ALL = Object.keys(PERMISSIONS);

const only = (...list) => Object.fromEntries(ALL.map((p) => [p, list.includes(p)]));
const allBut = (...list) => Object.fromEntries(ALL.map((p) => [p, !list.includes(p)]));

const PRESETS = {
  admin: allBut(),
  manager: allBut('staff.admin', 'settings.manage', 'audit.view'),
  cashier: only('orders.view', 'payments.collect', 'prices.view', 'bills.view'),
  // A waiter's payment permission is their own switch (users.can_collect_payment), set below.
  waiter: only('prices.view', 'bills.view'),
  chef: only(),
};

// Who stands above whom. A person sees and manages only the roles below their own; an admin,
// at the top, sees everyone (and is the only one who can switch a manager's access off).
const RANK = { admin: 3, manager: 2, cashier: 1, waiter: 1, chef: 1 };
const outranks = (viewer, person) => (RANK[viewer.role] || 0) > (RANK[person.role] || 0);
const visibleTo = (viewer, person) => viewer.role === 'admin' || viewer.id === person.id || outranks(viewer, person);

// The roles that work in the manager workspace.
const OFFICE_ROLES = ['admin', 'manager', 'cashier'];

// Discount a person may give without anyone's approval, in percent of the items total.
function discountLimit(user) {
  if (user.role === 'admin' || user.role === 'manager') return 100;
  return Number(user.discount_limit_pct) || 0;
}

// user: a users row (role, permissions, can_collect_payment).
function permissionsOf(user) {
  const perms = { ...(PRESETS[user.role] || PRESETS.chef) };
  // A waiter's payment permission: take (bill and payment), close (closes the table, a manager or
  // cashier takes the money) or none (neither). Older records only have the yes/no switch.
  if (user.role === 'waiter') {
    const level = paymentLevel(user);
    perms['payments.collect'] = level === 'take';
    perms['tables.close'] = level !== 'none';
  } else {
    perms['tables.close'] = true;
  }
  const own = user.permissions || {};
  for (const key of ALL) if (typeof own[key] === 'boolean') perms[key] = own[key];
  // A waiter who does not take payment never sees an amount: no dish prices and no bill. One who
  // takes payment always sees the bill (dish prices follow their "Sees prices" switch).
  if (user.role === 'waiter') {
    const takes = paymentLevel(user) === 'take';
    perms['bills.view'] = takes;
    if (!takes) perms['prices.view'] = false;
  }
  // An admin can never be locked out of administering staff and settings.
  if (user.role === 'admin') {
    perms['staff.admin'] = true;
    perms['staff.manage'] = true;
    perms['staff.view'] = true;
    perms['settings.manage'] = true;
  }
  return perms;
}

const PAYMENT_LEVELS = ['take', 'close', 'none'];
function paymentLevel(user) {
  if (PAYMENT_LEVELS.includes(user.payment_access)) return user.payment_access;
  return user.can_collect_payment === false ? 'close' : 'take';
}

const can = (user, permission) => !!user?.perms?.[permission];

function need(user, permission) {
  if (!can(user, permission)) throw new AppError(403, 'forbidden', 'You do not have permission to do this');
}

// Express middleware: requirePerm('menu.manage').
const requirePerm = (...permissions) => (req, res, next) =>
  permissions.some((p) => can(req.user, p)) ? next() : next(new AppError(403, 'forbidden', 'You do not have permission to do this'));

// Reads permission changes sent by the app: only known keys, only true/false, and only where
// they differ from the role's preset (so a later change to a preset still reaches the person).
function readOverrides(role, input) {
  const preset = PRESETS[role] || {};
  const out = {};
  for (const key of ALL) {
    if (typeof input?.[key] === 'boolean' && input[key] !== preset[key]) out[key] = input[key];
  }
  if (role === 'waiter') delete out['payments.collect']; // set through can_collect_payment
  return out;
}

module.exports = { PAYMENT_LEVELS, paymentLevel, PERMISSIONS, PRESETS, OFFICE_ROLES, RANK, outranks, visibleTo, permissionsOf, discountLimit, can, need, requirePerm, readOverrides };
