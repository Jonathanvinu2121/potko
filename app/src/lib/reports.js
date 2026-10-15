// Shared by the report screens: the date choices, the query they turn into, and chart labels.
// Every number comes added up from the server, in the restaurant's own business day and time zone.

export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '3m', label: '3 Months' },
  { key: '1y', label: '1 Year' },
  { key: 'custom', label: 'Custom' },
];

// period: { range, from?, to? } with from/to as YYYY-MM-DD for a custom range.
export const periodQuery = (period) =>
  period.range === 'custom' ? `range=custom&from=${period.from}&to=${period.to}` : `range=${period.range}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-09 19:00" -> "7p"; "2026-10-09" -> "9" (days), "9 Oct" (weeks), "Oct" (months).
export function bucketLabel(bucket, unit) {
  const [date, time] = bucket.split(' ');
  const [, month, day] = date.split('-').map(Number);
  if (unit === 'hour') {
    const hour = Number(time.slice(0, 2));
    return `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`;
  }
  if (unit === 'month') return MONTHS[month - 1];
  if (unit === 'week') return `${day} ${MONTHS[month - 1]}`;
  return String(day);
}

// The same bucket in full, for a screen reader and for lists: "9 Oct", "9 Oct, 7 PM".
export function bucketName(bucket, unit) {
  const [date, time] = bucket.split(' ');
  const [, month, day] = date.split('-').map(Number);
  if (unit === 'month') return `${MONTHS[month - 1]} ${date.slice(0, 4)}`;
  const base = `${day} ${MONTHS[month - 1]}`;
  if (unit === 'hour') return `${base}, ${hourName(Number(time.slice(0, 2)))}`;
  return unit === 'week' ? `Week of ${base}` : base;
}

export const hourName = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;

// How a number moved against the period before. Null when there is nothing to compare with:
// the screens then say "Not enough data" instead of inventing a percentage.
export function change(current, previous) {
  if (previous == null || !(Number(previous) > 0)) return null;
  const pct = ((Number(current) - Number(previous)) / Number(previous)) * 100;
  return { pct: Math.round(Math.abs(pct)), up: pct >= 0, flat: Math.abs(pct) < 0.5 };
}

export const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));

// YYYY-MM-DD of a day `offset` days from today, on the phone's calendar.
export function dayString(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
