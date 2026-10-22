// Keeps the online server awake during opening hours, and lets it sleep after them.
// Render puts a free web service to sleep after 15 minutes without a request or a WebSocket message,
// and the next phone then waits about a minute. Phones with the app open already keep it awake; this
// covers the quiet spells in between by asking the service's own public address for /health every
// 5 minutes, but only within KEEP_AWAKE_HOURS (default 09:00-23:30, the restaurant's time zone).
// Outside those hours it sleeps 15 minutes after the last phone goes quiet, which keeps the
// workspace inside Render's 750 free hours a month (all free services stop if they run out).
// It cannot wake a sleeping server: .github/workflows/wake-server.yml does that before opening.
// Off on a laptop (no public address), on the public demo, and with KEEP_AWAKE_HOURS=off.
const { DEFAULTS, zoneParts } = require('./settings');

const DEFAULT_HOURS = '09:00-23:30';
const EVERY_MS = 5 * 60 * 1000;
const HOURS = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

// "09:00-23:30" -> { from: 540, to: 1410 } (minutes after midnight). An end before the start
// ("18:00-02:00") runs past midnight; "09:00-00:00" means until midnight. Anything else -> null.
function readHours(text) {
  const m = HOURS.exec(String(text ?? '').replace(/\s+/g, ''));
  return m ? { text: `${m[1]}:${m[2]}-${m[3]}:${m[4]}`, from: Number(m[1]) * 60 + Number(m[2]), to: Number(m[3]) * 60 + Number(m[4]) } : null;
}

// True when the restaurant's clock is within the hours.
function isOpen(hours, now = new Date(), zone = DEFAULTS.timezone) {
  const p = zoneParts(now, zone);
  const minute = p.hour * 60 + p.minute;
  return hours.to > hours.from ? minute >= hours.from && minute < hours.to : minute >= hours.from || minute < hours.to;
}

const state = { hours: null, lastPing: null };

// What /health reports: the hours, and when the last keep-awake request came back (null when off).
const status = () => (state.hours ? { hours: state.hours.text, lastPing: state.lastPing } : null);

// Starts the pings and returns the timer, or null when keeping awake does not apply here.
function keepAwake({ url = process.env.RENDER_EXTERNAL_URL, hours = process.env.KEEP_AWAKE_HOURS, every = EVERY_MS } = {}) {
  if (!url || process.env.POTKO_DEMO === 'in-memory' || /^\s*off\s*$/i.test(hours || '')) return null;
  let window = readHours(hours || DEFAULT_HOURS);
  if (!window) {
    console.log(`KEEP_AWAKE_HOURS should look like ${DEFAULT_HOURS}; using ${DEFAULT_HOURS}.`);
    window = readHours(DEFAULT_HOURS);
  }
  state.hours = window;
  const target = `${url.replace(/\/+$/, '')}/health`;
  const timer = setInterval(async () => {
    if (!isOpen(window)) return;
    try {
      const res = await fetch(target, { headers: { 'user-agent': 'potko-keep-awake' }, signal: AbortSignal.timeout(30000) });
      if (res.ok) state.lastPing = new Date().toISOString();
      else console.log(`Keep-awake request answered ${res.status}`);
    } catch (err) {
      console.log(`Keep-awake request failed: ${err.message}`);
    }
  }, every);
  timer.unref(); // never holds the process open on its own
  console.log(`Keeping the server awake ${window.text} (${DEFAULTS.timezone}) with a request every ${Math.round(every / 60000)} min`);
  return timer;
}

module.exports = { DEFAULT_HOURS, readHours, isOpen, keepAwake, status };
