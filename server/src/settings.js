// Restaurant settings. They live in restaurants.settings (jsonb); anything not saved yet falls back
// to the defaults here, so a restaurant set up before a setting existed still behaves sensibly.
const { AppError } = require('./errors');

const DEFAULTS = {
  payment_at: 'waiter', // kept for apps from before per-waiter payment permission
  otp_roles: [], // roles that need a one-time code at login
  timezone: 'Asia/Kolkata',
  day_start: '05:00', // the business day runs from this time to the same time tomorrow
  services: [
    { name: 'Lunch Service', from: '12:00', to: '16:00' },
    { name: 'Dinner Service', from: '19:00', to: '23:30' },
  ],
  // Tax is configured, never hard-coded. split: show the rate as CGST + SGST halves.
  tax: { rate: 5, mode: 'exclusive', split: true },
  service_charge_pct: 0, // 0 = no service charge
  round_off: true, // round the payable amount to the nearest rupee
  payment_methods: ['cash', 'upi', 'card', 'paytm', 'phonepe', 'other'],
  discount_presets: [5, 10, 15, 20, 25],
  discount_reasons: ['Regular customer', 'Birthday or celebration', 'Complaint', 'Staff or owner guest', 'Other'],
  kitchen_delay_minutes: 15, // an order waiting longer than this shows under "needs attention"
  sound: true,
  devices: { kot_printer: '', bill_printer: '', upi_id: '' },
};

function settingsOf(saved) {
  const s = saved || {};
  return {
    ...DEFAULTS,
    ...s,
    tax: { ...DEFAULTS.tax, ...(s.tax || {}) },
    devices: { ...DEFAULTS.devices, ...(s.devices || {}) },
    // A restaurant still on the old list of four gets Paytm and PhonePe too (they came with the design).
    ...(Array.isArray(s.payment_methods) && s.payment_methods.join() === 'cash,upi,card,other' ? { payment_methods: DEFAULTS.payment_methods } : {}),
  };
}

const bad = (message) => new AppError(400, 'bad_input', message);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value, max) => String(value ?? '').trim().slice(0, max);

function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Checks the settings an admin may change and returns only those, cleaned.
function readSettings(body) {
  const out = {};
  if (body.payment_at !== undefined) {
    if (!['waiter', 'counter'].includes(body.payment_at)) throw bad('Payment is taken by the waiter or at the counter');
    out.payment_at = body.payment_at;
  }
  if (body.otp_roles !== undefined) {
    const roles = ['manager', 'cashier', 'chef', 'waiter', 'admin'];
    if (!Array.isArray(body.otp_roles) || body.otp_roles.some((r) => !roles.includes(r))) throw bad('Unknown role');
    // The admin is left out on purpose: nobody else could make a code to let a locked-out admin back in.
    out.otp_roles = [...new Set(body.otp_roles)].filter((r) => r !== 'admin');
  }
  if (body.timezone !== undefined) {
    if (!validZone(body.timezone)) throw bad('Unknown time zone');
    out.timezone = body.timezone;
  }
  if (body.day_start !== undefined) {
    if (!TIME.test(body.day_start)) throw bad('The day starts at a time such as 05:00');
    out.day_start = body.day_start;
  }
  if (body.services !== undefined) {
    if (!Array.isArray(body.services) || body.services.length > 6) throw bad('Up to 6 services');
    out.services = body.services.map((s) => ({ name: text(s.name, 30), from: s.from, to: s.to }));
    if (out.services.some((s) => !s.name || !TIME.test(s.from) || !TIME.test(s.to))) throw bad('Every service needs a name and its hours, such as 19:00 to 23:30');
  }
  if (body.tax !== undefined) {
    const rate = Number(body.tax?.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw bad('The tax rate is between 0 and 100');
    if (!['inclusive', 'exclusive'].includes(body.tax?.mode)) throw bad('Prices either include tax or tax is added on top');
    out.tax = { rate: Math.round(rate * 100) / 100, mode: body.tax.mode, split: body.tax.split !== false };
  }
  if (body.service_charge_pct !== undefined) {
    const pct = Number(body.service_charge_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) throw bad('The service charge is between 0 and 30 percent');
    out.service_charge_pct = Math.round(pct * 100) / 100;
  }
  if (body.round_off !== undefined) out.round_off = body.round_off === true;
  if (body.sound !== undefined) out.sound = body.sound === true;
  if (body.kitchen_delay_minutes !== undefined) {
    const minutes = Number(body.kitchen_delay_minutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw bad('The kitchen delay alert is 5 to 120 minutes');
    out.kitchen_delay_minutes = minutes;
  }
  if (body.payment_methods !== undefined) {
    const known = ['cash', 'upi', 'card', 'paytm', 'phonepe', 'other'];
    const methods = Array.isArray(body.payment_methods) ? body.payment_methods.filter((m) => known.includes(m)) : [];
    if (methods.length === 0) throw bad('Keep at least one payment method');
    out.payment_methods = [...new Set(methods)];
  }
  if (body.discount_presets !== undefined) {
    const presets = (Array.isArray(body.discount_presets) ? body.discount_presets : []).map(Number).filter((n) => n > 0 && n <= 100);
    out.discount_presets = [...new Set(presets)].sort((a, b) => a - b).slice(0, 6);
  }
  if (body.discount_reasons !== undefined) {
    const reasons = (Array.isArray(body.discount_reasons) ? body.discount_reasons : []).map((r) => text(r, 40)).filter(Boolean);
    if (reasons.length === 0) throw bad('Keep at least one discount reason');
    out.discount_reasons = [...new Set(reasons)].slice(0, 10);
  }
  if (body.devices !== undefined) {
    // Names and addresses only. Payment-provider secrets never belong in settings the app can read.
    out.devices = {
      kot_printer: text(body.devices?.kot_printer, 80),
      bill_printer: text(body.devices?.bill_printer, 80),
      upi_id: text(body.devices?.upi_id, 80),
    };
  }
  return out;
}

// Restaurant profile: what is printed at the top of a bill.
function readProfile(body, before = {}) {
  const out = { ...before };
  for (const [key, max] of [['address', 200], ['phone', 20], ['email', 80], ['gstin', 20], ['footer', 120]]) {
    if (body[key] !== undefined) out[key] = text(body[key], max);
  }
  if (body.logo_image_id !== undefined) out.logo_image_id = Number.isInteger(body.logo_image_id) ? body.logo_image_id : null;
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw bad('Check the email address');
  return out;
}

// ---- Business time: "today" means the restaurant's day in its own time zone ----

// The parts of an instant as the restaurant's clock shows them.
function zoneParts(date, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// The instant at which the restaurant's clock shows the given wall time.
function zoneTime(zone, year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zoneParts(new Date(guess), zone);
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (shown - guess));
}

// Start of the business day that contains `now`, moved by `offsetDays`.
function businessDayStart(settings, now = new Date(), offsetDays = 0) {
  const zone = settings.timezone;
  const [h, m] = settings.day_start.split(':').map(Number);
  const p = zoneParts(now, zone);
  const beforeStart = p.hour * 60 + p.minute < h * 60 + m;
  return zoneTime(zone, p.year, p.month, p.day - (beforeStart ? 1 : 0) + offsetDays, h, m);
}

// The service running now ("Dinner Service, 19:00 to 23:30"), or the next one, or null.
function currentService(settings, now = new Date()) {
  const p = zoneParts(now, settings.timezone);
  const minute = p.hour * 60 + p.minute;
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const list = settings.services.map((s) => ({ ...s, start: toMin(s.from), end: toMin(s.to) }));
  // A service that ends after midnight (19:00 to 01:00) wraps round.
  const live = list.find((s) => (s.end > s.start ? minute >= s.start && minute < s.end : minute >= s.start || minute < s.end));
  if (live) return { name: live.name, from: live.from, to: live.to, live: true };
  const next = list.filter((s) => s.start > minute).sort((a, b) => a.start - b.start)[0] || list.slice().sort((a, b) => a.start - b.start)[0];
  return next ? { name: next.name, from: next.from, to: next.to, live: false } : null;
}

module.exports = { DEFAULTS, settingsOf, readSettings, readProfile, zoneParts, zoneTime, businessDayStart, currentService };
