// The roles, in the order they appear on the role screen, and each role's home screen.
// A cashier works in the manager's workspace (orders and payments), so there is no separate
// button for them on the first screen: they choose Manager.
export const ROLES = [
  { key: 'admin', label: 'Admin', icon: 'shield-outline', home: '/overview' },
  { key: 'manager', label: 'Manager', icon: 'briefcase-outline', home: '/overview' },
  { key: 'chef', label: 'Chef', icon: 'chef-hat', home: '/board' },
  { key: 'waiter', label: 'Waiter', icon: 'room-service-outline', home: '/new-order' },
];

const OTHER = { cashier: { key: 'cashier', label: 'Cashier', icon: 'cash-register', home: '/payments' } };

export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier', chef: 'Chef', waiter: 'Waiter' };
export const ROLE_TEXT = {
  admin: 'Full access',
  manager: 'Runs the floor and the team',
  cashier: 'Billing and payments',
  chef: 'Kitchen view only',
  waiter: 'Takes orders, serves tables',
};
export const ROLE_ICON = { admin: 'shield-crown-outline', manager: 'crown-outline', cashier: 'cash-register', chef: 'chef-hat', waiter: 'room-service-outline' };

export const roleInfo = (key) => ROLES.find((r) => r.key === key) ?? OTHER[key];
export const homeFor = (key) => roleInfo(key)?.home ?? '/role';
// The roles that use the manager workspace.
export const OFFICE_ROLES = ['admin', 'manager', 'cashier'];
