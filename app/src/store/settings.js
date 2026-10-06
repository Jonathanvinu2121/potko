import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULTS = { fontSize: 'M', theme: 'light', density: 'medium' };

const key = (userId) => `potko.settings.${userId}`;
const pick = ({ fontSize, theme, density }) => ({ fontSize, theme, density });

// The Customise choices. Saved per user on this device and applied to the whole app at once.
export const useSettings = create((set, get) => ({
  ...DEFAULTS,

  // Loads this user's saved look. Resolves false if they have never saved one on this device.
  async load(userId) {
    try {
      const raw = await AsyncStorage.getItem(key(userId));
      if (raw) {
        set({ ...DEFAULTS, ...pick(JSON.parse(raw)) });
        return true;
      }
    } catch {
      // unreadable storage is treated as "nothing saved"
    }
    set(DEFAULTS);
    return false;
  },

  // Applies a choice straight away without saving it (the live preview).
  preview(partial) {
    set(partial);
  },

  async save(userId) {
    await AsyncStorage.setItem(key(userId), JSON.stringify(pick(get())));
  },

  reset() {
    set(DEFAULTS);
  },
}));
