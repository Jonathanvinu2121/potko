// The public demo: the POTKO server with a throwaway database of its own, in memory, filled with the
// demo restaurant, and the web app served from the same address. Anyone with the link signs in with
// one tap (developer mode) and can try everything.
//   - It never reads DATABASE_URL: it cannot reach a real restaurant's data.
//   - The data starts afresh on every start (on Render's free plan, after it has slept).
//   node src/demo.js        (port from PORT, else 4000)
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const sql = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');
const freePort = () => new Promise((resolve) => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

(async () => {
  const pg = await PGlite.create(); // in memory
  await pg.exec(sql('schema.sql'));
  const { migrate } = require('./migrate');
  await migrate({ run: (text) => pg.exec(text), rows: async (text) => (await pg.query(text)).rows });
  await pg.exec(sql('seed.sql'));
  // The database engine takes about 300 MB; what setting it up used is handed back before serving
  // (started with node --expose-gc), to stay well inside a small host's memory.
  global.gc?.();
  const dbPort = await freePort();
  const socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: '127.0.0.1', maxConnections: 4 });
  await socket.start();

  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
  process.env.POTKO_DEMO = 'in-memory'; // lets developer mode work on this hosted demo (routes/auth.js)
  process.env.DEV_LOGIN = 'public';
  process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
  process.env.POTKO_WEB_DIR = path.join(__dirname, '..', 'demo-web'); // the web app (index.js)
  const { start } = require('./index');
  await start(Number(process.env.PORT) || 4000);
  console.log('POTKO demo ready: the demo restaurant in memory, the web app at the same address');
})().catch((err) => {
  console.error('demo failed to start:', err.message);
  process.exit(1);
});
