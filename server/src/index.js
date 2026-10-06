// POTKO server: REST (login and data) and WebSocket (live events) in one service.
require('dotenv').config({ quiet: true });

const http = require('http');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { requireAuth } = require('./auth');
const ws = require('./ws/events');
require('./ws/orders'); // registers the waiter's order actions
require('./ws/tables'); // registers table locking and the stale-lock sweep
require('./ws/chef'); // registers the kitchen actions
require('./ws/billing'); // registers discounts, approvals, closing and payment

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Render pings this to check the service is up. It does not touch the database.
app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth'));

// Everything below needs a valid token. Every query is filtered by the token's restaurant.
app.use(requireAuth);
app.use('/me', require('./routes/me'));
app.use('/sync', require('./routes/sync'));
app.use('/menu', require('./routes/menu'));
app.use('/orders', require('./routes/orders')); // recent customers (before the manager's /orders/:id)
app.use('/users', require('./routes/users'));
app.use('/', require('./routes/manage')); // restaurant, tables, order history, reports, audit

app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'No such endpoint' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.code) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json', message: 'Request body was not valid JSON' });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong' });
});

const server = http.createServer(app);
ws.attach(server);

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`POTKO server listening on port ${port}`);
  // On a laptop: the address phones on the same Wi-Fi type into the app (first screen, "Server").
  if (process.env.RENDER) return;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`Phones on this network use: http://${a.address}:${port}`);
    }
  }
});
