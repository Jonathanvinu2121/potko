import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../../../../src/lib/api';
import { clock, count, dayTime, duration, money } from '../../../../../src/lib/format';
import { ROLE_LABEL } from '../../../../../src/lib/roles';
import { describe, when } from '../../../../../src/lib/audit';
import { bucketLabel, bucketName, isDay, periodQuery } from '../../../../../src/lib/reports';
import { Screen } from '../../../../../src/components/Screen';
import { AppHeader } from '../../../../../src/components/AppHeader';
import { Txt } from '../../../../../src/components/Txt';
import { Chip } from '../../../../../src/components/Chip';
import { ListState } from '../../../../../src/components/Feedback';
import { Avatar } from '../../../../../src/components/Picture';
import { Bars } from '../../../../../src/components/Charts';
import { RangeBar, Kpi, Panel, Empty } from '../../../../../src/components/ReportBits';

// How long a session lasted, or has lasted so far.
const sessionLength = (s) => duration((new Date(s.ended_at ?? s.last_seen_at).getTime() - new Date(s.created_at).getTime()) / 60000);

// More > Reports > Staff > one person: their numbers, trend, what they did and hours signed in,
// over a period that can be changed here.
export default function StaffReport() {
  const params = useLocalSearchParams();
  const id = Number(params.id);
  const [period, setPeriod] = useState(() =>
    params.range === 'custom' && isDay(String(params.from)) && isDay(String(params.to)) ? { range: 'custom', from: String(params.from), to: String(params.to) } : { range: params.range ? String(params.range) : '7d' }
  );
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const query = periodQuery(period);

  const load = () => {
    setError(null);
    api(`/reports/staff/${id}?${query}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };
  useEffect(load, [id, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const person = data?.person;
  const trend = data ? data.trend.map((row) => ({ label: bucketLabel(row.bucket, data.period.unit), hint: bucketName(row.bucket, data.period.unit), value: Number(row.value) || 0 })) : [];

  return (
    <Screen header={<AppHeader title={person?.name ?? 'Staff Report'} subtitle={person ? `${ROLE_LABEL[person.role]} · ${data.period.label}` : undefined} back />}>
      <View style={{ gap: 14 }}>
        <RangeBar period={period} onChange={setPeriod} />
        {!data ? (
          <ListState loading={!error} error={error} onRetry={load} rows={4} rowHeight={96} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={person.name} size={52} />
              <View style={{ flex: 1 }}>
                <Txt size={18} weight={700}>
                  {person.name}
                </Txt>
                <Txt size={13} color="textSecondary">
                  {ROLE_LABEL[person.role]}
                  {person.deleted ? ' · no longer on the staff list' : person.active ? '' : ' · inactive'}
                </Txt>
              </View>
              <Chip label={person.hours == null ? 'Hours not recorded' : `${person.hours} h signed in`} icon="clock-outline" size={12} />
            </View>

            {person.role === 'chef' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Kpi label="Dishes Prepared" value={count(person.items_prepared)} icon="food-outline" />
                <Kpi label="Tickets Completed" value={count(person.tickets_completed)} icon="receipt-text-outline" />
                <Kpi label="Avg Prep Time" value={person.avg_prep_minutes == null ? '—' : duration(person.avg_prep_minutes)} icon="timer-outline" hint={person.avg_prep_minutes == null ? 'Not enough data' : undefined} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <Kpi label="Orders Handled" value={count(person.orders_handled)} icon="clipboard-text-outline" />
                <Kpi label="Orders Served" value={count(person.orders_served)} icon="check-circle-outline" />
                <Kpi label="Sales Handled" value={money(person.sales_handled)} icon="chart-line" hint="Net sales of paid bills" />
                <Kpi label="Payments Collected" value={money(person.payments_collected)} icon="cash-multiple" hint="Less refunds" />
              </View>
            )}

            <Panel title={data.trend_label} note="Cancelled, removed and voided work is not counted.">
              {trend.some((r) => r.value > 0) ? <Bars data={trend} format={count} /> : <Empty />}
            </Panel>

            <Panel title="Hours signed in" note="From sign-in to sign-out on each device. A session still open counts up to when it was last seen.">
              {data.sessions.length === 0 ? <Empty text="No sessions in this period." /> : null}
              {data.sessions.slice(0, 10).map((s) => (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                  <Txt size={13} style={{ flex: 1 }} numberOfLines={1}>
                    {dayTime(s.created_at)} – {s.ended_at ? clock(s.ended_at) : 'still signed in'}
                  </Txt>
                  <Txt size={13} weight={600} tabular>
                    {sessionLength(s)}
                  </Txt>
                </View>
              ))}
            </Panel>

            <Panel title="Activity" note={data.activity.length >= 60 ? 'The latest 60 actions in this period.' : undefined}>
              {data.activity.length === 0 ? <Empty text="Nothing recorded in this period." /> : null}
              {data.activity.map((entry) => (
                <View key={entry.id} style={{ gap: 1 }}>
                  <Txt size={14}>{describe(entry)}</Txt>
                  <Txt size={12} color="textSecondary">
                    {when(entry.at)}
                  </Txt>
                </View>
              ))}
            </Panel>
          </>
        )}
      </View>
    </Screen>
  );
}
