import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useNow } from '../../../src/lib/useNow';
import { orderLabel } from '../../../src/lib/format';
import { isOpen, onFloor, liveItems, readyItems, unavailableItems, TYPE_ICON } from '../../../src/lib/orders';
import { areaAllowed } from '../../../src/lib/access';
import { useAuth } from '../../../src/store/auth';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { TimerChip } from '../../../src/components/TimerChip';
import { OrderTags } from '../../../src/components/OrderTags';
import { AreaPicker, useAreaChoice } from '../../../src/components/AreaPicker';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'dine_in', label: 'Dine-in' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'takeaway', label: 'Takeaway' },
];

// W10 Given Orders: every order this waiter has open, and paid tables not yet closed, each with
// its status tags. The list can be narrowed to a floor and a dining area. Tap one to see and change it.
export default function GivenOrders() {
  const t = useTheme();
  const router = useRouter();
  const orders = useLive((s) => s.orders);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [filter, setFilter] = useState('all');
  const access = useAuth((s) => s.user?.access);
  const allAreas = useLive((s) => s.areas);
  const areas = allAreas.filter((a) => a.active && areaAllowed(access, a.id));
  const place = useAreaChoice(areas, { allowAll: true });
  const narrowed = !!place.floor || !!place.area;

  // Orders that need the waiter first (something unavailable, something ready), then oldest first.
  // A paid table waiting to be closed comes last.
  const urgency = (o) => (!isOpen(o) ? 3 : unavailableItems(o).length ? 0 : readyItems(o).length ? 1 : 2);
  const open = orders
    .filter(onFloor)
    .sort((a, b) => urgency(a) - urgency(b) || new Date(a.created_at) - new Date(b.created_at));
  // Takeaway and delivery have no table, so they show only while every floor is in view.
  const inPlace = (o) => (o.type === 'dine_in' ? !narrowed || place.areaIds.includes(o.area_id) : !narrowed);
  const visible = open.filter((o) => (filter === 'all' || o.type === filter) && inPlace(o));

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Given Orders" />}>
      <View style={{ marginBottom: 8 }}>
        <AreaPicker {...place.picker} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} style={{ flexGrow: 0, marginBottom: 12 }}>
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
          text={open.length === 0 ? 'Orders you send to the kitchen are listed here until the table is closed.' : 'Choose another filter to see the rest.'}
        />
      ) : (
        <View style={{ gap: t.d.gap }}>
          {visible.map((order) => {
            const ready = readyItems(order).length;
            const unavailable = unavailableItems(order).length;
            const count = liveItems(order).length;
            const paid = !isOpen(order);
            return (
              <Pressable
                key={order.id}
                onPress={() => router.push(`/given-orders/${order.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${orderLabel(order)}, order ${order.number}`}
                style={({ pressed }) => [
                  {
                    gap: 12,
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
                      {order.type === 'dine_in' && order.area_name ? ` · ${order.area_name}` : ''}
                    </Txt>
                  </View>
                  <TimerChip since={order.created_at} now={now} />
                  <Icon name="chevron-right" color="textSecondary" />
                </View>
                <OrderTags order={order} size={13} />
                {paid ? (
                  <Txt size={13} weight={600} color="successText">
                    {order.type === 'dine_in' ? 'Close the table when the guests leave.' : 'Complete the order.'}
                  </Txt>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
