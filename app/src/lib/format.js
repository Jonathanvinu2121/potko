// Indian digit grouping: 1,420 / 12,34,567.
function group(whole) {
  if (whole.length <= 3) return whole;
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last}`;
}

// ₹640, ₹1,420, or ₹19.20 when there are paise.
export const money = (amount) => {
  const n = Number(amount) || 0;
  const [whole, paise] = (Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(2)).split('.');
  return `${n < 0 ? '−' : ''}₹${group(whole)}${paise ? `.${paise}` : ''}`;
};

// Always two decimals: for tax lines on a bill, where ₹32.00 and ₹32.50 should line up.
export const money2 = (amount) => {
  const n = Number(amount) || 0;
  const [whole, paise] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}₹${group(whole)}.${paise}`;
};

export const count = (n) => group(String(Math.round(Number(n) || 0)));

// "T5" reads as "Table 5"; any other label is shown as it is.
export const tableName = (label = '') => (/^T\d+(\.\d+)?$/i.test(label) ? `Table ${label.slice(1)}` : label);

// How an order is named everywhere: Table 5 / Delivery – Rahul / Car – PB10AB1234.
// Works for a saved order (snake_case from the server) and for the draft being built.
export function orderLabel(order) {
  const name = order.customer_name ?? order.customerName;
  const car = order.car_number ?? order.carNumber;
  if (order.type === 'dine_in') return tableName(order.table_label ?? order.table?.label);
  if (order.type === 'delivery') return `Delivery – ${name}`;
  return `Car – ${car || name}`;
}

// 8 -> "8 min", 75 -> "1 h 15 min"
export const duration = (minutes) => {
  const m = Math.max(0, Math.round(minutes));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};

// "8 min ago", "3 hours ago", "Yesterday", "12 Oct"
export function ago(iso, now = Date.now()) {
  if (!iso) return 'Never';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} hour${minutes < 120 ? '' : 's'} ago`;
  if (minutes < 60 * 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

// How long a table has been going, short enough for a table card: 18m, 2h 5m, 3d.
export const elapsed = (minutes) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 100) return `${m}m`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h${m % 60 && m < 600 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(m / 1440)}d`;
};

export const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "Today, 10:24 AM", "Yesterday, 9:10 PM", "12 Oct 2026, 4:20 PM"
export function dayTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return `${day}, ${clock(iso)}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
