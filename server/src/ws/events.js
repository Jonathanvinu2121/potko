// Live events. One WebSocket per signed-in screen: wss://host/ws?token=JWT
// Every message is JSON: { type, payload, id? }.
//   app -> server : an action. The server answers { type: 'ack', id, ok, payload | error, message }.
//   server -> app : events such as table.updated, sent to everyone in the restaurant who should see them.
const { WebSocketServer } = require('ws');
const { verifyToken, stillValid } = require('../auth');
const { AppError } = require('../errors');

const sockets = new Set(); // every open socket; each carries ws.user = { id, restaurantId, role, name }
const handlers = {}; // message type -> async (user, payload, actionId) => result
const recent = new Map(); // "userId:actionId" -> { result: Promise, at } so a repeated action runs once

const IDLE_MS = 70 * 1000; // the app pings every 25s; a silent socket is dropped after this
const RECENT_MS = 10 * 60 * 1000;

// Registers the handler for one client -> server message type (added phase by phase).
function on(type, handler) {
  handlers[type] = handler;
}

// Role check for an action handler: need(user, 'waiter') throws unless the user has one of the roles.
function need(user, ...roles) {
  if (!roles.includes(user.role)) throw new AppError(403, 'forbidden', 'Your role cannot do this');
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// "Rooms" are a filter over the open sockets. With 3-5 restaurants that is all that is needed.
function emit(restaurantId, type, payload, only) {
  for (const ws of sockets) {
    if (ws.user.restaurantId === restaurantId && (!only || only(ws.user))) send(ws, { type, payload });
  }
}
const toRestaurant = (restaurantId, type, payload) => emit(restaurantId, type, payload);
const toRoles = (restaurantId, roles, type, payload) => emit(restaurantId, type, payload, (u) => roles.includes(u.role));
const toUser = (restaurantId, userId, type, payload) => emit(restaurantId, type, payload, (u) => u.id === userId);

async function handleMessage(ws, raw) {
  ws.lastSeen = Date.now();
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(ws, { type: 'ack', ok: false, error: 'bad_json', message: 'Message was not valid JSON' });
  }
  const { type, payload = {}, id } = msg || {};
  if (type === 'ping') return send(ws, { type: 'pong' });

  const handler = handlers[type];
  if (!handler) return send(ws, { type: 'ack', id, ok: false, error: 'unknown_type', message: `Unknown action: ${type}` });

  // Idempotency: the same action id from the same user runs once; a repeat gets the first answer.
  const key = id ? `${ws.user.id}:${id}` : null;
  let entry = key && recent.get(key);
  if (!entry) {
    entry = { result: Promise.resolve().then(() => handler(ws.user, payload, id)), at: Date.now() };
    if (key) recent.set(key, entry);
  }
  try {
    send(ws, { type: 'ack', id, ok: true, payload: await entry.result });
  } catch (err) {
    if (key) recent.delete(key); // a failed action may be tried again
    if (!err.status) console.error(`ws ${type} failed:`, err);
    send(ws, {
      type: 'ack',
      id,
      ok: false,
      error: err.status ? err.code : 'server_error',
      message: err.status ? err.message : 'Something went wrong',
    });
  }
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    // Messages that arrive while the login is being checked wait here, so none is lost.
    const early = [];
    const hold = (raw) => early.push(raw);
    ws.on('message', hold);
    try {
      const token = new URL(req.url, 'http://localhost').searchParams.get('token');
      ws.user = verifyToken(token);
      if (!(await stillValid(ws.user))) throw new Error('inactive');
    } catch {
      return ws.close(4401, 'unauthorized');
    }
    ws.off('message', hold);
    ws.lastSeen = Date.now();
    sockets.add(ws);
    send(ws, { type: 'hello', payload: { userId: ws.user.id, role: ws.user.role } });

    ws.on('message', (raw) => handleMessage(ws, raw));
    early.forEach((raw) => handleMessage(ws, raw));
    ws.on('close', () => sockets.delete(ws));
    ws.on('error', () => sockets.delete(ws));
  });

  // Housekeeping: drop sockets that stopped pinging and forget old action ids.
  setInterval(() => {
    const now = Date.now();
    for (const ws of sockets) if (now - ws.lastSeen > IDLE_MS) ws.terminate();
    for (const [key, entry] of recent) if (now - entry.at > RECENT_MS) recent.delete(key);
  }, 30 * 1000).unref();

  return wss;
}

// Closes every screen a user has open (they were deactivated, or their role or password changed).
function kick(userId) {
  for (const ws of sockets) if (ws.user.id === userId) ws.close(4401, 'unauthorized');
}

module.exports = { attach, on, need, kick, toRestaurant, toRoles, toUser };
