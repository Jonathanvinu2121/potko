// Keeping the online server awake: only within the opening hours (the restaurant's clock, including
// hours that run past midnight), never on a laptop, the public demo or with KEEP_AWAKE_HOURS=off.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { readHours, isOpen, keepAwake, status } = require('../src/keep-awake');

const at = (iso) => new Date(iso); // instants in UTC; India is UTC+5:30

test('opening hours are read as HH:MM-HH:MM and anything else is refused', () => {
  assert.deepEqual(readHours('09:00-23:30'), { text: '09:00-23:30', from: 540, to: 1410 });
  assert.deepEqual(readHours(' 18:00 - 02:00 '), { text: '18:00-02:00', from: 1080, to: 120 });
  for (const bad of ['', '9-23', '09:00', '24:00-02:00', '09:60-10:00', 'always']) assert.equal(readHours(bad), null, bad);
});

test('the server is kept awake only within the hours, on the restaurant clock', () => {
  const day = readHours('09:00-23:30');
  assert.equal(isOpen(day, at('2026-10-22T03:29:00Z')), false); // 08:59 in India
  assert.equal(isOpen(day, at('2026-10-22T03:30:00Z')), true); // 09:00
  assert.equal(isOpen(day, at('2026-10-22T17:59:00Z')), true); // 23:29
  assert.equal(isOpen(day, at('2026-10-22T18:00:00Z')), false); // 23:30

  const late = readHours('18:00-02:00'); // runs past midnight
  assert.equal(isOpen(late, at('2026-10-22T12:29:00Z')), false); // 17:59
  assert.equal(isOpen(late, at('2026-10-22T12:30:00Z')), true); // 18:00
  assert.equal(isOpen(late, at('2026-10-22T20:29:00Z')), true); // 01:59
  assert.equal(isOpen(late, at('2026-10-22T20:30:00Z')), false); // 02:00

  const untilMidnight = readHours('09:00-00:00');
  assert.equal(isOpen(untilMidnight, at('2026-10-22T18:29:00Z')), true); // 23:59
  assert.equal(isOpen(untilMidnight, at('2026-10-22T18:30:00Z')), false); // 00:00
});

test('nothing is kept awake on a laptop, on the public demo, or when switched off', () => {
  assert.equal(keepAwake({ url: undefined, hours: '09:00-23:30' }), null);
  assert.equal(keepAwake({ url: 'https://example.onrender.com', hours: 'off' }), null);
  process.env.POTKO_DEMO = 'in-memory';
  try {
    assert.equal(keepAwake({ url: 'https://example.onrender.com', hours: '09:00-23:30' }), null);
  } finally {
    delete process.env.POTKO_DEMO;
  }
});

test('within the hours the server asks its own address for /health, and says so on /health', async () => {
  let asked = 0;
  const site = http.createServer((req, res) => {
    if (req.url === '/health') asked += 1;
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  const timer = keepAwake({ url: `http://127.0.0.1:${site.address().port}/`, hours: '00:00-00:00', every: 25 }); // all day
  try {
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(asked >= 2, `asked ${asked} times`);
    assert.equal(status().hours, '00:00-00:00');
    assert.ok(Date.now() - Date.parse(status().lastPing) < 1000);
  } finally {
    clearInterval(timer);
    await new Promise((resolve) => site.close(resolve));
  }
});

test('hours that cannot be read fall back to the default instead of keeping it awake all day', () => {
  const timer = keepAwake({ url: 'https://example.onrender.com', hours: '9am to 11pm', every: 60000 });
  clearInterval(timer);
  assert.equal(status().hours, '09:00-23:30');
});
