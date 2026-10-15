// How the kitchen reads an order, and the few things a chef can do to it. Everything here is
// worked out from the items' statuses, which only the server changes.
import { useMemo, useState } from 'react';
import { useAuth } from '../store/auth';
import { useLive } from '../store/live';
import { toast } from '../store/toast';
import { send } from './ws';

const NONE = [];

// The kitchen terminals the signed-in chef works at (set by a manager under Kitchens or Staff).
export const useMyTerminals = () => useAuth((s) => s.user?.terminals) ?? NONE;

// The part of an order that is cooked at these terminals. A chef's screens only ever show this
// part; the server refuses to act on anything else.
// A dish can show at several terminals (terminal_ids); older lines carry only terminal_id.
export const lineTerminals = (item) => (item.terminal_ids?.length ? item.terminal_ids : [item.terminal_id]);
export const atTerminals = (order, terminals) => ({ ...order, items: order.items.filter((i) => lineTerminals(i).some((t) => terminals.includes(t))) });

// Every order in progress, cut down to this chef's dishes.
export function useKitchenOrders() {
  const orders = useLive((s) => s.orders);
  const terminals = useMyTerminals();
  return useMemo(() => orders.map((o) => atTerminals(o, terminals)).filter((o) => o.items.length > 0), [orders, terminals]);
}

// One order, cut down the same way. Null when it has nothing for this chef.
export function useKitchenOrder(id) {
  const order = useLive((s) => s.orders.find((o) => o.id === id));
  const terminals = useMyTerminals();
  return useMemo(() => {
    if (!order) return null;
    const mine = atTerminals(order, terminals);
    return mine.items.length > 0 ? mine : null;
  }, [order, terminals]);
}

// "KOT #12" or "KOT #12, #15" when more dishes were sent later.
export function kotLabel(order) {
  const numbers = [...new Set(order.items.map((i) => i.kot_number).filter(Boolean))].sort((a, b) => a - b);
  return numbers.length ? `KOT ${numbers.map((n) => `#${n}`).join(', ')}` : null;
}

// Dishes the kitchen is (or was) making: not denied, removed or cancelled.
export const liveItems = (order) => order.items.filter((i) => !['unavailable', 'removed', 'cancelled'].includes(i.status));
// Dishes not cooking yet, which the chef can still deny: new (to accept) or accepted (to start).
export const isWaiting = (item) => item.status === 'sent' || item.status === 'accepted';
export const waitingItems = (order) => order.items.filter(isWaiting);
export const newItems = (order) => order.items.filter((i) => i.status === 'sent');
export const acceptedItems = (order) => order.items.filter((i) => i.status === 'accepted');
export const cookingItems = (order) => order.items.filter((i) => i.status === 'preparing');

// The order type is the biggest thing on a kitchen card: DINE-IN T5 / DELIVERY Rahul / CAR PB10AB1234.
export function kitchenLabel(order) {
  if (order.type === 'dine_in') return `DINE-IN ${order.table_label}`;
  if (order.type === 'delivery') return `DELIVERY ${order.customer_name}`;
  return `CAR ${order.car_number || order.customer_name}`;
}

// Where an order sits for the chef:
//   'new'        something waits to be accepted or denied
//   'preparing'  cooking (dishes accepted later may still wait to be started)
//   'accepted'   accepted, nothing started yet
//   'done'       every dish is ready or delivered
//   null         nothing left for the kitchen (every dish denied or removed)
export function kitchenStage(order) {
  const live = liveItems(order);
  if (live.length === 0) return null;
  if (live.some((i) => i.status === 'sent')) return 'new';
  if (live.some((i) => i.status === 'preparing')) return 'preparing';
  if (live.some((i) => i.status === 'accepted')) return 'accepted';
  return 'done';
}

// "1 of 3 ready"
export function progress(order) {
  const live = liveItems(order);
  return { ready: live.filter((i) => i.status === 'ready' || i.status === 'delivered').length, total: live.length };
}

// The chef's actions, the same from the board and from an open ticket. Each one tells the server,
// says what happened in a toast, and leaves the screen to redraw from the server's own update.
//   busy  which action is running: "12:start", "12:all" or "item:45" (null when idle)
export function useKitchenActions() {
  const [busy, setBusy] = useState(null);

  const run = async (key, type, payload, done) => {
    setBusy(key);
    try {
      const result = await send(type, payload);
      done?.(result);
      return result;
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
      return null;
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    accept: (order) => run(`${order.id}:accept`, 'chef.accept', { orderId: order.id }, () => toast(`${kitchenLabel(order)} · accepted`, { icon: 'check' })),
    start: (order, prepMinutes) =>
      run(`${order.id}:start`, 'chef.start', { orderId: order.id, prepMinutes }, () => toast(`${kitchenLabel(order)} · preparing`, { icon: 'pot-steam-outline' })),
    itemReady: (order, item) =>
      run(`item:${item.id}`, 'chef.itemReady', { itemId: item.id }, (updated) =>
        toast(kitchenStage(atTerminals(updated, order.items.flatMap(lineTerminals))) === 'done' ? `${kitchenLabel(order)} · all ready, waiter told` : `${item.name_snapshot} ready · waiter told`, { tone: 'success' })
      ),
    allReady: (order) => run(`${order.id}:all`, 'chef.allReady', { orderId: order.id }, () => toast(`${kitchenLabel(order)} · all ready, waiter told`, { tone: 'success' })),
    // Resolves the server's answer, or throws: the deny sheet shows its own busy state.
    async deny(order, { itemIds, reason, note }) {
      const result = await send('chef.deny', { orderId: order.id, itemIds, reason, note });
      const accepted = result.accepted ?? 0;
      toast(`Waiter told · ${result.unavailable} unavailable${accepted ? `, ${accepted} accepted` : ''}`, { icon: 'bell-outline', duration: 4000 });
      return result;
    },
  };
}
