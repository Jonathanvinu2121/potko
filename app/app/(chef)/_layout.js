import { useEffect } from 'react';
import { Vibration } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAudioPlayer } from 'expo-audio';
import { useTheme } from '../../src/theme';
import { useRoleGuard } from '../../src/lib/useRoleGuard';
import { useLive } from '../../src/store/live';
import { useAuth } from '../../src/store/auth';
import { useSettings } from '../../src/store/settings';
import { kitchenLabel, lineTerminals } from '../../src/lib/kitchen';
import { toast } from '../../src/store/toast';
import { on } from '../../src/lib/ws';

// Dishes waiting to be started at this chef's own terminals.
const sentCount = (order) => {
  const terminals = useAuth.getState().user?.terminals ?? [];
  return order.items.filter((i) => i.status === 'sent' && lineTerminals(i).some((t) => terminals.includes(t))).length;
};

export default function ChefLayout() {
  const t = useTheme();
  const redirect = useRoleGuard('chef');
  const chime = useAudioPlayer(require('../../assets/new-order.wav'));

  // Sound, vibration and a toast whenever something new needs the chef, whichever kitchen screen
  // is open: a new order, or more dishes on an order already in the kitchen.
  // It compares each update of the live orders with the one before, so the first load is silent and
  // an order that arrived while the connection was down still rings when it comes back.
  // (Browsers only allow sound after the first tap on the page.)
  useEffect(() => {
    if (redirect) return;
    return useLive.subscribe((state, before) => {
      if (!before.synced || state.orders === before.orders) return;
      for (const order of state.orders) {
        const was = before.orders.find((o) => o.id === order.id);
        let text = null;
        if (!was && sentCount(order) > 0) text = `New order · ${kitchenLabel(order)}`;
        else if (was && sentCount(order) > sentCount(was)) text = `More items · ${kitchenLabel(order)}`;
        if (!text) continue;
        // Sound and vibration can be switched off on this device; the toast always shows.
        if (useSettings.getState().sound) {
          try {
            chime.seekTo(0);
            chime.play();
          } catch {
            // no sound is not a reason to miss the order: the toast and the board still show it
          }
          Vibration.vibrate(400);
        }
        toast(text, { icon: 'bell-ring-outline', duration: 4000 });
      }
    });
  }, [redirect, chime]);

  // A party that changes table mid-meal: the ticket shows the new table at once, and this says so.
  useEffect(() => {
    if (redirect) return;
    return on('order.moved', ({ number, from, to }) => toast(`Order #${number} moved: ${from} to ${to}`, { icon: 'swap-horizontal', duration: 5000 }));
  }, [redirect]);

  if (redirect) return <Redirect href={redirect} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.background } }} />;
}
