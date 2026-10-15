// Test helpers: a throwaway database in memory with the demo data, the real server on a free
// port, and small clients for REST and for live actions.
const fs = require('fs');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
// The demo logins are documented at the top of the seed file; the tests read them from there.
const seed = sql('seed.sql');
const PASSWORD = /Password for all[^:]*:\s*(\S+)/.exec(seed)[1];
const PIN = /Approval PIN[^:]*:\s*(\S+)/.exec(seed)[1];

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

let running = null;

// Starts everything once per test file.
async function startAll() {
  if (running) return running;
  const pg = await PGlite.create(); // in memory
  await pg.exec(sql('schema.sql'));
  const { migrate } = require('../src/migrate');
  await migrate({ run: (text) => pg.exec(text), rows: async (text) => (await pg.query(text)).rows });
  await pg.exec(seed);
  const dbPort = await freePort();
  const socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: '127.0.0.1', maxConnections: 4 });
  await socket.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
  process.env.JWT_SECRET = 'test-secret-not-used-anywhere-else';
  const { server, start } = require('../src/index');
  await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  running = {
    base,
    pg,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await require('../src/db').pool.end();
      await socket.stop();
      await pg.close();
    },
  };
  return running;
}

async function call(base, pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

// Signs a demo user in and opens their live connection.
//   me.get/post/patch/put/del(path, body)  REST, answers { status, data }
//   me.send(type, payload)                 a live action; throws with .code on refusal
//   me.try(type, payload)                  the same, answering { ok, payload | error, message }
async function signIn(base, loginId, role, { live = true, password = PASSWORD } = {}) {
  const r = await call(base, '/auth/login', { method: 'POST', body: { loginId, password, role } });
  if (r.status !== 200) throw new Error(`login ${loginId}: ${r.status} ${JSON.stringify(r.data)}`);
  const me = { token: r.data.token, user: r.data.user, restaurant: r.data.restaurant, events: [] };
  for (const [name, method] of [['get', 'GET'], ['post', 'POST'], ['patch', 'PATCH'], ['put', 'PUT'], ['del', 'DELETE']]) {
    me[name] = (pathname, body) => call(base, pathname, { token: me.token, method, body });
  }
  if (!live) return me;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(me.token)}`);
    const waiting = new Map();
    let n = 0;
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('close', (code) => { me.closedWith = code; });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type !== 'ack') return me.events.push(msg);
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.ok) w.resolve(msg.payload);
      else w.reject(Object.assign(new Error(msg.message), { code: msg.error }));
    });
    me.send = (type, payload = {}, id = `t-${Date.now()}-${++n}`) => new Promise((res, rej) => {
      waiting.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ type, payload, id }));
    });
    me.try = (type, payload, id) => me.send(type, payload, id).then((p) => ({ ok: true, payload: p }), (err) => ({ ok: false, error: err.code, message: err.message }));
    me.close = () => ws.close();
  });
  return me;
}

const live = (order) => order.items.filter((i) => !['unavailable', 'removed', 'cancelled'].includes(i.status));

module.exports = { startAll, signIn, call, live, PIN, PASSWORD };
