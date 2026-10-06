import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { api } from '../../../src/lib/api';
import { useNow } from '../../../src/lib/useNow';
import { dayRange, rangeQuery, when } from '../../../src/lib/audit';
import { money, orderLabel } from '../../../src/lib/format';
import { isOpen, ORDER_STATUS, TYPE_ICON } from '../../../src/lib/orders';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { Row } from '../../../src/components/Bits';
import { TimerChip } from '../../../src/components/TimerChip';

const VIEWS = [
  { key: 'live', label: 'Open now' },
  { key: 0, label: 'Today' },
  { key: -1, label: 'Yesterday' },
];
const TYPES = [
  { key: null, label: 'All types' },
  { key: 'dine_in', label: 'Dine-in' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'takeaway', label: 'Takeaway' },
];

// Orders: everything open right now (live), or the whole of a day including paid and cancelled.
// Opening an order shows it read-only with its full history.
export default function Orders() {
  const t = useTheme();
  const router = useRouter();
  const liveOrders = useLive((s) => s.orders);
  const now = useNow();
  const [view, setView] = useState('live');
  const [type, setType] = useState(null);
  const [history, setHistory] = useState(null); // null = loading
  const [error, setError] = useState(null);

  const load = () => {
    if (view === 'live') return;
    setHistory(null);
    setError(null);
    api(`/orders?${rangeQuery(dayRange(view))}`)
      .then((r) => setHistory(r.orders))
      .catch((err) => setError(err.message));
  };
  useEffect(load, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = view === 'live' ? liveOrders.filter(isOpen).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) : history;
  const orders = source?.filter((o) => !type || o.type === type);

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Orders" />}>
      <View style={{ gap: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {VIEWS.map((v) => (
            <Chip key={String(v.key)} label={v.label} selected={view === v.key} onPress={() => setView(v.key)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TYPES.map((x) => (
            <Chip key={String(x.key)} label={x.label} selected={type === x.key} onPress={() => setType(x.key)} />
          ))}
        </ScrollView>

        {error ? (
          <View style={{ gap: 12 }}>
            <EmptyState icon="wifi-off" title="Couldn’t load orders" text={error} />
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : !orders ? (
          [0, 1, 2].map((n) => <Skeleton key={n} height={56} radius={t.radius.control} />)
        ) : orders.length === 0 ? (
          <EmptyState icon="receipt-text-outline" title="No orders" text={view === 'live' ? 'Nothing is open right now.' : 'No orders match on this day.'} />
        ) : (
          orders.map((order) => {
            const status = ORDER_STATUS[order.status];
            return (
              <Row
                key={order.id}
                icon={TYPE_ICON[order.type]}
                title={`${orderLabel(order)} · #${order.number}`}
                subtitle={`${order.waiter_name} · ${money(order.total)}${view === 'live' ? '' : ` · ${when(order.created_at)}`}`}
                onPress={() => router.push(`/orders/${order.id}`)}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Chip label={order.at_counter ? 'At counter' : status.label} icon={order.at_counter ? 'cash-register' : status.icon} tone={order.at_counter ? 'warning' : status.tone} />
                    {isOpen(order) ? <TimerChip since={order.created_at} now={now} /> : null}
                  </View>
                }
              />
            );
          })
        )}
      </View>
    </Screen>
  );
}
