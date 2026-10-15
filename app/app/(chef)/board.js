import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useLive } from '../../src/store/live';
import { useConnection } from '../../src/lib/ws';
import { useNow } from '../../src/lib/useNow';
import { kitchenStage, waitingItems, useKitchenOrders, useMyTerminals, useKitchenActions } from '../../src/lib/kitchen';
import { Notice } from '../../src/components/Feedback';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';
import { KitchenTicket } from '../../src/components/KitchenTicket';
import { DenySheet } from '../../src/components/DenySheet';
import { toast } from '../../src/store/toast';
import { Button } from '../../src/components/Button';

const TABS = [
  { key: 'new', label: 'New orders', empty: { icon: 'bell-outline', title: 'No new orders', text: 'New orders from the waiters appear here straight away.' } },
  { key: 'preparing', label: 'Preparing', empty: { icon: 'pot-steam-outline', title: 'Nothing cooking', text: 'Orders you accept move here.' } },
  { key: 'done', label: 'Done', empty: { icon: 'check-all', title: 'Nothing finished yet', text: 'Orders you finish during this service are listed here.' } },
];

// C1 Kitchen board, in three sections:
//   New orders  tickets waiting: Deny, or Accept
//   Preparing   accepted tickets: Start preparing, then tick each dish as it is ready, or All ready
//   Done        what was finished during this service
// Every ticket carries its own buttons, so the chef works from this screen and never has to open
// a ticket. Accepting a ticket moves it to Preparing and leaves the chef on New orders, with the
// next ticket in front of them. The count on each section is always in view.
export default function Board() {
  const t = useTheme();
  const router = useRouter();
  const orders = useKitchenOrders();
  const mine = useMyTerminals();
  const terminals = useLive((s) => s.terminals);
  const synced = useLive((s) => s.synced);
  const online = useConnection((s) => s.status) === 'online';
  const stations = terminals.filter((k) => mine.includes(k.id)).map((k) => k.name).join(' · ');
  const now = useNow();
  const actions = useKitchenActions();
  const [tab, setTab] = useState('new');
  const [width, setWidth] = useState(0);
  const [denyId, setDenyId] = useState(null); // the order whose deny sheet is open

  // Oldest first, so the longest wait is always on top.
  const byAge = [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const staged = byAge.map((order) => ({ order, stage: kitchenStage(order) })).filter((x) => x.stage);
  const groups = {
    new: staged.filter((x) => x.stage === 'new').map((x) => x.order),
    preparing: staged.filter((x) => x.stage === 'accepted' || x.stage === 'preparing').map((x) => x.order),
    done: staged.filter((x) => x.stage === 'done').map((x) => x.order).reverse(), // history: latest first
  };
  const denyOrder = denyId ? orders.find((o) => o.id === denyId) : null;
  const list = groups[tab];
  const info = TABS.find((x) => x.key === tab);

  // One column on a phone, more on a tablet or a wall screen.
  const gap = t.d.gap;
  const columns = Math.max(1, Math.floor(width / 340));
  const cardWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;

  return (
    <Screen header={<AppHeader title="Kitchen" subtitle={stations || undefined} right={<Button title="My dishes" icon="silverware-fork-knife" variant="secondary" onPress={() => router.push('/dishes')} />} />}>
      {synced && mine.length === 0 ? (
        <View style={{ marginBottom: 12 }}>
          <Notice tone="warning" icon="alert-outline" title="No kitchen assigned" text="A manager has to assign you to a kitchen (More, Kitchens) before tickets appear here." />
        </View>
      ) : null}
      {!online && synced ? (
        <View style={{ marginBottom: 12 }}>
          <Notice tone="error" icon="wifi-off" title="Not connected" text="Buttons work again as soon as the connection is back." />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }} accessibilityRole="tablist">
        {TABS.map((item) => {
          const selected = tab === item.key;
          const count = groups[item.key].length;
          // New orders waiting while another section is open: the count is filled, so it cannot be missed.
          const calling = item.key === 'new' && count > 0 && !selected;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              aria-selected={selected}
              accessibilityLabel={`${item.label} ${count}`}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                minHeight: t.d.control,
                paddingHorizontal: 2,
                borderRadius: t.radius.control,
                borderWidth: selected || calling ? 2 : t.borderWidth,
                borderColor: selected || calling ? t.c.primary : t.c.border,
                backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
              })}
            >
              <Txt size={13} weight={600} color={selected || calling ? 'primary' : 'text'} numberOfLines={1} style={{ flexShrink: 1 }}>
                {item.label}
              </Txt>
              <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: calling ? t.c.primary : selected ? t.c.card : t.c.pressed }}>
                <Txt size={12} weight={700} color={calling ? 'onPrimary' : selected ? 'primary' : 'textSecondary'} tabular>
                  {count}
                </Txt>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap }}>
        {!synced
          ? [0, 1].map((n) => <Skeleton key={n} height={180} width={cardWidth || '100%'} radius={t.radius.card} />)
          : list.map((order) => (
              <View key={order.id} style={{ width: cardWidth || '100%' }}>
                <KitchenTicket
                  order={order}
                  now={now}
                  busy={actions.busy}
                  online={online}
                  onOpen={() => router.push(`/kitchen/${order.id}`)}
                  onAccept={() => actions.accept(order)}
                  onStart={() => actions.start(order)}
                  onDeny={() => setDenyId(order.id)}
                  onItemReady={(item) => actions.itemReady(order, item)}
                  onAllReady={() => actions.allReady(order)}
                />
              </View>
            ))}
      </View>

      {synced && list.length === 0 ? <EmptyState {...info.empty} /> : null}

      <DenySheet
        visible={!!denyOrder}
        items={denyOrder ? waitingItems(denyOrder) : []}
        onClose={() => setDenyId(null)}
        onSubmit={async (payload) => {
          try {
            await actions.deny(denyOrder, payload);
          } catch (err) {
            // The ticket moved on while the sheet was open: say so and let the board show where it is now.
            toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
          }
          setDenyId(null);
        }}
      />
    </Screen>
  );
}
