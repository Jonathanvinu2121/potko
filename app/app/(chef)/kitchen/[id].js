import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useConnection, send } from '../../../src/lib/ws';
import { useNow } from '../../../src/lib/useNow';
import { kitchenLabel, kitchenStage, progress } from '../../../src/lib/kitchen';
import { toast } from '../../../src/store/toast';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { ItemRow } from '../../../src/components/ItemRow';
import { TimerChip } from '../../../src/components/TimerChip';
import { DenySheet } from '../../../src/components/DenySheet';

const PREP_TIMES = [10, 15, 20, 30];

// C2 Order detail. One main bottom button that follows the order:
//   New        Accept order (and Deny items)
//   Accepted   Start preparing (optional prep time first)
//   Preparing  tick each dish as it is ready, or Mark all ready
export default function KitchenOrder() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const order = useLive((s) => s.orders.find((o) => o.id === id));
  const synced = useLive((s) => s.synced);
  const online = useConnection((s) => s.status) === 'online';
  const now = useNow();
  const [busy, setBusy] = useState(null); // which action is running: 'accept' | 'start' | 'all' | item id
  const [denyOpen, setDenyOpen] = useState(false);
  const [prepMinutes, setPrepMinutes] = useState(null);

  if (!order) {
    return (
      <Screen scroll={false} header={<AppHeader title="Order" back />}>
        {synced ? (
          <EmptyState icon="receipt-text-remove-outline" title="Order not found" text="It may have been closed. Go back to the board." />
        ) : (
          <View style={{ gap: 12, paddingTop: 16 }}>
            <Skeleton height={48} />
            <Skeleton height={160} />
          </View>
        )}
      </Screen>
    );
  }

  const stage = kitchenStage(order);
  const { ready, total } = progress(order);
  const deniable = order.items.filter((i) => i.status === 'sent' || i.status === 'accepted');
  // Dishes the waiter has asked a manager to cancel. The chef can see this but cannot decide it.
  const cancelAsked = order.pending_approvals.filter((a) => a.type === 'cancel').map((a) => a.order_item_id);

  // Runs one kitchen action and reports what happened. The screen itself updates from the
  // server's order.updated event, so it always shows what the server actually did.
  const run = async (key, type, payload, done) => {
    setBusy(key);
    try {
      const result = await send(type, payload);
      done?.(result);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(null);
    }
  };

  const accept = () => run('accept', 'chef.accept', { orderId: id }, () => toast('Order accepted'));
  const start = () =>
    run('start', 'chef.start', { orderId: id, prepMinutes }, () => toast('Preparing · the waiter can no longer edit'));
  const itemReady = (item) =>
    run(item.id, 'chef.itemReady', { itemId: item.id }, (updated) =>
      toast(kitchenStage(updated) === 'done' ? 'Sent to waiter' : `${item.name_snapshot} ready · waiter notified`, { tone: 'success' })
    );
  const allReady = () =>
    run('all', 'chef.allReady', { orderId: id }, () => {
      toast('Sent to waiter', { tone: 'success' });
      router.back();
    });

  const deny = async ({ itemIds, reason, note }) => {
    try {
      const result = await send('chef.deny', { orderId: id, itemIds, reason, note });
      setDenyOpen(false);
      toast(`Waiter notified – ${result.accepted} accepted, ${result.unavailable} unavailable`, { icon: 'bell-outline', duration: 4000 });
      if (!kitchenStage(result.order)) router.back(); // the whole order was denied: nothing left to cook
    } catch (err) {
      setDenyOpen(false);
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    }
  };

  const strip = {
    new: { text: 'New', icon: 'circle-medium', tone: 'textSecondary' },
    accepted: { text: 'Accepted · ready to cook', icon: 'check', tone: 'textSecondary' },
    preparing: { text: 'Preparing', icon: 'pot-steam-outline', tone: 'primary' },
    done: { text: 'All ready · sent to waiter', icon: 'check-circle-outline', tone: 'successText' },
  }[stage] ?? { text: 'Nothing to cook · every item was denied or removed', icon: 'close-circle-outline', tone: 'error' };

  // What sits at the right of each dish depends on that dish's own status.
  const control = (item) => {
    if (item.status === 'preparing') {
      const working = busy === item.id;
      return (
        <Pressable
          onPress={() => itemReady(item)}
          disabled={!!busy || !online}
          accessibilityRole="button"
          accessibilityLabel={`Mark ${item.name_snapshot} ready`}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: t.radius.pill,
            borderWidth: 2,
            borderColor: working ? t.c.success : t.c.border,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed || working ? t.c.successTint : t.c.card,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          {working ? <Icon name="check" color="success" /> : null}
        </Pressable>
      );
    }
    if (item.status === 'ready' || item.status === 'delivered') {
      return (
        <View
          accessibilityLabel="Ready"
          style={{
            width: 44,
            height: 44,
            borderRadius: t.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.c.successTint,
            borderWidth: 2,
            borderColor: t.c.success,
          }}
        >
          <Icon name="check" color="successText" />
        </View>
      );
    }
    if (item.status === 'unavailable') return <Chip label="Unavailable" icon="close-circle-outline" tone="error" />;
    if (item.status === 'removed' || item.status === 'cancelled') return <Chip label={item.status === 'removed' ? 'Removed' : 'Cancelled'} />;
    return null;
  };

  const footer =
    stage === 'new' ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Deny items" variant="secondary" disabled={!!busy || !online} onPress={() => setDenyOpen(true)} style={{ flex: 1 }} />
        <Button title="Accept order" loading={busy === 'accept'} disabled={!online} onPress={accept} style={{ flex: 1.4 }} />
      </View>
    ) : stage === 'accepted' ? (
      <View style={{ gap: 8 }}>
        <Txt size={12} color="textSecondary" center>
          Waiter can’t edit after you start.
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Deny items" variant="secondary" disabled={!!busy || !online} onPress={() => setDenyOpen(true)} style={{ flex: 1 }} />
          <Button title="Start preparing" loading={busy === 'start'} disabled={!online} onPress={start} style={{ flex: 1.4 }} />
        </View>
      </View>
    ) : stage === 'preparing' ? (
      <Button title="Mark all ready" loading={busy === 'all'} disabled={!online || (!!busy && busy !== 'all')} onPress={allReady} />
    ) : (
      <Button title={stage === 'done' ? 'All ready · Back to board' : 'Back to board'} variant={stage === 'done' ? 'success' : 'secondary'} icon="arrow-left" onPress={() => router.back()} />
    );

  return (
    <Screen header={<AppHeader title={`${kitchenLabel(order)} · #${order.number}`} back />} footer={footer}>
      <View style={{ gap: t.d.gap }}>
        <View
          style={{
            gap: 8,
            padding: 12,
            borderRadius: t.radius.control,
            backgroundColor: stage === 'done' ? t.c.successTint : stage === 'preparing' ? t.c.primaryTint : t.c.pressed,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={strip.icon} size={18} color={strip.tone} />
            <Txt size={14} weight={600} color={strip.tone} style={{ flex: 1 }}>
              {strip.text}
            </Txt>
            {stage === 'preparing' ? (
              <Txt size={13} weight={600} tabular>
                {ready} of {total} items ready
              </Txt>
            ) : null}
            {stage && stage !== 'done' ? <TimerChip since={order.created_at} now={now} /> : null}
          </View>
          {stage === 'preparing' ? (
            <View style={{ height: 6, borderRadius: t.radius.pill, backgroundColor: t.c.border, overflow: 'hidden' }}>
              <View style={{ width: `${total ? (ready / total) * 100 : 0}%`, height: 6, backgroundColor: t.c.primary }} />
            </View>
          ) : null}
        </View>

        {cancelAsked.length > 0 ? (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.errorTint }}>
            <Icon name="alert-outline" size={18} color="error" />
            <Txt size={14} weight={700} color="error" style={{ flex: 1 }}>
              Cancel requested · waiting for manager
            </Txt>
          </View>
        ) : null}

        <Card style={{ gap: 16 }}>
          {order.items.map((item, index) => (
            <View
              key={item.id}
              style={[
                index > 0 && { paddingTop: 16, borderTopWidth: t.borderWidth, borderTopColor: t.c.border },
                ['unavailable', 'removed', 'cancelled'].includes(item.status) && { opacity: 0.6 },
              ]}
            >
              <ItemRow
                qty={item.qty}
                name={item.name_snapshot}
                veg={item.veg}
                size={item.size}
                customisations={item.customisations}
                note={item.note ? `Waiter note: ${item.note}` : null}
                allergyNote={item.allergy_note}
                done={item.status === 'ready' || item.status === 'delivered'}
                right={control(item)}
              >
                {cancelAsked.includes(item.id) ? (
                  <Txt size={13} weight={600} color="error">
                    Waiter asked to cancel this dish
                  </Txt>
                ) : null}
                {item.status === 'unavailable' && item.unavailable_reason ? (
                  <Txt size={13} color="error">
                    {item.unavailable_reason}
                  </Txt>
                ) : null}
              </ItemRow>
            </View>
          ))}
        </Card>

        {stage === 'accepted' ? (
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Txt size={15} weight={700}>
                Prep time
              </Txt>
              <Txt size={12} color="textSecondary">
                Optional · shown to the waiter
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {PREP_TIMES.map((minutes) => (
                <Chip
                  key={minutes}
                  label={`${minutes} min`}
                  selected={prepMinutes === minutes}
                  onPress={() => setPrepMinutes(prepMinutes === minutes ? null : minutes)}
                />
              ))}
            </View>
          </Card>
        ) : null}

        {!online ? (
          <Txt size={12} color="error" center>
            Not connected. Buttons work again as soon as the connection is back.
          </Txt>
        ) : null}
      </View>

      <DenySheet visible={denyOpen} items={deniable} onClose={() => setDenyOpen(false)} onSubmit={deny} />
    </Screen>
  );
}
