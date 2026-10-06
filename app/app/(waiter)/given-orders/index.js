import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useNow } from '../../../src/lib/useNow';
import { orderLabel } from '../../../src/lib/format';
import { isOpen, liveItems, readyItems, unavailableItems, ORDER_STATUS, TYPE_ICON } from '../../../src/lib/orders';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { TimerChip } from '../../../src/components/TimerChip';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'dine_in', label: 'Dine-in' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'takeaway', label: 'Takeaway' },
];

// W10 Given Orders: every order this waiter has open. Tap one to see and change it.
export default function GivenOrders() {
  const t = useTheme();
  const router = useRouter();
  const orders = useLive((s) => s.orders);
  const tables = useLive((s) => s.tables);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [filter, setFilter] = useState('all');

  // Orders that need the waiter first (something unavailable, something ready), then oldest first.
  const urgency = (o) => (unavailableItems(o).length ? 0 : readyItems(o).length ? 1 : 2);
  const open = orders
    .filter(isOpen)
    .sort((a, b) => urgency(a) - urgency(b) || new Date(a.created_at) - new Date(b.created_at));
  const visible = open.filter((o) => filter === 'all' || o.type === filter);

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Given Orders" />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </ScrollView>

      {!synced ? (
        <View style={{ gap: t.d.gap }}>
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} height={96} radius={t.radius.card} />
          ))}
        </View>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="receipt-text-outline"
          title={open.length === 0 ? 'No open orders' : 'None of this type'}
          text={open.length === 0 ? 'Orders you send to the kitchen are listed here until they are paid.' : 'Choose another filter to see the rest.'}
        />
      ) : (
        <View style={{ gap: t.d.gap }}>
          {visible.map((order) => {
            const ready = readyItems(order).length;
            const unavailable = unavailableItems(order).length;
            const count = liveItems(order).length;
            const table = tables.find((x) => x.id === order.table_id);
            const billing = order.at_counter || table?.status === 'needs_payment';
            const status = billing
              ? { label: order.at_counter ? 'At manager counter' : 'Needs payment', tone: 'warning', icon: 'cash' }
              : ORDER_STATUS[order.status];
            return (
              <Pressable
                key={order.id}
                onPress={() => router.push(`/given-orders/${order.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${orderLabel(order)}, order ${order.number}, ${status.label}`}
                style={({ pressed }) => [
                  {
                    gap: 10,
                    padding: t.d.pad,
                    borderRadius: t.radius.card,
                    borderWidth: unavailable || ready ? 2 : t.borderWidth,
                    borderColor: unavailable ? t.c.error : ready ? t.c.success : t.c.border,
                    backgroundColor: pressed ? t.c.pressed : t.c.card,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                  t.shadow,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: t.radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.primaryTint }}>
                    <Icon name={TYPE_ICON[order.type]} color="primary" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt size={17} weight={700} numberOfLines={1}>
                      {orderLabel(order)}
                    </Txt>
                    <Txt size={13} color="textSecondary" tabular>
                      #{order.number} · {count} {count === 1 ? 'item' : 'items'}
                    </Txt>
                  </View>
                  <TimerChip since={order.created_at} now={now} />
                  <Icon name="chevron-right" color="textSecondary" />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Chip label={status.label} icon={status.icon} tone={status.tone} />
                  {ready ? <Chip label={`${ready} ready`} icon="bell-ring-outline" tone="success" /> : null}
                  {unavailable ? <Chip label={`${unavailable} unavailable`} icon="alert-outline" tone="error" /> : null}
                  {order.pending_approvals.length ? <Chip label="Waiting for manager" icon="shield-account-outline" tone="warning" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
