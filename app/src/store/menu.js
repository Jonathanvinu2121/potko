import { create } from 'zustand';
import { api } from '../lib/api';
import { on } from '../lib/ws';

// The restaurant's menu, loaded once and searched on the device so typing filters instantly.
export const useMenu = create((set, get) => ({
  categories: [],
  items: [],
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  error: null,

  // Loads or refreshes the menu. A refresh that fails keeps showing the menu already on screen.
  async load() {
    if (get().status === 'loading') return;
    const hadMenu = get().items.length > 0;
    set({ status: hadMenu ? 'ready' : 'loading', error: null });
    try {
      const { categories, items } = await api('/menu');
      set({ categories, items, status: 'ready' });
    } catch (err) {
      set({ status: hadMenu ? 'ready' : 'error', error: err.message });
    }
  },
}));

// A manager changed the menu (new item, price, out of stock): every screen that has it reloads it.
on('menu.updated', () => {
  if (useMenu.getState().status !== 'idle') useMenu.getState().load();
});

// The size picked by default on the item sheet: the one the list price belongs to, else the last.
export const defaultSize = (item) =>
  item.sizes.length === 0 ? null : (item.sizes.find((s) => s.price === item.price) ?? item.sizes[item.sizes.length - 1]).label;

export const priceFor = (item, size) => item.sizes.find((s) => s.label === size)?.price ?? item.price;

// The whole menu for the people who manage it: switched-off categories included.
// Loaded when a menu set-up screen opens, and again whenever anyone changes the menu.
export const useMenuAdmin = create((set, get) => ({
  categories: [],
  items: [],
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  error: null,

  async load() {
    if (get().status === 'loading') return;
    const had = get().status === 'ready';
    set({ status: had ? 'ready' : 'loading', error: null });
    try {
      const { categories, items } = await api('/menu?all=1');
      set({ categories, items, status: 'ready' });
    } catch (err) {
      set({ status: had ? 'ready' : 'error', error: err.message });
    }
  },
}));

on('menu.updated', () => {
  if (useMenuAdmin.getState().status !== 'idle') useMenuAdmin.getState().load();
});

// "₹180" for one price, "₹180 – ₹320" for portions.
export const priceRange = (item) => {
  if (!item.sizes?.length) return [item.price, item.price];
  const prices = item.sizes.map((s) => s.price);
  return [Math.min(...prices), Math.max(...prices)];
};
