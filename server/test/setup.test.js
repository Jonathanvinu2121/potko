// First-run set-up on an empty server: the client creates the restaurant and its admin from the
// app, once, with the setup code. Runs on its own in-memory database with no demo data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const { call } = require('./helpers');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let base;
let stop;
test.before(async () => {
  const pg = await PGlite.create();
  await pg.exec(sql('schema.sql'));
  const { migrate } = require('../src/migrate');
  await migrate({ run: (text) => pg.exec(text), rows: async (text) => (await pg.query(text)).rows });
  const dbPort = await freePort();
  const socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: '127.0.0.1', maxConnections: 4 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
  process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';
  delete process.env.SETUP_CODE;
  const { server, start } = require('../src/index');
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  stop = async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await require('../src/db').pool.end();
    await socket.stop();
    await pg.close();
  };
});
test.after(() => stop());

// Test values for this in-memory server only.
const form = { restaurantName: 'Test Kitchen', adminName: 'Owner', loginId: 'owner-1', password: 'test-pass-123', pin: '2468' };

test('an empty server asks for set-up, and refuses it until a setup code is configured', async () => {
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: true, ready: false });
  const refused = await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'anything' } });
  assert.equal(refused.status, 503);
  assert.equal(refused.data.error, 'setup_not_ready');
});

test('the setup code is checked, then the restaurant and its admin are created and signed in, once', async () => {
  process.env.SETUP_CODE = 'test-setup-code';
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: true, ready: true });

  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'wrong' } })).data.error, 'wrong_setup_code');
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, password: '123', setupCode: 'test-setup-code' } })).status, 400);
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, pin: '12', setupCode: 'test-setup-code' } })).status, 400);

  const made = await call(base, '/auth/setup', { method: 'POST', body: { ...form, setupCode: 'test-setup-code' } });
  assert.equal(made.status, 201);
  assert.ok(made.data.token);
  assert.equal(made.data.user.role, 'admin');
  assert.equal(made.data.user.has_pin, true);
  assert.equal(made.data.restaurant.name, 'Test Kitchen');

  // Closed for good: a second set-up is refused, and the app shows sign-in.
  assert.equal((await call(base, '/auth/setup', { method: 'POST', body: { ...form, loginId: 'someone-else', setupCode: 'test-setup-code' } })).data.error, 'setup_done');
  assert.deepEqual((await call(base, '/auth/setup')).data, { needed: false, ready: true });

  // The admin signs in with what they chose, and the restaurant starts with a dining area and a kitchen.
  const login = await call(base, '/auth/login', { method: 'POST', body: { loginId: 'owner-1', password: 'test-pass-123', role: 'admin' } });
  assert.equal(login.status, 200);
  const sync = await call(base, '/sync', { token: login.data.token });
  assert.deepEqual(sync.data.areas.map((a) => a.name), ['Main Hall']);
  assert.deepEqual(sync.data.terminals.map((k) => k.name), ['Main Kitchen']);
});
