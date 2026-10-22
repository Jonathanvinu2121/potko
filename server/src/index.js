// POTKO server: REST (login and data) and WebSocket (live events) in one service.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { migratePool } = require('./migrate');
const { requireAuth } = require('./auth');
const ws = require('./ws/events');
require('./ws/orders'); // registers the order actions
require('./ws/tables'); // registers table locking and the stale-lock sweep
require('./ws/chef'); // registers the kitchen actions
require('./ws/billing'); // registers discounts, approvals, the bill, payments and closing
require('./ws/floor'); // registers split, merge and transfer

const app = express();
app.use(cors());
// Almost every request is a few lines of JSON. Only uploads (a menu file, a picture) are allowed to be big.
const smallJson = express.json({ limit: '100kb' });
const uploadJson = express.json({ limit: '8mb' });
app.use((req, res, next) => (/^\/(menu\/import\/preview|images)\/?$/.test(req.path) ? uploadJson : smallJson)(req, res, next));

// Render pings this to check the service is up. It does not touch the database.
app.get('/health', (req, res) => res.json({ ok: true }));

// The public demo (src/demo.js) serves the web app from this same address. A page the browser asks
// for (Accept: text/html, a path without a file extension) gets the app; the app's own calls ask
// for JSON and reach the routes below.
const web = process.env.POTKO_WEB_DIR;
if (web && fs.existsSync(path.join(web, 'index.html'))) {
  app.use(express.static(web, { index: false, maxAge: '1h' }));
  app.get(/.*/, (req, res, next) => (/\btext\/html\b/.test(req.headers.accept || '') && !path.extname(req.path) ? res.sendFile(path.join(web, 'index.html')) : next()));
}

app.use('/auth', require('./routes/auth'));

// Everything below needs a valid token. Every query is filtered by the token's restaurant.
app.use(requireAuth);
app.use('/me', require('./routes/me'));
app.use('/sync', require('./routes/sync'));
app.use('/menu/import', require('./routes/import')); // before /menu, which it is part of
app.use('/menu', require('./routes/menu'));
app.use('/images', require('./routes/images'));
app.use('/orders', require('./routes/orders')); // recent customers (before the manager's /orders/:id)
app.use('/users', require('./routes/users'));
app.use('/reports', require('./routes/reports'));
app.use('/', require('./routes/floor')); // dining areas, tables, kitchen terminals
app.use('/', require('./routes/manage')); // restaurant, overview, order history, approvals, audit

app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json', message: 'Request body was not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large', message: 'That is too large to upload' });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong' });
});

const server = http.createServer(app);
ws.attach(server);

// Brings the database up to date (sql/migrations) and then starts listening.
// If an upgrade fails nothing is half-applied, and the server does not start on a database it does not understand.
async function start(port = process.env.PORT || 4000) {
  // A database that is just waking up (a sleeping Neon database, a local one still starting)
  // can refuse the first connection: try a few times before giving up.
  let applied;
  for (let attempt = 1; ; attempt += 1) {
    try {
      applied = await migratePool(db.pool, (line) => console.log(line));
      break;
    } catch (err) {
      const connecting = /terminated|ECONNREFUSED|ECONNRESET|timeout|EAI_AGAIN/i.test(`${err.code} ${err.message}`);
      if (!connecting || attempt >= 6) throw err;
      console.log(`Database not ready yet (${err.message}). Trying again...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (applied === null) console.log('The database is empty. Run "npm run db:setup" (demo data) or "npm run db:schema" first.');
  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`POTKO server listening on port ${server.address().port}`);
  // On a laptop: the address phones on the same Wi-Fi type into the app (first screen, "Server").
  if (process.env.RENDER) return;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`Phones on this network use: http://${a.address}:${server.address().port}`);
    }
  }
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { app, server, start };
