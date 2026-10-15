// The breadcrumb trail shown under a screen's title: where this screen sits, with every step
// before it a link back. Worked out from the screen's address, so a new screen gets a trail
// without doing anything; a screen can also pass its own.
const NAMES = {
  '/overview': 'Overview',
  '/orders': 'Tables',
  '/payments': 'Payments',
  '/more': 'More',
  '/more/menu': 'Menu',
  '/more/tables': 'Tables',
  '/more/kitchens': 'Kitchens',
  '/more/staff': 'Staff',
  '/more/reports': 'Reports',
  '/more/settings': 'Settings',
  '/new-order': 'New Order',
  '/new-order/tables': 'Tables',
  '/new-order/split': { label: 'Tables', href: '/new-order/tables' },
  '/new-order/merge': { label: 'Tables', href: '/new-order/tables' },
  '/new-order/transfer': { label: 'Tables', href: '/new-order/tables' },
  '/new-order/order': { label: 'Tables', href: '/new-order/tables' },
  '/given-orders': 'Given Orders',
  '/kitchen': { label: 'Kitchen', href: '/board' },
};

// pathname: "/more/staff/12"; title: this screen's own title (the last step, never a link).
export function crumbsFor(pathname, title) {
  const segments = String(pathname || '').split('/').filter(Boolean);
  const trail = [];
  let path = '';
  segments.forEach((segment, index) => {
    path += `/${segment}`;
    const known = NAMES[path];
    if (index === segments.length - 1) trail.push({ label: title || (typeof known === 'string' ? known : known?.label) || segment });
    else if (known) trail.push(typeof known === 'string' ? { label: known, href: path } : known);
  });
  return trail;
}
