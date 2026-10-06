import { create } from 'zustand';
import { newId, send } from '../lib/ws';

// The dishes a waiter is choosing, before they are sent to the kitchen. Nothing here is saved on
// the server until "Send to Kitchen": the server then looks every item and price up again itself.
// The same draft is used for a brand-new order and for adding to an order already in the kitchen.
const EMPTY = {
  type: null, // 'dine_in' | 'delivery' | 'takeaway'
  table: null, // { id, label } for dine-in
  customerName: '',
  customerPhone: '',
  deliveryAddress: '',
  carNumber: '',
  lines: [], // { key, itemId, name, code, veg, size, qty, unitPrice, customisations, note, allergyNote }
  clientId: null, // one id per send, reused on retry so a double tap cannot send twice
  addTo: null, // { orderId, replacesItemId?, replacesName? } when adding to an existing order
};

// Two lines are the same dish if everything the kitchen needs to know matches.
const sameDish = (a, b) =>
  a.itemId === b.itemId &&
  a.size === b.size &&
  a.note === b.note &&
  a.allergyNote === b.allergyNote &&
  [...a.customisations].sort().join('|') === [...b.customisations].sort().join('|');

// The server frees a locked table after 5 minutes without activity. While the waiter is adding
// or changing dishes the lock is refreshed, at most once every 20 seconds.
let lastTouch = 0;
function touchTable(draft) {
  if (!draft.table || draft.addTo || Date.now() - lastTouch < 20000) return;
  lastTouch = Date.now();
  send('table.lock', { tableId: draft.table.id }).catch(() => {});
}

export const useDraft = create((set, get) => ({
  ...EMPTY,

  // Begins a fresh order of this type, dropping any unfinished one
  // (and giving back its table, if it had one and nothing was sent).
  start(type, details = {}) {
    get().releaseTable(details.table?.id);
    set({ ...EMPTY, type, ...details, clientId: newId() });
  },

  // Begins choosing more dishes for an order that is already with the kitchen.
  // `replaces` is the unavailable dish these stand in for, if any.
  startAdd(order, replaces = null) {
    get().releaseTable();
    set({
      ...EMPTY,
      type: order.type,
      table: order.table_id ? { id: order.table_id, label: order.table_label } : null,
      customerName: order.customer_name || '',
      carNumber: order.car_number || '',
      clientId: newId(),
      addTo: { orderId: order.id, replacesItemId: replaces?.id ?? null, replacesName: replaces?.name_snapshot ?? null },
    });
  },

  // Gives back the table this unsent order was holding, unless it is the one named.
  // (A table that already has an order is never given back: the server ignores the request.)
  releaseTable(exceptId) {
    const { table, addTo } = get();
    if (table && !addTo && table.id !== exceptId) send('table.release', { tableId: table.id }).catch(() => {});
  },

  setDetails(details) {
    set(details);
  },

  // Adds a dish. The same dish asked for again just raises the quantity.
  addLine(line) {
    touchTable(get());
    const lines = get().lines;
    const match = lines.find((l) => sameDish(l, line));
    if (match) {
      set({ lines: lines.map((l) => (l === match ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l)) });
    } else {
      set({ lines: [...lines, { ...line, key: newId() }] });
    }
  },

  updateLine(key, changes) {
    touchTable(get());
    set({ lines: get().lines.map((l) => (l.key === key ? { ...l, ...changes } : l)) });
  },

  // Removes a line and returns what is needed to put it back (for Undo).
  removeLine(key) {
    const lines = get().lines;
    const index = lines.findIndex((l) => l.key === key);
    if (index < 0) return null;
    set({ lines: lines.filter((l) => l.key !== key) });
    return { line: lines[index], index };
  },

  restoreLine({ line, index }) {
    const lines = [...get().lines];
    lines.splice(Math.min(index, lines.length), 0, line);
    set({ lines });
  },

  clear() {
    set(EMPTY);
  },
}));

export const lineTotal = (line) => line.qty * line.unitPrice;

// count is the number of dishes (2× naan counts as 2), as shown on the menu's bottom bar.
export const totals = (lines) => ({
  count: lines.reduce((n, l) => n + l.qty, 0),
  subtotal: lines.reduce((sum, l) => sum + lineTotal(l), 0),
});
