import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../src/theme';
import { api } from '../../src/lib/api';
import { dayRange, rangeQuery, describe, when } from '../../src/lib/audit';
import { money } from '../../src/lib/format';
import { TYPE_LABEL } from '../../src/lib/orders';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';
import { Stat, Section } from '../../src/components/Bits';

const METHOD_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card' };

// Reports: one day at a time. Sales, orders by type, top dishes, and every cancel and discount.
export default function Reports() {
  const t = useTheme();
  const [offset, setOffset] = useState(0); // 0 = today, -1 = yesterday, ...
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const range = dayRange(offset);

  const load = () => {
    setReport(null);
    setError(null);
    api(`/reports/daily?${rangeQuery(dayRange(offset))}`)
      .then(setReport)
      .catch((err) => setError(err.message));
  };
  useEffect(load, [offset]); // eslint-disable-line react-hooks/exhaustive-deps

  // A plain table: label on the left, numbers on the right.
  const table = (rows, empty) =>
    rows.length === 0 ? (
      <Txt size={13} color="textSecondary">
        {empty}
      </Txt>
    ) : (
      <Card style={{ gap: 10 }}>
        {rows.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Txt style={{ flex: 1 }}>{r.label}</Txt>
            <Txt size={13} color="textSecondary" tabular>
              {r.count}
            </Txt>
            <Txt weight={700} tabular style={{ minWidth: 80, textAlign: 'right' }}>
              {money(r.total)}
            </Txt>
          </View>
        ))}
      </Card>
    );

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Reports" />}>
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Button title="Earlier" icon="chevron-left" variant="secondary" onPress={() => setOffset((o) => o - 1)} />
          <Txt size={17} weight={700} center style={{ flex: 1 }}>
            {range.label}
          </Txt>
          <Button title="Later" icon="chevron-right" variant="secondary" disabled={offset === 0} onPress={() => setOffset((o) => o + 1)} />
        </View>

        {error ? (
          <View style={{ gap: 12 }}>
            <EmptyState icon="wifi-off" title="Couldn’t load the report" text={error} />
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : !report ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={90} radius={t.radius.card} />
            <Skeleton height={140} radius={t.radius.card} />
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.d.gap }}>
              <Stat label="Sales (paid)" value={money(report.sales.total)} icon="cash-multiple" />
              <Stat label="Paid orders" value={report.sales.orders} icon="receipt-text-check-outline" />
              <Stat label="Discounts given" value={money(report.sales.discounts)} icon="percent-outline" />
              {offset === 0 ? <Stat label={`Still open (${report.open.orders})`} value={money(report.open.total)} icon="receipt-text-outline" /> : null}
            </View>

            <Section title="By payment method">
              {table(report.byMethod.map((m) => ({ label: METHOD_LABEL[m.method] || m.method, count: `${m.orders} orders`, total: m.total })), 'No payments on this day.')}
            </Section>
            <Section title="By order type">
              {table(report.byType.map((x) => ({ label: TYPE_LABEL[x.type], count: `${x.orders} orders`, total: x.total })), 'No paid orders on this day.')}
            </Section>
            <Section title="Top dishes">
              {table(report.topItems.map((x) => ({ label: x.name, count: `${x.qty} sold`, total: x.total })), 'Nothing sold on this day.')}
            </Section>

            <Section title={`Cancels, discounts and unavailable items (${report.log.length})`}>
              {report.log.length === 0 ? (
                <Txt size={13} color="textSecondary">
                  None on this day.
                </Txt>
              ) : (
                <Card style={{ gap: 12 }}>
                  {report.log.map((entry) => (
                    <View key={entry.id} style={{ gap: 2 }}>
                      <Txt size={14} weight={600}>
                        {describe(entry)}
                      </Txt>
                      <Txt size={12} color="textSecondary" tabular>
                        {entry.user_name} ({entry.user_role}) · {when(entry.at)}
                      </Txt>
                    </View>
                  ))}
                </Card>
              )}
            </Section>
          </>
        )}
      </View>
    </Screen>
  );
}
