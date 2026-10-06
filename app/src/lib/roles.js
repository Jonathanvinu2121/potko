// The four roles, in the order they appear on the role screen, and each role's home screen.
export const ROLES = [
  { key: 'admin', label: 'Admin', icon: 'shield-outline', home: '/dashboard' },
  { key: 'manager', label: 'Manager', icon: 'briefcase-outline', home: '/dashboard' },
  { key: 'chef', label: 'Chef', icon: 'chef-hat', home: '/board' },
  { key: 'waiter', label: 'Waiter', icon: 'room-service-outline', home: '/new-order' },
];

export const roleInfo = (key) => ROLES.find((r) => r.key === key);
export const homeFor = (key) => roleInfo(key)?.home ?? '/role';
