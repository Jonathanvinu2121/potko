import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setToken, setUnauthorizedHandler } from '../lib/api';
import * as ws from '../lib/ws';
import { loadServer } from '../lib/server';
import { useSettings } from './settings';
import { useDraft } from './draft';
import { useLive } from './live';
import { useMenu } from './menu';

const TOKEN_KEY = 'potko.token';

export const useAuth = create((set, get) => ({
  ready: false, // true once the saved login has been checked at app start
  token: null,
  user: null,
  restaurant: null,

  // App start: if a login is saved on this device and still valid, carry on where the user left off.
  async restore() {
    await loadServer();
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        setToken(token);
        const { user, restaurant } = await api('/me', { timeout: 8000 });
        await useSettings.getState().load(user.id);
        set({ token, user, restaurant });
        ws.connect(token);
      }
    } catch (err) {
      setToken(null);
      // An expired or rejected login is forgotten; a server that is just slow to wake keeps it for next time.
      if (err.status === 401) await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    }
    set({ ready: true });
  },

  async login({ loginId, password, role, otp }) {
    // A sleeping free server can take about a minute to answer the first request.
    const data = await api('/auth/login', { method: 'POST', body: { loginId, password, role, otp }, timeout: 75000 });
    await get().enter(data);
  },

  // Developer mode (a test server on the developer's own computer only): sign in as a person
  // without typing anything. The server refuses this everywhere else.
  async devLogin(userId) {
    const data = await api('/auth/dev-login', { method: 'POST', body: { userId }, timeout: 15000 });
    await get().enter(data);
  },

  // A sign-in the server accepted: keep the token, load this person's look, open the live connection.
  async enter(data) {
    setToken(data.token);
    await AsyncStorage.setItem(TOKEN_KEY, data.token).catch(() => {});
    await useSettings.getState().load(data.user.id);
    set({ token: data.token, user: data.user, restaurant: data.restaurant });
    ws.connect(data.token);
  },

  // Re-reads the signed-in user (after changing their PIN, for example).
  async refresh() {
    const { user, restaurant } = await api('/me');
    set({ user, restaurant });
  },

  // Signing out ends this device's session on the server too, so the token is dead at once.
  // (When the server already refused the token there is nothing left to end.)
  async logout({ tellServer = true } = {}) {
    if (!get().token) return;
    if (tellServer) await api('/me/logout', { method: 'POST', timeout: 4000 }).catch(() => {});
    useDraft.getState().releaseTable();
    useDraft.getState().clear();
    useLive.getState().reset();
    useMenu.setState({ categories: [], items: [], status: 'idle', error: null });
    ws.disconnect();
    setToken(null);
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    useSettings.getState().reset();
    set({ token: null, user: null, restaurant: null });
  },
}));

// If the server stops accepting the login (expired after 12h, user deactivated), sign out.
// The role layouts then send the user back to the first screen.
const signOut = () => useAuth.getState().logout({ tellServer: false });
setUnauthorizedHandler(signOut);
ws.setUnauthorizedHandler(signOut);

// A manager changed this person's assignments or permissions: read them again.
ws.on('me.updated', () => {
  if (useAuth.getState().user) useAuth.getState().refresh().catch(() => {});
});

// True when the signed-in person holds a permission. The server checks it again on every action;
// this only decides what the app offers.
export const can = (permission) => !!useAuth.getState().user?.permissions?.[permission];
export const useCan = (permission) => useAuth((s) => !!s.user?.permissions?.[permission]);

// The admin changed the restaurant's name or settings: every screen has them at once.
ws.on('restaurant.updated', (restaurant) => {
  if (useAuth.getState().user) useAuth.setState({ restaurant });
});
