import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth, useCan } from '../../src/store/auth';
import { useLive } from '../../src/store/live';
import { useMenu } from '../../src/store/menu';
import { api } from '../../src/lib/api';
import { useNow, minutesSince } from '../../src/lib/useNow';
import { money, count, orderLabel, duration, tableName, plural } from '../../src/lib/format';
import { isOpen, APPROVAL_TYPES } from '../../src/lib/orders';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Skeleton } from '../../src/components/Skeleton';
import { IconTile } from '../../src/components/Picture';
import { Section } from '../../src/components/Bits';
import { GettingStarted } from '../../src/components/GettingStarted';

const greeting = (hour) => (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
const hours = (time) => {
  const [h, m] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

// One number of the KPI row: value, label, and the change against yesterday at this time (shown
// only when there is something to compare with).
function Kpi({ label, value, now, before }) {
  const t = useTheme();
  const change = before > 0 ? Math.round(((now - before) / before) * 100) : null;
  return (
    <View
      accessibilityLabel={`${label} ${value}${change === null ? '' : `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on yesterday`}`}
      style={{ flexGrow: 1, flexBasis: 72, gap: 2, paddingVertical: 10, paddingHorizontal: 10, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}
    >
      <Txt size={18} weight={700} tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      <Txt size={12} color="textSecondary" numberOfLines={1}>
        {label}
      </Txt>
      {change === null ? null : (
        <Txt size={12} weight={600} color={change >= 0 ? 'successText' : 'error'} tabular>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
        </Txt>
      )}
    </View>
  );
}

// One tile of the Restaurant Service row: Dine-in, Takeaway, Delivery.
function ServiceTile({ icon, label, text, sub }) {
  const t = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 90, alignItems: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: 6, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
      <Icon name={icon} size={26} color="primary" />
      <Txt size={13} weight={700}>
        {label}
      </Txt>
      <Txt size={12} color="textSecondary" center>
        {text}
      </Txt>
      {sub ? (
        <Txt size={11} color="textSecondary" center>
          {sub}
        </Txt>
      ) : null}
    </View>
  );
}

// Overview: is the restaurant running normally, and what needs the manager's attention?
// A place to glance at and jump from. The orders themselves live under Orders.
export default function Overview() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const settings = useAuth((s) => s.restaurant?.settings);
  const orders = useLive((s) => s.orders);
  const approvals = useLive((s) => s.approvals);
  const liveTables = useLive((s) => s.tables);
  // Whole tables only: a split table counts once, and it is in use while any part is.
  const wholeTables = liveTables.filter((x) => x.active && !x.parent_table_id);
  const tablesAll = wholeTables.length;
  const tablesBusy = wholeTables.filter((x) => (x.status === 'split' ? liveTables.some((p) => p.parent_table_id === x.id && p.status !== 'free') : x.status !== 'free')).length;
  const decides = useCan('approvals.decide');
  const collects = useCan('payments.collect');
  const menuItems = useMenu((s) => s.items);
  const loadMenu = useMenu((s) => s.load);
  const now = useNow();
  const [data, setData] = useState(null);

  useEffect(() => {
    loadMenu();
  }, [loadMenu]);

  // The day's numbers come from paid bills, so they are read again each time the screen is
  // opened and whenever a bill is settled.
  const paidCount = orders.filter((o) => o.paid_at).length;
  useFocusEffect(
    useCallback(() => {
      api('/overview')
        .then(setData)
        .catch(() => {});
    }, [paidCount]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const open = orders.filter(isOpen);
  const delayAfter = settings?.kitchen_delay_minutes ?? 15;
  const attention = [];

  // Kitchen delays: a dish sent to the kitchen and still not ready after the set time.
  for (const order of open) {
    const waiting = order.items.filter((i) => ['sent', 'accepted', 'preparing'].includes(i.status));
    if (waiting.length === 0) continue;
    const longest = Math.max(...waiting.map((i) => minutesSince(i.created_at, now)));
    if (longest >= delayAfter) {
      attention.push({ key: `delay-${order.id}`, icon: 'clock-alert-outline', tone: 'error', title: `Kitchen delay · ${orderLabel(order)}`, text: `Order #${order.number} · ${waiting.length} dish${waiting.length === 1 ? '' : 'es'} waiting ${duration(longest)}`, to: `/orders/${order.id}`, weight: 1000 + longest });
    }
  }
  if (decides) {
    for (const a of approvals) {
      const kind = APPROVAL_TYPES[a.type] ?? APPROVAL_TYPES.discount;
      attention.push({ key: `approval-${a.id}`, icon: kind.icon, tone: kind.tone, title: `${kind.title} waiting`, text: `${a.table_label ? tableName(a.table_label) : `Order #${a.order_number}`} · asked by ${a.requested_by_name} ${duration(minutesSince(a.created_at, now))} ago`, to: `/payments/approval/${a.id}`, weight: 900 + minutesSince(a.created_at, now) });
    }
  }
  for (const order of open.filter((o) => o.bill_requested_at)) {
    attention.push({ key: `bill-${order.id}`, icon: 'receipt-text-outline', tone: 'warning', title: `Bill requested · ${orderLabel(order)}`, text: `Order #${order.number} · ${money(order.total)} · waiting ${duration(minutesSince(order.bill_requested_at, now))}`, to: collects ? `/payments/bill/${order.id}` : `/orders/${order.id}`, weight: 500 + minutesSince(order.bill_requested_at, now) });
  }
  for (const order of open) {
    const stuck = order.items.filter((i) => i.status === 'unavailable');
    if (stuck.length) attention.push({ key: `unavailable-${order.id}`, icon: 'close-circle-outline', tone: 'error', title: `Kitchen could not make ${stuck.length === 1 ? stuck[0].name_snapshot : `${stuck.length} dishes`}`, text: `${orderLabel(order)} · the waiter must replace or remove ${stuck.length === 1 ? 'it' : 'them'}`, to: `/orders/${order.id}`, weight: 400 });
  }
  for (const item of menuItems.filter((m) => !m.available)) {
    attention.push({ key: `stock-${item.id}`, icon: 'food-off-outline', tone: 'neutral', title: `Switched off: ${item.name}`, text: 'Waiters cannot order it until it is switched on again', to: `/more/menu/item?id=${item.id}`, weight: 10 });
  }
  attention.sort((a, b) => b.weight - a.weight);
  const [allShown, setAllShown] = useState(false);
  const shownAttention = allShown ? attention : attention.slice(0, 4);
  const occupancy = tablesAll ? Math.round((tablesBusy / tablesAll) * 100) : 0;
  const ofType = (type) => open.filter((o) => o.type === type);
  const dineIn = ofType('dine_in');

  const date = new Date(now);
  const service = data?.service;
  const today = data?.today;
  const before = data?.previous;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Overview" />}>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt size={22} weight={700}>
              {greeting(date.getHours())}, {user?.name?.split(' ')[0]}
            </Txt>
            <Txt size={13} color="textSecondary">
              {date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })} · {date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </Txt>
          </View>
        </View>

        {/* A new restaurant's first steps; gone once they are done. */}
        <GettingStarted />

        {!data ? (
          <Skeleton height={120} radius={t.radius.card} />
        ) : (
          <View style={{ gap: 10, padding: 16, borderRadius: t.radius.card, backgroundColor: t.c.primary }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt size={18} weight={700} color="onPrimary" style={{ flexShrink: 1 }}>
                {service ? service.name : 'No service right now'}
              </Txt>
              {service ? (
                <Txt size={13} weight={700} color="onPrimary">
                  · {service.live ? 'Live' : `Starts ${hours(service.from)}`}
                </Txt>
              ) : null}
            </View>
            {service ? (
              <Txt size={13} color="onPrimary" tabular>
                {hours(service.from)} – {hours(service.to)}
              </Txt>
            ) : null}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <View>
                  <Txt size={13} weight={600} color="onPrimary">
                    Table Occupancy
                  </Txt>
                  <Txt size={12} color="onPrimary" tabular>
                    {tablesBusy} / {tablesAll} tables
                  </Txt>
                </View>
                <Txt size={22} weight={700} color="onPrimary" tabular>
                  {occupancy}%
                </Txt>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: t.c.primaryTint, overflow: 'hidden' }}>
                <View style={{ width: `${occupancy}%`, height: 8, borderRadius: 4, backgroundColor: t.c.onPrimary }} />
              </View>
            </View>
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Kpi label="Net Sales" value={today ? money(Math.round(today.net_sales)) : '—'} now={today?.net_sales} before={before?.net_sales} />
          <Kpi label="Orders" value={today ? count(today.orders) : '—'} now={today?.orders} before={before?.orders} />
          <Kpi label="Guests" value={today ? count(today.guests) : '—'} now={today?.guests} before={before?.guests} />
          <Kpi label="Avg Order" value={today ? money(Math.round(today.average_order)) : '—'} now={today?.average_order} before={before?.average_order} />
        </View>

        <Section title="Restaurant Service">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <ServiceTile icon="silverware-fork-knife" label="Dine-in" text={`${dineIn.length} ${dineIn.length === 1 ? 'table' : 'tables'}`} sub={`${dineIn.reduce((n, o) => n + (o.guests || 0), 0)} guests`} />
            <ServiceTile icon="shopping-outline" label="Takeaway" text={plural(ofType('takeaway').length, 'order')} />
            <ServiceTile icon="moped-outline" label="Delivery" text={plural(ofType('delivery').length, 'order')} />
          </View>
        </Section>

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={18} weight={700} color="primary">
              Attention · {attention.length}
            </Txt>
            {attention.length > 4 ? (
              <Pressable onPress={() => setAllShown((v) => !v)} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}>
                <Txt size={14} weight={600}>
                  {allShown ? 'Show less' : 'View all'}
                </Txt>
                <Icon name={allShown ? 'chevron-up' : 'arrow-right'} size={18} />
              </Pressable>
            ) : null}
          </View>
          {attention.length === 0 ? (
            <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
              <IconTile icon="check-all" tone="success" />
              <Txt size={17} weight={700}>
                All caught up
              </Txt>
              <Txt size={13} color="textSecondary" center>
                No kitchen delays, no requests waiting and no bills to settle.
              </Txt>
            </Card>
          ) : (
            shownAttention.map((row) => (
              <Pressable
                key={row.key}
                onPress={() => router.push(row.to)}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}. ${row.text}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 10,
                  borderRadius: t.radius.card,
                  borderWidth: t.borderWidth,
                  borderColor: t.c.border,
                  backgroundColor: pressed ? t.c.pressed : t.c.card,
                })}
              >
                <IconTile icon={row.icon} tone={row.tone} size={38} solid />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600} numberOfLines={2}>
                    {row.title}
                  </Txt>
                  <Txt size={13} color="textSecondary" numberOfLines={2}>
                    {row.text}
                  </Txt>
                </View>
                <View style={{ paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: t.radius.control, backgroundColor: t.c.primaryTint }}>
                  <Txt size={13} weight={700} color="primary">
                    {row.key.startsWith('approval') ? 'Review' : 'View'}
                  </Txt>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </View>
    </Screen>
  );
}
