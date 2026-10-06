// Where the POTKO server lives.
// The address is built into the app when it is made (EXPO_PUBLIC_API_URL). From the first screen
// it can be pointed at another server, and that choice is remembered on this device, so one
// installed app works on any network without being rebuilt.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'potko.server';
export const BUILT_IN = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

export const useServer = create(() => ({ url: BUILT_IN }));

export const serverUrl = () => useServer.getState().url;
// The live connection is the same server: http -> ws, https -> wss.
export const socketUrl = () => `${serverUrl().replace(/^http/i, 'ws')}/ws`;

// "192.168.1.5:4000" -> "http://192.168.1.5:4000". Returns null when it is not an address.
export function tidyAddress(text) {
  const raw = String(text || '').trim().replace(/\/+$/, '');
  const full = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const m = full.match(/^(https?):\/\/([a-z0-9.-]+)(:\d{1,5})?$/i);
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] || ''}` : null;
}

// App start: use the address saved on this device, if there is one.
export async function loadServer() {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (saved) useServer.setState({ url: saved });
}

// Remembers the address. Nothing (or the built-in address) goes back to the one the app came with.
export async function saveServer(url) {
  if (url && url !== BUILT_IN) await AsyncStorage.setItem(KEY, url).catch(() => {});
  else await AsyncStorage.removeItem(KEY).catch(() => {});
  useServer.setState({ url: url || BUILT_IN });
}

// True when a POTKO server answers at that address.
export async function checkServer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return res.ok && data.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
