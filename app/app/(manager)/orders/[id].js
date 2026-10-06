import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { api } from '../../../src/lib/api';
import { describe, when } from '../../../src/lib/audit';
import { money, orderLabel } from '../../../src/lib/format';
import { ITEM_STATUS, ORDER_STATUS, TYPE_LABEL, TYPE_ICON } from '../../../src/lib/orders';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { ItemRow } from '../../../src/components/ItemRow';
import { Section } from '../../../src/components/Bits';

// One order, read-only, with its full trail: who sent it, every edit, removal, discount,
// cancel request, approval and payment, each with the person and the time.
export default function OrderDetail() {
  const t = useTheme();
  const id = Number(useLocalSearchParams().id);
  // While the order is open, the live copy keeps this screen current; its history is re-read on each change.
  const live = useLive((s) => s.orders.find((o) => o.id === id));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const stamp = live ? `${live.status}|${live.total}|${live.items.map((i) => i.status).join()}|${live.pending_approvals.length}` : '';
  const load = () => {
    setError(null);
    api(`/orders/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };
  useEffect(load, [id, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = data?.order;

  if (!order) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']} header={<AppHeader title="Order" back />}>
        {error ? (
          <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
            <EmptyState icon="wifi-off" title="Couldn’t load this order" text={error} />
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : (
          <View style={{ gap: 12, paddingTop: 16 }}>
            <Skeleton height={48} />
            <Skeleton height={180} />
          </View>
        )}
      </Screen>
    );
  }

  const status = ORDER_STATUS[order.status];
  const line = (label, value, strong) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Txt color={strong ? 'text' : 'textSecondary'} weight={strong ? 700 : 400} size={strong ? 17 : 15}>
        {label}
      </Txt>
      <Txt weight={strong ? 700 : 600} size={strong ? 20 : 15} tabular>
        {value}
      </Txt>
    </View>
  );

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title={`${orderLabel(order)} · #${order.number}`} back />}>
      <View style={{ gap: 20 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label={TYPE_LABEL[order.type]} icon={TYPE_ICON[order.type]} tone="primary" />
          <Chip label={order.at_counter ? 'At manager counter' : status.label} icon={status.icon} tone={order.at_counter ? 'warning' : status.tone} />
          <Chip label={`Waiter: ${order.waiter_name}`} icon="account-outline" />
          <Chip label={when(order.created_at)} icon="clock-outline" />
          {order.payment_method ? <Chip label={`Paid by ${order.payment_method}`} icon="cash-check" tone="success" /> : null}
        </View>
        {order.customer_phone || order.delivery_address ? (
          <Txt size={13} color="textSecondary">
            {[order.customer_phone, order.delivery_address].filter(Boolean).join(' · ')}
          </Txt>
        ) : null}

        <Card style={{ gap: 16 }}>
          {order.items.map((item, index) => (
            <View key={item.id} style={[index > 0 && { paddingTop: 16, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }]}>
              <ItemRow
                qty={item.qty}
                name={item.name_snapshot}
                veg={item.veg}
                size={item.size}
                customisations={item.customisations}
                note={item.note}
                allergyNote={item.allergy_note}
                done={['removed', 'cancelled', 'unavailable'].includes(item.status)}
                right={
                  <Txt size={15} weight={700} tabular>
                    {money(item.qty * item.unit_price)}
                  </Txt>
                }
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <Chip label={ITEM_STATUS[item.status].label} icon={ITEM_STATUS[item.status].icon} tone={ITEM_STATUS[item.status].tone} />
                  {item.unavailable_reason ? (
                    <Txt size={13} color="error">
                      {item.unavailable_reason}
                    </Txt>
                  ) : null}
                </View>
              </ItemRow>
            </View>
          ))}
        </Card>

        <Card style={{ gap: 6 }}>
          {line('Subtotal', money(order.subtotal))}
          {line(`Discount ${order.discount_pct}%`, `− ${money(order.discount_amount)}`)}
          {line('Total', money(order.total), true)}
        </Card>

        <Section title={`History (${data.audit.length})`}>
          {data.audit.length === 0 ? (
            <Txt size={13} color="textSecondary">
              Nothing recorded yet.
            </Txt>
          ) : (
            <Card style={{ gap: 12 }}>
              {data.audit.map((entry) => (
                <View key={entry.id} style={{ gap: 2 }}>
                  <Txt size={14} weight={600}>
                    {describe(entry)}
                  </Txt>
                  <Txt size={12} color="textSecondary" tabular>
                    {entry.user_name || 'System'}
                    {entry.user_role ? ` (${entry.user_role})` : ''} · {when(entry.at)}
                  </Txt>
                </View>
              ))}
            </Card>
          )}
        </Section>
      </View>
    </Screen>
  );
}
