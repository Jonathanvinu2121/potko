import { create } from 'zustand';
import { api } from '../lib/api';
import * as ws from '../lib/ws';

// The live picture of the restaurant: tables, orders, pending approvals.
// The server is the source of truth. This store only ever shows what the server last said:
// a full copy from GET /sync on every connect and reconnect, then small updates as events arrive.
export const useLive = create((set) => ({
  tables: [],
  orders: [],
  approvals: [], // requests still waiting for a manager
  readyCount: 0,
  synced: false, // true once the first /sync has arrived

  async sync() {
    try {
      const data = await api('/sync');
      set({ tables: data.tables, orders: data.orders, approvals: data.approvals, readyCount: data.readyCount, synced: true });
    } catch {
      // Still disconnected or the server is waking: the next reconnect syncs again.
    }
  },

  reset() {
    set({ tables: [], orders: [], approvals: [], readyCount: 0, synced: false });
  },
}));

// Replaces the row with the same id, or adds it if it is new.
const upsert = (list, row) => (list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row]);

ws.onOpen(() => useLive.getState().sync());
ws.on('table.updated', (table) => useLive.setState((s) => ({ tables: upsert(s.tables, table) })));
ws.on('order.created', (order) => useLive.setState((s) => ({ orders: upsert(s.orders, order) })));
ws.on('order.updated', (order) => useLive.setState((s) => ({ orders: upsert(s.orders, order) })));
ws.on('ready.count', ({ count }) => useLive.setState({ readyCount: count }));
ws.on('approval.requested', (approval) => useLive.setState((s) => ({ approvals: upsert(s.approvals, approval) })));
ws.on('approval.decided', (approval) => useLive.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== approval.id) })));
