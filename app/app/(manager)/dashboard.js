import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useLive } from '../../src/store/live';
import { api } from '../../src/lib/api';
import { useNow, minutesSince } from '../../src/lib/useNow';
import { dayRange, rangeQuery } from '../../src/lib/audit';
import { money, orderLabel } from '../../src/lib/format';
import { isOpen, ORDER_STATUS } from '../../src/lib/orders';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Chip } from '../../src/components/Chip';
import { Stat, Section, Row } from '../../src/components/Bits';
import { TimerChip } from '../../src/components/TimerChip';
import { EmptyState } from '../../src/components/EmptyState';

// Dashboard: the restaurant right now. Tables, open orders, anything running late,
// today's sales and what is waiting for the manager.
export default function Dashboard() {
  const t = useTheme();
  const router = useRouter();
  const tables = useLive((s) => s.tables);
  const orders = useLive((s) => s.orders);
  const approvals = useLive((s) => s.approvals);
  const now = useNow();
  const [sales, setSales] = useState(null);

  // Sales come from paid orders, so they are re-read each time the dashboard is opened
  // and whenever an order closes.
  const closedCount = orders.filter((o) => o.status === 'closed').length;
  useFocusEffect(
    useCallback(() => {
      api(`/reports/daily?${rangeQuery(dayRange(0))}`)
        .then((r) => setSales(r.sales))
        .catch(() => {});
    }, [closedCount]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const open = orders.filter(isOpen).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  // Late = not everything delivered yet and waiting 15 minutes or more.
  const late = open.filter((o) => o.status !== 'delivered' && minutesSince(o.created_at, now) >= 15);
  const free = tables.filter((x) => x.status === 'free').length;
  const atCounter = open.filter((o) => o.at_counter).length;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Dashboard" />}>
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.d.gap }}>
          <Stat label="Today’s sales" value={sales ? money(sales.total) : '—'} icon="cash-multiple" onPress={() => router.push('/reports')} />
          <Stat label="Paid orders today" value={sales ? sales.orders : '—'} icon="receipt-text-check-outline" />
          <Stat label="Open orders" value={open.length} icon="receipt-text-outline" onPress={() => router.push('/orders')} />
          <Stat label="Running late" value={late.length} icon="clock-alert-outline" tone={late.length ? 'error' : 'text'} />
          <Stat label="Tables free" value={`${free} of ${tables.length}`} icon="table-furniture" onPress={() => router.push('/tables')} />
          <Stat
            label="Waiting for you"
            value={approvals.length + atCounter}
            icon="shield-account-outline"
            tone={approvals.length + atCounter ? 'primary' : 'text'}
            onPress={() => router.push('/approvals')}
          />
        </View>

        <Section title={`Running late (${late.length})`}>
          {late.length === 0 ? (
            <Txt size={13} color="textSecondary">
              Nothing has waited 15 minutes or more.
            </Txt>
          ) : (
            late.map((order) => (
              <Row
                key={order.id}
                title={`${orderLabel(order)} · #${order.number}`}
                subtitle={`${ORDER_STATUS[order.status].label} · ${order.waiter_name}`}
                onPress={() => router.push(`/orders/${order.id}`)}
                right={<TimerChip since={order.created_at} now={now} />}
              />
            ))
          )}
        </Section>

        <Section title={`Open orders (${open.length})`}>
          {open.length === 0 ? (
            <EmptyState icon="receipt-text-outline" title="No open orders" text="Orders appear here the moment a waiter sends them." />
          ) : (
            open.map((order) => (
              <Row
                key={order.id}
                title={`${orderLabel(order)} · #${order.number}`}
                subtitle={`${order.waiter_name} · ${money(order.total)}`}
                onPress={() => router.push(`/orders/${order.id}`)}
                right={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {order.at_counter ? <Chip label="At counter" icon="cash-register" tone="warning" /> : <Chip label={ORDER_STATUS[order.status].label} icon={ORDER_STATUS[order.status].icon} tone={ORDER_STATUS[order.status].tone} />}
                    <TimerChip since={order.created_at} now={now} />
                  </View>
                }
              />
            ))
          )}
        </Section>
      </View>
    </Screen>
  );
}
