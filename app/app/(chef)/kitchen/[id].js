import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useConnection } from '../../../src/lib/ws';
import { useNow } from '../../../src/lib/useNow';
import { kitchenLabel, kitchenStage, progress, kotLabel, waitingItems, newItems, acceptedItems, cookingItems, useKitchenOrder, useKitchenActions } from '../../../src/lib/kitchen';
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
import { ReadyTick } from '../../../src/components/KitchenTicket';

const PREP_TIMES = [10, 15, 20, 30];

// C2 One ticket, large. Everything here can also be done from the board; this screen is for a
// closer look, and for giving the waiter a prep time. One main button that follows the ticket:
//   New        Accept order (or Deny items)
//   Accepted   Start preparing, with an optional prep time. Starting goes straight back to the
//              board, so the other orders are in view again.
//   Preparing  tick each dish as it is ready, or Mark all ready
export default function KitchenOrder() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  // Only the dishes sent to this chef's terminals.
  const order = useKitchenOrder(id);
  const synced = useLive((s) => s.synced);
  const online = useConnection((s) => s.status) === 'online';
  const now = useNow();
  const actions = useKitchenActions();
  const [denyOpen, setDenyOpen] = useState(false);
  const [prepMinutes, setPrepMinutes] = useState(null);
  const toBoard = () => (router.canGoBack() ? router.back() : router.replace('/board'));

  if (!order) {
    return (
      <Screen scroll={false} header={<AppHeader title="Order" back />}>
        {synced ? (
          <EmptyState icon="receipt-text-remove-outline" title="Nothing here for your kitchen" text="The order was closed, or none of its dishes are cooked at your kitchen. Go back to the board." />
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
  const waiting = waitingItems(order);
  const fresh = newItems(order);
  const accepted = acceptedItems(order);
  const cooking = cookingItems(order);
  const busy = actions.busy;
  const blocked = !!busy || !online;
  // Dishes the waiter has asked a manager to cancel. The chef can see this but cannot decide it.
  const cancelAsked = order.pending_approvals.filter((a) => a.type === 'cancel').map((a) => a.order_item_id);

  const accept = () => actions.accept(order);
  const start = async () => {
    if (await actions.start(order, prepMinutes)) toBoard();
  };
  const allReady = async () => {
    if (await actions.allReady(order)) toBoard();
  };
  const deny = async (payload) => {
    try {
      await actions.deny(order, payload);
      setDenyOpen(false);
      toBoard();
    } catch (err) {
      setDenyOpen(false);
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    }
  };

  const strip = {
    new: { text: cooking.length || ready || accepted.length ? `${fresh.length} more to accept` : 'New · waiting to be accepted', icon: 'bell-outline', tone: 'primary' },
    accepted: { text: 'Accepted · not started yet', icon: 'check', tone: 'primary' },
    preparing: { text: accepted.length ? `Preparing · ${accepted.length} more to start` : 'Preparing', icon: 'pot-steam-outline', tone: 'primary' },
    done: { text: 'All ready · the waiter has been told', icon: 'check-circle-outline', tone: 'successText' },
  }[stage] ?? { text: 'Nothing to cook · every item was denied or removed', icon: 'close-circle-outline', tone: 'error' };

  // A dish that will not be cooked says why beside its name; a dish that is cooking has its tick
  // beside the whole row.
  const label = (item) => {
    if (item.status === 'unavailable') return <Chip label="Unavailable" icon="close-circle-outline" tone="error" />;
    if (item.status === 'removed' || item.status === 'cancelled') return <Chip label={item.status === 'removed' ? 'Removed' : 'Cancelled'} />;
    return null;
  };
  const cooked = (item) => ['preparing', 'ready', 'delivered'].includes(item.status);

  const footer =
    fresh.length > 0 ? (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Deny items" variant="secondary" disabled={blocked} onPress={() => setDenyOpen(true)} style={{ flex: 1 }} />
        <Button title="Accept order" icon="check" loading={busy === `${order.id}:accept`} disabled={!online || (!!busy && busy !== `${order.id}:accept`)} onPress={accept} style={{ flex: 1.6 }} />
      </View>
    ) : accepted.length > 0 ? (
      <View style={{ gap: 8 }}>
        <Txt size={12} color="textSecondary" center>
          The waiter can’t change these dishes once you start.
        </Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Deny items" variant="secondary" disabled={blocked} onPress={() => setDenyOpen(true)} style={{ flex: 1 }} />
          <Button title="Start preparing" icon="pot-steam-outline" loading={busy === `${order.id}:start`} disabled={!online || (!!busy && busy !== `${order.id}:start`)} onPress={start} style={{ flex: 1.6 }} />
        </View>
      </View>
    ) : stage === 'preparing' ? (
      <Button title="Mark all ready" icon="check-all" loading={busy === `${order.id}:all`} disabled={!online || (!!busy && busy !== `${order.id}:all`)} onPress={allReady} />
    ) : (
      <Button title="Back to board" variant={stage === 'done' ? 'success' : 'secondary'} icon="arrow-left" onPress={toBoard} />
    );

  return (
    <Screen header={<AppHeader title={`${kitchenLabel(order)} · #${order.number}`} subtitle={kotLabel(order) ?? undefined} back />} footer={footer}>
      <View style={{ gap: t.d.gap }}>
        <View style={{ gap: 8, padding: 12, borderRadius: t.radius.control, backgroundColor: stage === 'done' ? t.c.successTint : stage ? t.c.primaryTint : t.c.pressed }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={strip.icon} size={18} color={strip.tone} />
            <Txt size={14} weight={600} color={strip.tone} style={{ flex: 1 }}>
              {strip.text}
            </Txt>
            {stage === 'preparing' ? (
              <Txt size={13} weight={600} tabular>
                {ready} of {total} ready
              </Txt>
            ) : null}
            {stage && stage !== 'done' ? <TimerChip since={order.created_at} now={now} /> : null}
          </View>
          {stage === 'preparing' ? (
            <View style={{ height: 8, borderRadius: t.radius.pill, backgroundColor: t.c.border, overflow: 'hidden' }}>
              <View style={{ width: `${total ? (ready / total) * 100 : 0}%`, height: 8, backgroundColor: t.c.primary }} />
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
                { flexDirection: 'row', alignItems: 'center', gap: 12 },
                index > 0 && { paddingTop: 16, borderTopWidth: t.borderWidth, borderTopColor: t.c.border },
                ['unavailable', 'removed', 'cancelled'].includes(item.status) && { opacity: 0.6 },
              ]}
            >
              <View style={{ flex: 1 }}>
              <ItemRow
                qty={item.qty}
                name={item.name_snapshot}
                veg={item.veg}
                size={item.size}
                customisations={[...(item.addons || []).map((a) => a.name), ...item.customisations]}
                note={item.note ? `Waiter note: ${item.note}` : null}
                allergyNote={item.allergy_note}
                done={item.status === 'ready' || item.status === 'delivered'}
                right={label(item)}
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
              {cooked(item) ? <ReadyTick item={item} working={busy === `item:${item.id}`} disabled={blocked} onPress={() => actions.itemReady(order, item)} /> : null}
            </View>
          ))}
        </Card>

        {fresh.length === 0 && accepted.length > 0 ? (
          <Card style={{ gap: 12 }}>
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
                <Chip key={minutes} label={`${minutes} min`} selected={prepMinutes === minutes} onPress={() => setPrepMinutes(prepMinutes === minutes ? null : minutes)} />
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

      <DenySheet visible={denyOpen} items={waiting} onClose={() => setDenyOpen(false)} onSubmit={deny} />
    </Screen>
  );
}
