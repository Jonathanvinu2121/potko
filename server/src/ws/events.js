// Live events. One WebSocket per signed-in screen: wss://host/ws?token=JWT
// Every message is JSON: { type, payload, id? }.
//   app -> server : an action. The server answers { type: 'ack', id, ok, payload | error, message }.
//   server -> app : events such as table.updated, sent to everyone in the restaurant who should see them.
const { WebSocketServer } = require('ws');
const db = require('../db');
const { verifyToken, stillValid } = require('../auth');
const { AppError } = require('../errors');
const { can } = require('../permissions');

const sockets = new Set(); // every open socket; each carries ws.user = { id, restaurantId, role, name, sessionId, perms, ... }
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
// Everyone holding a permission, e.g. the people who may decide approvals.
const toPerm = (restaurantId, permission, type, payload) => emit(restaurantId, type, payload, (u) => can(u, permission));
const toWhere = emit;
// One payload shaped for each person: shape(user) returns what that person may see, or null to send nothing.
function toEach(restaurantId, type, payload, shape) {
  for (const ws of sockets) {
    if (ws.user.restaurantId !== restaurantId) continue;
    const mine = shape(ws.user, payload);
    if (mine) send(ws, { type, payload: mine });
  }
}
// A table goes to everyone who may see it (a waiter only gets the tables assigned to them).
const tableToRestaurant = (restaurantId, table) => toEach(restaurantId, 'table.updated', table, (u, t) => require('../scope').tableFor(u, t));

// Who is connected right now: the ids of the people with at least one open screen.
function onlineUsers(restaurantId) {
  const ids = new Set();
  for (const ws of sockets) if (ws.user.restaurantId === restaurantId) ids.add(ws.user.id);
  return ids;
}
// The session ids with an open screen (for "current session" on a staff profile).
function onlineSessions(userId) {
  const ids = new Set();
  for (const ws of sockets) if (ws.user.id === userId && ws.user.sessionId) ids.add(ws.user.sessionId);
  return ids;
}

// Writes "seen now" on the session when a screen connects or goes away, and tells the manager
// screens. Online or offline is decided here, from the live connection, never by the app.
function presence(user, online) {
  if (user.sessionId) {
    db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [user.sessionId]).catch(() => {});
  }
  const stillHere = onlineUsers(user.restaurantId).has(user.id);
  if (online || !stillHere) {
    toPerm(user.restaurantId, 'staff.view', 'staff.presence', { userId: user.id, online: online || stillHere, at: new Date().toISOString() });
  }
}

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

  // The person may have been deactivated, signed out from elsewhere, or given new permissions
  // since this screen connected. (Remembered for 30 seconds, so this is rarely a query.)
  if (!(await stillValid(ws.user).catch(() => true))) return ws.close(4401, 'unauthorized');

  // Idempotency: the same action id from the same user runs once; a repeat gets the first answer.
  const key = id ? `${ws.user.id}:${id}` : null;
  let entry = key && recent.get(key);
  if (!entry) {
    entry = { result: Promise.resolve().then(() => handler(ws.user, payload || {}, id)), at: Date.now() };
    if (key) recent.set(key, entry);
  }
  try {
    // The answer is shaped like the live updates: a waiter never gets a price or bill they may not see.
    send(ws, { type: 'ack', id, ok: true, payload: require('../scope').replyFor(ws.user, await entry.result) });
  } catch (err) {
    if (key) recent.delete(key); // a failed action may be tried again
    if (!err.status) console.error(`ws ${type} failed:`, err);
    send(ws, {
      type: 'ack',
      id,
      ok: false,
      error: err.status ? err.code : 'server_error',
      message: err.status ? err.message : 'Something went wrong',
      ...(err.status && err.extra ? { data: err.extra } : null),
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
    presence(ws.user, true);

    ws.on('message', (raw) => handleMessage(ws, raw));
    early.forEach((raw) => handleMessage(ws, raw));
    const gone = () => {
      if (!sockets.delete(ws)) return;
      presence(ws.user, false);
    };
    ws.on('close', gone);
    ws.on('error', gone);
  });

  // Housekeeping: drop sockets that stopped pinging and forget old action ids.
  setInterval(() => {
    const now = Date.now();
    for (const ws of sockets) if (now - ws.lastSeen > IDLE_MS) ws.terminate();
    for (const [key, entry] of recent) if (now - entry.at > RECENT_MS) recent.delete(key);
  }, 30 * 1000).unref();

  return wss;
}

// Closes a person's open screens (they were deactivated, their role or password changed, or a
// session was ended). With sessionId, only that session's screens; with exceptSession, all others.
function kick(userId, { sessionId = null, exceptSession = null } = {}) {
  for (const ws of sockets) {
    if (ws.user.id !== userId) continue;
    if (sessionId && ws.user.sessionId !== sessionId) continue;
    if (exceptSession && ws.user.sessionId === exceptSession) continue;
    ws.close(4401, 'unauthorized');
  }
}

module.exports = { toEach, tableToRestaurant, attach, on, need, kick, toRestaurant, toRoles, toUser, toPerm, toWhere, onlineUsers, onlineSessions };
