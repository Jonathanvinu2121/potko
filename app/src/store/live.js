import { create } from 'zustand';
import { api } from '../lib/api';
import * as ws from '../lib/ws';

// The live picture of the restaurant: floors, dining areas, tables, kitchen terminals, orders in progress
// and pending approvals. The server is the source of truth. This store only ever shows what the
// server last said: a full copy from GET /sync on every connect and reconnect, then small updates
// as events arrive.
export const useLive = create((set) => ({
  floors: [],
  areas: [],
  tables: [],
  terminals: [],
  orders: [],
  approvals: [], // requests still waiting for a manager
  readyCount: 0,
  online: {}, // user id -> true while that person has a screen connected (manager screens only)
  synced: false, // true once the first /sync has arrived

  async sync() {
    try {
      const data = await api('/sync');
      set({
        floors: data.floors ?? [],
        areas: data.areas ?? [],
        tables: data.tables,
        terminals: data.terminals ?? [],
        orders: data.orders,
        approvals: data.approvals,
        readyCount: data.readyCount,
        synced: true,
      });
    } catch {
      // Still disconnected or the server is waking: the next reconnect syncs again.
    }
  },

  // Floors, areas, tables and terminals only (after someone changed the floor set-up).
  async syncFloor() {
    try {
      const [floors, areas, tables, terminals] = await Promise.all([api('/floors'), api('/areas'), api('/tables'), api('/terminals')]);
      set({ floors: floors.floors, areas: areas.areas, tables: tables.tables, terminals: terminals.terminals });
    } catch {
      // The next reconnect brings everything.
    }
  },

  reset() {
    set({ floors: [], areas: [], tables: [], terminals: [], orders: [], approvals: [], readyCount: 0, online: {}, synced: false });
  },
}));

// Replaces the row with the same id, or adds it if it is new.
const upsert = (list, row) => (list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [...list, row]);

// Tables stay in floor order: by area, then by their place in the area, parts of a split table together.
const sortTables = (tables, areas) => {
  const areaAt = new Map(areas.map((a, i) => [a.id, i]));
  const byId = new Map(tables.map((t) => [t.id, t]));
  const key = (t) => {
    const parent = t.parent_table_id ? byId.get(t.parent_table_id) : null;
    return [areaAt.get(t.area_id) ?? 999, (parent ?? t).sort ?? 0, (parent ?? t).id, t.parent_table_id ? 1 : 0, t.label];
  };
  return tables.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
};

ws.onOpen(() => useLive.getState().sync());
ws.on('table.updated', (table) => useLive.setState((s) => ({ tables: sortTables(upsert(s.tables, table), s.areas) })));
ws.on('table.removed', ({ id }) => useLive.setState((s) => ({ tables: s.tables.filter((t) => t.id !== id) })));
ws.on('tables.changed', () => useLive.getState().syncFloor());
ws.on('floor.updated', () => useLive.getState().syncFloor());
ws.on('order.created', (order) => useLive.setState((s) => ({ orders: upsert(s.orders, order) })));
// An order that was folded into another (merge) or cancelled drops out of the live picture;
// a closed one is kept, for the kitchen's Done tab and so open screens can show its last state.
ws.on('order.updated', (order) =>
  useLive.setState((s) => ({ orders: order.status === 'merged' ? s.orders.filter((o) => o.id !== order.id) : upsert(s.orders, order) }))
);
ws.on('ready.count', ({ count }) => useLive.setState({ readyCount: count }));
ws.on('approval.requested', (approval) => useLive.setState((s) => ({ approvals: upsert(s.approvals, approval) })));
ws.on('approval.decided', (approval) => useLive.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== approval.id) })));
ws.on('staff.presence', ({ userId, online }) => useLive.setState((s) => ({ online: { ...s.online, [userId]: online } })));

export const areaTables = (tables, areaId) => tables.filter((t) => t.area_id === areaId);
// The tables a service screen shows: switched on, and not the parent of a split (its parts are shown instead).
export const serviceTables = (tables) => tables.filter((t) => t.active && t.status !== 'split');
