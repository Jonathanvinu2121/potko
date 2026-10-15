import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useCan } from '../store/auth';
import { useLive } from '../store/live';
import { send } from '../lib/ws';
import { toast } from '../store/toast';
import { tableAllowed } from '../lib/access';
import { groupLabel } from '../lib/units';
import { usePrices } from '../lib/prices';
import { money, plural } from '../lib/format';
import { itemCount } from '../lib/orders';
import { Screen } from '../components/Screen';
import { AppHeader } from '../components/AppHeader';
import { Txt } from '../components/Txt';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { RadioCard } from '../components/Lists';
import { Success, Notice } from '../components/Feedback';
import { useManyFloors } from '../components/AreaPicker';

// Transfer Table, in the three steps of the "finals" design:
//   Select   the free table to move to ("T5 · Free · 4 seats")
//   Preview  From T3 (4 people · 6 items · ₹1,300) -> To T5 (empty table · 4 seats)
//   Success  "Table Transferred Successfully!", with View Order and Done
// A party can move at any point: while ordering, while the kitchen is cooking, while eating, or
// after paying. The order, its dishes and its kitchen tickets go with them, and the kitchen sees the
// new table at once. The old table is free again.
//   orderPath(id)  where "View Order" leads for this role (left out: no View Order button)
export function TransferTable({ orderId, orderPath }) {
  const router = useRouter();
  const access = useAuth((s) => s.user?.access);
  const manageAll = useCan('orders.manage');
  const prices = usePrices();
  const order = useLive((s) => s.orders.find((o) => o.id === orderId));
  const tables = useLive((s) => s.tables);
  const areas = useLive((s) => s.areas);
  const manyFloors = useManyFloors();
  const [to, setTo] = useState(null);
  const [step, setStep] = useState('select'); // select | preview
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const facts = (o) => [o.guests ? plural(o.guests, 'person', 'people') : null, plural(itemCount(o), 'item')].filter(Boolean).join(' · ');

  // ---------- Success ----------
  if (result) {
    return (
      <Screen
        header={<AppHeader title="Transfer Table" />}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {orderPath ? <Button title="View Order" variant="secondary" onPress={() => router.replace(orderPath(result.order.id))} style={{ flex: 1 }} /> : null}
            <Button title="Done" onPress={() => router.back()} style={{ flex: 1 }} />
          </View>
        }
      >
        <Success title="Table Transferred Successfully!" text={`Table ${result.from} has been moved to Table ${result.to}.`}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}>
              <Txt size={18} weight={700}>
                {result.to}
              </Txt>
              <Txt size={13} color="textSecondary">
                {facts(result.order)}
              </Txt>
            </View>
            {prices.show ? (
              <Txt size={18} weight={700} tabular>
                {money(result.order.total)}
              </Txt>
            ) : null}
          </Card>
        </Success>
      </Screen>
    );
  }

  if (!order || !order.table_id || ['closed', 'cancelled', 'merged'].includes(order.status)) {
    return (
      <Screen scroll={false} header={<AppHeader title="Transfer Table" back />}>
        <EmptyState icon="swap-horizontal" title="Nothing to transfer" text="This table has no order any more." />
      </Screen>
    );
  }

  // Free tables this person may use: whole tables, the free parts of a split table, and tables
  // joined ahead of time (shown as one).
  const free = tables.filter((x) => x.active && x.status === 'free' && !x.locked_by && !x.joined_to_id && (manageAll || tableAllowed(access, x)));
  const chosen = free.find((x) => x.id === to);
  const seatsOf = (x) => x.seats + (x.joined || []).reduce((n, j) => n + j.seats, 0);

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await send('table.transfer', { orderId: order.id, toTableId: to }));
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  // ---------- Preview ----------
  if (step === 'preview' && chosen) {
    return (
      <Screen
        header={<AppHeader title="Transfer Table" back onBack={() => setStep('select')} />}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Back" variant="secondary" disabled={busy} onPress={() => setStep('select')} style={{ flex: 1 }} />
            <Button title="Next" icon="swap-horizontal" loading={busy} onPress={confirm} style={{ flex: 1.5 }} />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <Txt size={13} color="textSecondary">
            Move this table to:
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Card style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Txt size={12} color="textSecondary">
                From
              </Txt>
              <Txt size={20} weight={700}>
                {order.table_label}
              </Txt>
              <Txt size={12} color="textSecondary" center>
                {facts(order)}
              </Txt>
              {prices.show ? (
                <Txt size={14} weight={600} tabular>
                  {money(order.total)}
                </Txt>
              ) : null}
            </Card>
            <Icon name="arrow-right" size={24} color="primary" />
            <Card style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Txt size={12} color="textSecondary">
                To
              </Txt>
              <Txt size={20} weight={700} color="primary">
                {groupLabel(chosen)}
              </Txt>
              <Txt size={12} color="textSecondary" center>
                Empty table · {plural(seatsOf(chosen), 'seat')}
              </Txt>
            </Card>
          </View>
          <Notice text={`All order history, items and payment details will be moved to Table ${groupLabel(chosen)}. The kitchen is told at once.`} />
        </View>
      </Screen>
    );
  }

  // ---------- Select ----------
  return (
    <Screen
      header={<AppHeader title="Transfer Table" subtitle={`Order #${order.number} · ${order.table_label}`} back />}
      footer={<Button title="Next" disabled={!chosen} onPress={() => setStep('preview')} />}
    >
      <View style={{ gap: 12 }}>
        <Txt size={13} color="textSecondary">
          Select destination table
        </Txt>
        {free.length === 0 ? (
          <EmptyState icon="table-furniture" title="No free table" text="Every table is in use right now." />
        ) : (
          areas.map((area) => {
            const here = free.filter((x) => x.area_id === area.id);
            if (here.length === 0) return null;
            return (
              <View key={area.id} accessibilityRole="radiogroup" style={{ gap: 8 }}>
                <Txt size={13} weight={600} color="textSecondary">
                  {manyFloors && area.floor_name ? `${area.floor_name} · ` : ''}
                  {area.name}
                </Txt>
                {here.map((x) => (
                  <RadioCard key={x.id} title={groupLabel(x)} text={`Free · ${plural(seatsOf(x), 'seat')}`} selected={to === x.id} onPress={() => setTo(x.id)} />
                ))}
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}
