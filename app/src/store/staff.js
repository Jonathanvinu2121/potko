import { create } from 'zustand';
import { api } from '../lib/api';
import { can } from './auth';

// The staff list with what the forms need next to it: the dining areas and their tables, the
// kitchen terminals, and what each role may do. Read when a staff screen opens.
export const useStaff = create((set, get) => ({
  users: [],
  areas: [],
  tables: [],
  terminals: [],
  permissions: {}, // key -> what it allows, in words
  presets: {}, // role -> { key: true | false }
  status: 'idle', // idle | loading | ready | error
  error: null,

  async load() {
    if (get().status !== 'ready') set({ status: 'loading', error: null });
    try {
      const data = await api('/users');
      set({ ...data, status: 'ready', error: null });
    } catch (err) {
      set({ status: get().users.length ? 'ready' : 'error', error: err.message });
    }
  },
}));

// Managers and admins can only be added or changed by someone with admin rights over staff.
export const SENIOR = ['admin', 'manager'];
export const mayChange = (person) => can('staff.manage') && (!SENIOR.includes(person?.role) || can('staff.admin'));
