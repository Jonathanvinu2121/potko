import { create } from 'zustand';

let timer = null;

export const useToast = create(() => ({ current: null }));

// Shows one message at the bottom of the screen. Every action ends with one of these.
//   toast('Table 5 is yours')
//   toast('Item removed', { action: { label: 'Undo', onPress }, duration: 4000 })
export function toast(text, { icon = 'check-circle-outline', tone = 'neutral', action, duration = 2500 } = {}) {
  clearTimeout(timer);
  useToast.setState({ current: { key: Date.now(), text, icon, tone, action } });
  timer = setTimeout(hideToast, duration);
}

export function hideToast() {
  clearTimeout(timer);
  useToast.setState({ current: null });
}
