import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { api } from '../../../../src/lib/api';
import { count, duration, money, money2, plural } from '../../../../src/lib/format';
import { TYPE_LABEL, methodLabel } from '../../../../src/lib/orders';
import { bucketLabel, bucketName, change, hourName, periodQuery } from '../../../../src/lib/reports';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Chip } from '../../../../src/components/Chip';
import { Tabs, Line } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';
import { Avatar } from '../../../../src/components/Picture';
import { Bars, RankBars, ShareBars } from '../../../../src/components/Charts';
import { RangeBar, Kpi, Panel, Empty } from '../../../../src/components/ReportBits';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'sales', label: 'Sales' },
  { value: 'menu', label: 'Menu' },
  { value: 'orders', label: 'Orders' },
  { value: 'staff', label: 'Staff' },
];

const NET_NOTE = 'Paid bills after discounts and before tax, by when they were paid. Refunds are taken off in the totals above, not in this chart.';
const trendOf = (data, key) => data.trend.map((row) => ({ label: bucketLabel(row.bucket, data.period.unit), hint: bucketName(row.bucket, data.period.unit), value: Number(row[key]) || 0 }));
const any = (rows) => rows.some((r) => r.value > 0);
const UNIT_WORD = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

function OverviewReport({ data }) {
  const k = data.kpis;
  const p = data.previous;
  const sales = trendOf(data, 'net_sales');
  const orders = trendOf(data, 'orders');
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <Kpi label="Net Sales" value={money(k.net_sales)} icon="chart-line" compared move={change(k.net_sales, p?.net_sales)} />
        <Kpi label="Orders" value={count(k.orders)} icon="receipt-text-outline" compared move={change(k.orders, p?.orders)} />
        <Kpi label="Avg Order Value" value={money(k.average_order)} icon="calculator-variant-outline" compared move={change(k.average_order, p?.average_order)} />
        <Kpi label="Discounts Given" value={money(k.discounts)} icon="tag-outline" compared move={change(k.discounts, p?.discounts)} />
        <Kpi label="Items Sold" value={count(k.items_sold)} icon="food-outline" hint="Dishes on paid bills" />
        <Kpi label="Table Turnover" value={k.table_turnover == null ? '—' : `${k.table_turnover}×`} icon="table-furniture" hint={k.table_turnover == null ? 'No tables set up' : 'Parties per table per day'} />
      </View>
      <Panel title={`Net sales by ${UNIT_WORD[data.period.unit]}`} note={NET_NOTE}>
        {any(sales) ? <Bars data={sales} format={money} /> : <Empty text="No paid bills in this period yet." />}
      </Panel>
      <Panel title={`Paid orders by ${UNIT_WORD[data.period.unit]}`}>
        {any(orders) ? <Bars data={orders} format={count} tone="success" /> : <Empty text="No paid bills in this period yet." />}
      </Panel>
      <Txt size={12} color="textSecondary">
        {p ? 'Compared with the same length of time just before this period.' : 'There were no sales in the period just before this one, so no comparison is shown.'}
      </Txt>
    </>
  );
}

function SalesReport({ data }) {
  const s = data.totals;
  const methods = data.by_method.map((m) => ({ label: methodLabel(m.method), sub: plural(m.payments, 'payment'), value: Math.max(0, m.amount - m.refunds) }));
  const types = data.by_type.map((x) => ({ label: TYPE_LABEL[x.type] ?? x.type, sub: plural(x.orders, 'order'), value: Number(x.net_sales) }));
  const trend = trendOf(data, 'net_sales');
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi label="Net Sales" value={money(s.net_sales)} icon="chart-line" hint="After discounts, before tax" />
        <Kpi label="Collected" value={money(s.collected)} icon="cash-multiple" hint="Money taken, less refunds" />
      </View>
      <Panel title="How the bills add up" note={`${plural(s.orders, 'paid bill')}. Gross sales is the menu value of what was sold; cancelled and voided dishes are not in it.`}>
        <Line label="Gross sales" value={money2(s.gross)} />
        <Line label="Discounts" value={money2(-s.discounts)} tone={s.discounts > 0 ? 'error' : 'text'} muted />
        {s.service_charge > 0 ? <Line label="Service charge" value={money2(s.service_charge)} muted /> : null}
        <Line label="Taxable value" value={money2(s.taxable)} />
        {data.tax_lines.length ? data.tax_lines.map((tax) => <Line key={tax.label} label={tax.label} value={money2(tax.amount)} muted />) : <Line label="Tax" value={money2(s.tax)} muted />}
        {Number(s.round_off) ? <Line label="Round off" value={money2(s.round_off)} muted /> : null}
        <Line label="Billed" value={money2(s.billed)} strong />
        <Line label="Refunds" value={money2(-s.refunds)} tone={s.refunds > 0 ? 'error' : 'text'} muted />
      </Panel>
      <Panel title="By payment method" note="Money taken by each method, less refunds given by it.">
        {methods.length ? <ShareBars data={methods} format={money} /> : <Empty text="No payments in this period yet." />}
      </Panel>
      <Panel title="By order type" note="Net sales of paid bills.">
        {types.length ? <ShareBars data={types} format={money} /> : <Empty text="No paid bills in this period yet." />}
      </Panel>
      <Panel title={`Net sales by ${UNIT_WORD[data.period.unit]}`} note={NET_NOTE}>
        {any(trend) ? <Bars data={trend} format={money} /> : <Empty text="No paid bills in this period yet." />}
      </Panel>
    </>
  );
}

function MenuReport({ data }) {
  const [by, setBy] = useState('qty');
  const top = (by === 'qty' ? data.top_by_qty : data.top_by_revenue).map((i) => ({ label: i.name, sub: `${i.category} · ${by === 'qty' ? money(i.revenue) : `${i.qty} sold`}`, value: Number(by === 'qty' ? i.qty : i.revenue) }));
  const least = data.least_ordered.map((i) => ({ label: i.name, sub: `${i.category} · ${money(i.revenue)}`, value: i.qty }));
  const categories = data.categories.map((c) => ({ label: c.category, sub: `${c.qty} sold`, value: Number(c.revenue) }));
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi label="Items Sold" value={count(data.totals.items_sold)} icon="food-outline" hint={`${plural(data.totals.different_items, 'different dish', 'different dishes')}`} />
        <Kpi label="Menu Revenue" value={money(data.totals.revenue)} icon="chart-line" hint="Menu value, before discounts and tax" />
      </View>
      <Panel
        title="Top items"
        right={
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="By quantity" size={12} selected={by === 'qty'} onPress={() => setBy('qty')} />
            <Chip label="By revenue" size={12} selected={by === 'revenue'} onPress={() => setBy('revenue')} />
          </View>
        }
      >
        {top.length ? <RankBars data={top} format={by === 'qty' ? count : money} /> : <Empty text="Nothing was sold in this period." />}
      </Panel>
      <Panel title="Category performance" note="Share of menu revenue.">
        {categories.length ? <ShareBars data={categories} format={money} /> : <Empty text="Nothing was sold in this period." />}
      </Panel>
      <Panel title="Least ordered" note="Dishes that sold at least once in this period, fewest first.">
        {least.length ? <RankBars data={least} format={count} tone="warningTint" numbered={false} /> : <Empty text="Nothing was sold in this period." />}
      </Panel>
      <Panel title={`Never ordered (${data.never_ordered.length})`} note="On the menu now and not sold once in this period.">
        {data.never_ordered.length === 0 ? (
          <Empty text="Every dish on the menu sold at least once." />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {data.never_ordered.slice(0, 40).map((i) => (
              <Chip key={i.id} label={i.available ? i.name : `${i.name} (off)`} size={12} />
            ))}
            {data.never_ordered.length > 40 ? <Chip label={`+${data.never_ordered.length - 40} more`} size={12} /> : null}
          </View>
        )}
      </Panel>
    </>
  );
}

function OrdersReport({ data }) {
  const busy = data.by_hour.filter((h) => h.orders > 0).map((h) => h.hour);
  const hours = busy.length ? data.by_hour.slice(Math.max(0, Math.min(...busy) - 1), Math.min(24, Math.max(...busy) + 2)).map((h) => ({ label: `${h.hour % 12 || 12}${h.hour < 12 ? 'a' : 'p'}`, hint: hourName(h.hour), value: h.orders })) : [];
  const days = data.by_day.map((d) => ({ label: d.day, value: d.orders }));
  const types = data.by_type.map((x) => ({ label: TYPE_LABEL[x.type] ?? x.type, value: x.orders }));
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi label="Orders Taken" value={count(data.totals.orders)} icon="receipt-text-outline" hint={data.totals.cancelled ? `${plural(data.totals.cancelled, 'cancelled order')} not counted` : 'No cancelled orders'} />
        <Kpi label="Peak Hour" value={data.peak_hour ? hourName(data.peak_hour.hour) : '—'} icon="clock-outline" hint={data.peak_hour ? plural(data.peak_hour.orders, 'order') : 'Not enough data'} />
        <Kpi label="Avg Prep Time" value={data.prep ? duration(data.prep.minutes) : '—'} icon="timer-outline" hint={data.prep ? `Over ${plural(data.prep.dishes, 'dish', 'dishes')}` : 'Not enough data'} />
        <Kpi label="Avg Table Time" value={data.table_time ? duration(data.table_time.minutes) : '—'} icon="table-chair" hint={data.table_time ? `Over ${plural(data.table_time.tables, 'paid table')}` : 'Not enough data'} />
        {data.peak_day ? <Kpi label="Busiest Day" value={data.peak_day.day} icon="calendar-star" hint={plural(data.peak_day.orders, 'order')} /> : null}
      </View>
      <Panel title="Orders by hour" note="When orders were taken, on the restaurant's clock.">
        {hours.length ? <Bars data={hours} format={count} /> : <Empty text="No orders in this period yet." />}
      </Panel>
      {data.period.days > 1 ? (
        <Panel title="Orders by day of the week">{any(days) ? <Bars data={days} format={count} tone="success" /> : <Empty text="No orders in this period yet." />}</Panel>
      ) : null}
      <Panel title="Order types">{types.length ? <ShareBars data={types} format={count} /> : <Empty text="No orders in this period yet." />}</Panel>
      <Txt size={12} color="textSecondary">
        Orders are counted when they were taken; cancelled orders are left out. Prep time runs from a dish reaching the kitchen to "ready", and table time from the first dish to payment. Dishes and tables without both times are left out, not guessed.
      </Txt>
    </>
  );
}

// One ranked person: place, photo-less avatar, name, what they did, and the headline number.
function PersonRow({ rank, person, line, value, onPress }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rank}. ${person.name}. ${line}. ${value}. Open report.`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6, borderRadius: t.radius.control, backgroundColor: pressed ? t.c.pressed : 'transparent' })}
    >
      <Txt size={14} weight={700} color="textSecondary" tabular style={{ width: 18 }}>
        {rank}
      </Txt>
      <Avatar name={person.name} size={36} />
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={600} numberOfLines={1}>
          {person.name}
          {person.deleted ? <Txt size={12} color="textSecondary">{'  (left)'}</Txt> : null}
        </Txt>
        <Txt size={12} color="textSecondary" numberOfLines={2}>
          {line}
        </Txt>
      </View>
      <Txt size={15} weight={700} tabular>
        {value}
      </Txt>
      <Icon name="chevron-right" size={18} color="textSecondary" />
    </Pressable>
  );
}

const hoursText = (person) => (person.hours == null ? 'hours not recorded' : `${person.hours} h signed in`);

function StaffReport({ data, open }) {
  return (
    <>
      <Panel title="Waiters" note="Ranked by the net sales of the orders they took. Hours signed in are shown so a short shift is not read as poor work.">
        {data.waiters.length === 0 ? <Empty text="No waiters yet." /> : null}
        {data.waiters.map((w, i) => (
          <PersonRow key={w.id} rank={i + 1} person={w} line={`${plural(w.orders_handled, 'order')} · ${w.orders_served} served · collected ${money(w.payments_collected)} · ${hoursText(w)}`} value={money(w.sales_handled)} onPress={() => open(w.id)} />
        ))}
      </Panel>
      <Panel title="Chefs" note="Ranked by dishes marked ready. Dishes that were cancelled or could not be made are not counted.">
        {data.chefs.length === 0 ? <Empty text="No chefs yet." /> : null}
        {data.chefs.map((c, i) => (
          <PersonRow key={c.id} rank={i + 1} person={c} line={`${plural(c.tickets_completed, 'ticket')} · ${c.avg_prep_minutes == null ? 'no prep time yet' : `${duration(c.avg_prep_minutes)} average`} · ${hoursText(c)}`} value={`${count(c.items_prepared)} dishes`} onPress={() => open(c.id)} />
        ))}
      </Panel>
      {data.counter.length ? (
        <Panel title="Counter" note="Payments taken by cashiers and managers, less refunds.">
          {data.counter.map((c, i) => (
            <PersonRow key={c.id} rank={i + 1} person={c} line={hoursText(c)} value={money(c.payments_collected)} onPress={() => open(c.id)} />
          ))}
        </Panel>
      ) : null}
    </>
  );
}

// More > Reports: five reports over one chosen period. The server adds everything up, on the
// restaurant's business day and time zone.
export default function Reports() {
  const router = useRouter();
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState({ range: 'today' });
  const [cache, setCache] = useState({}); // "tab?query" -> the report
  const [error, setError] = useState(null);
  const query = periodQuery(period);
  const key = `${tab}?${query}`;
  const data = cache[key];

  const load = () => {
    setError(null);
    api(`/reports/${key}`)
      .then((result) => setCache((c) => ({ ...c, [key]: result })))
      .catch((err) => setError(err.message));
  };
  useEffect(load, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen header={<AppHeader title="Reports" subtitle={data ? data.period.label : 'Sales, orders, menu and staff'} back />}>
      <View style={{ gap: 14 }}>
        <RangeBar period={period} onChange={setPeriod} />
        <Tabs underline fit options={TABS} value={tab} onChange={setTab} />
        {!data ? (
          <ListState loading={!error} error={error} onRetry={load} rows={4} rowHeight={96} />
        ) : tab === 'overview' ? (
          <OverviewReport data={data} />
        ) : tab === 'sales' ? (
          <SalesReport data={data} />
        ) : tab === 'menu' ? (
          <MenuReport data={data} />
        ) : tab === 'orders' ? (
          <OrdersReport data={data} />
        ) : (
          <StaffReport data={data} open={(id) => router.push(`/more/reports/staff/${id}?${query}`)} />
        )}
      </View>
    </Screen>
  );
}
