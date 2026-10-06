// Live connection to the server: one WebSocket, reconnects by itself, pings every 25s
// (the ping also keeps the free Render service awake during service hours).
import { create } from 'zustand';
import { socketUrl } from './server';

const PING_MS = 25 * 1000;
const ACK_TIMEOUT_MS = 10 * 1000;

// status: 'offline' | 'connecting' | 'online'. lastSync: time of the last message from the server.
export const useConnection = create(() => ({ status: 'offline', lastSync: null }));

let socket = null;
let token = null;
let retries = 0;
let retryTimer = null;
let pingTimer = null;
let onUnauthorized = null;
const listeners = new Map(); // event type -> Set of callbacks
const openListeners = new Set(); // called after every connect and reconnect
const pending = new Map(); // action id -> { resolve, reject, timer }

export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

// Unique id for one action, so the server can ignore an accidental repeat.
export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function failPending(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}

function open() {
  useConnection.setState({ status: 'connecting' });
  const ws = new WebSocket(`${socketUrl()}?token=${encodeURIComponent(token)}`);
  socket = ws;

  ws.onopen = () => {
    retries = 0;
    useConnection.setState({ status: 'online', lastSync: Date.now() });
    pingTimer = setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), PING_MS);
    openListeners.forEach((fn) => fn());
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    useConnection.setState({ lastSync: Date.now() });
    if (msg.type === 'ack') {
      const waiting = pending.get(msg.id);
      if (!waiting) return;
      pending.delete(msg.id);
      clearTimeout(waiting.timer);
      if (msg.ok) waiting.resolve(msg.payload);
      else waiting.reject(Object.assign(new Error(msg.message || 'Something went wrong'), { code: msg.error }));
      return;
    }
    listeners.get(msg.type)?.forEach((fn) => fn(msg.payload));
  };

  ws.onerror = () => {}; // onclose always follows and does the work

  ws.onclose = (event) => {
    if (socket !== ws) return; // an old socket we already replaced or closed on purpose
    socket = null;
    clearInterval(pingTimer);
    useConnection.setState({ status: 'offline' });
    failPending('Connection lost. Try again.');
    if (event.code === 4401) return onUnauthorized?.(); // the server rejected the login token
    if (!token) return;
    // Reconnect with backoff: 1s, 2s, 4s, 8s, then every 10s.
    const delay = Math.min(1000 * 2 ** retries, 10000);
    retries += 1;
    retryTimer = setTimeout(open, delay);
  };
}

export function connect(authToken) {
  token = authToken;
  if (!socket) open();
}

export function disconnect() {
  token = null;
  clearTimeout(retryTimer);
  clearInterval(pingTimer);
  const ws = socket;
  socket = null;
  ws?.close();
  failPending('Signed out');
  useConnection.setState({ status: 'offline', lastSync: null });
}

// Listens for one server event type, e.g. on('table.updated', fn). Returns a function that stops listening.
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

// Runs fn after every connect and reconnect (used to re-fetch state with GET /sync).
export function onOpen(fn) {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

// Sends one action and resolves with the server's answer, or rejects with its error message.
// There is no offline queue: when disconnected the action fails straight away.
export function send(type, payload = {}, id = newId()) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return reject(new Error('Not connected. Wait for the connection and try again.'));
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The server did not answer. Try again.'));
    }, ACK_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type, payload, id }));
  });
}
