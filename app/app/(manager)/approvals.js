import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { useLive } from '../../src/store/live';
import { useConnection, send } from '../../src/lib/ws';
import { useNow, minutesSince } from '../../src/lib/useNow';
import { toast } from '../../src/store/toast';
import { money, orderLabel } from '../../src/lib/format';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { Section } from '../../src/components/Bits';
import { PinSheet } from '../../src/components/PinSheet';
import { ReasonSheet } from '../../src/components/ReasonSheet';

const METHODS = [
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'upi', label: 'UPI', icon: 'qrcode-scan' },
  { key: 'card', label: 'Card', icon: 'credit-card-outline' },
];

// The order an approval belongs to, named the usual way (Table 5 / Delivery – Rahul / Car – …).
const labelOf = (a) => orderLabel({ type: a.order_type, table_label: a.table_label, customer_name: a.customer_name, car_number: a.car_number });

// Approvals inbox: cancel and discount requests from the waiters, and bills sent to the counter.
// Approving needs this manager's PIN; rejecting can carry a reason. The waiter hears at once.
export default function Approvals() {
  const t = useTheme();
  const router = useRouter();
  const hasPin = useAuth((s) => s.user?.has_pin);
  const approvals = useLive((s) => s.approvals);
  const orders = useLive((s) => s.orders);
  const counter = orders.filter((o) => o.at_counter && o.status !== 'closed');
  const online = useConnection((s) => s.status) === 'online';
  const now = useNow();
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [methods, setMethods] = useState({}); // order id -> chosen payment method
  const [paying, setPaying] = useState(null);

  const what = (a) => (a.type === 'cancel' ? `Cancel ${a.item_qty}× ${a.item_name}` : `Discount ${a.payload.pct}%`);

  // Throws on a wrong PIN, so the PIN pad can show the message and ask again.
  const approve = async (pin) => {
    const a = approving;
    await send('approval.decide', { approvalId: a.id, approve: true, pin });
    setApproving(null);
    toast(`${what(a)} approved · ${a.requested_by_name} notified`, { tone: 'success', duration: 4000 });
  };

  const reject = async (reason) => {
    const a = rejecting;
    try {
      await send('approval.decide', { approvalId: a.id, approve: false, reason });
      toast(`${what(a)} rejected · ${a.requested_by_name} notified`, { icon: 'close-circle-outline' });
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    }
    setRejecting(null);
  };

  const markPaid = async (order) => {
    const method = methods[order.id] || 'cash';
    setPaying(order.id);
    try {
      await send('payment.mark', { orderId: order.id, method });
      toast(`${orderLabel(order)} paid · ${METHODS.find((m) => m.key === method).label} · ${money(order.total)}`, { tone: 'success' });
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setPaying(null);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Approvals" />}>
      <View style={{ gap: 20 }}>
        {!hasPin ? (
          <Card style={{ gap: 10, borderColor: t.c.warning }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="alert-outline" color="warningText" />
              <Txt weight={700} style={{ flex: 1 }}>
                Set your approval PIN first
              </Txt>
            </View>
            <Txt size={13} color="textSecondary">
              You approve requests with a PIN only you know.
            </Txt>
            <Button title="Open Settings" variant="secondary" onPress={() => router.push('/settings')} />
          </Card>
        ) : null}

        <Section title={`Requests (${approvals.length})`}>
          {approvals.length === 0 ? (
            <Card>
              <EmptyState icon="shield-check-outline" title="Nothing waiting" text="Cancel and discount requests from the waiters appear here straight away." />
            </Card>
          ) : (
            approvals.map((a) => {
              const amount = a.type === 'cancel' ? a.item_amount : (a.order_subtotal * a.payload.pct) / 100;
              return (
                <Card key={a.id} style={{ gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <Icon name={a.type === 'cancel' ? 'cancel' : 'percent-outline'} color={a.type === 'cancel' ? 'error' : 'primary'} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt size={17} weight={700}>
                        {what(a)}
                      </Txt>
                      <Txt size={13} color="textSecondary" tabular>
                        {labelOf(a)} · Order #{a.order_number} · asked by {a.requested_by_name} · {minutesSince(a.created_at, now)}m ago
                      </Txt>
                    </View>
                    <Txt size={16} weight={700} tabular>
                      {money(Math.round(amount * 100) / 100)}
                    </Txt>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {a.type === 'cancel' ? <Chip label={`Dish is ${a.item_status}`} icon="pot-steam-outline" tone="warning" /> : null}
                    {a.type === 'discount' ? <Chip label={`Bill ${money(a.order_subtotal)}`} icon="receipt-text-outline" /> : null}
                  </View>
                  {a.payload.reason ? (
                    <Txt size={14} italic color="textSecondary">
                      “{a.payload.reason}”
                    </Txt>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button title="Reject" variant="secondary" disabled={!online} onPress={() => setRejecting(a)} style={{ flex: 1 }} />
                    <Button title="Approve" disabled={!online || !hasPin} onPress={() => setApproving(a)} style={{ flex: 1.4 }} />
                  </View>
                </Card>
              );
            })
          )}
        </Section>

        <Section title={`Counter payments (${counter.length})`}>
          {counter.length === 0 ? (
            <Txt size={13} color="textSecondary">
              Bills that waiters send to the counter are listed here.
            </Txt>
          ) : (
            counter.map((order) => (
              <Card key={order.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icon name="cash-register" color="primary" />
                  <View style={{ flex: 1 }}>
                    <Txt size={17} weight={700}>
                      {orderLabel(order)}
                    </Txt>
                    <Txt size={13} color="textSecondary" tabular>
                      Order #{order.number} · {order.waiter_name}
                      {order.discount_pct > 0 ? ` · ${order.discount_pct}% discount` : ''}
                    </Txt>
                  </View>
                  <Txt size={20} weight={700} tabular>
                    {money(order.total)}
                  </Txt>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  {METHODS.map((m) => (
                    <Chip key={m.key} label={m.label} icon={m.icon} selected={(methods[order.id] || 'cash') === m.key} onPress={() => setMethods((s) => ({ ...s, [order.id]: m.key }))} />
                  ))}
                  <View style={{ flex: 1 }} />
                  <Button title="Mark paid" loading={paying === order.id} disabled={!online} onPress={() => markPaid(order)} style={{ minWidth: 130 }} />
                </View>
              </Card>
            ))
          )}
        </Section>
      </View>

      <PinSheet
        visible={!!approving}
        title={approving ? what(approving) : ''}
        text={approving ? `${labelOf(approving)} · asked by ${approving.requested_by_name}. Enter your PIN to approve.` : ''}
        onSubmit={approve}
        onClose={() => setApproving(null)}
      />
      <ReasonSheet
        visible={!!rejecting}
        title={rejecting ? `Reject: ${what(rejecting)}?` : ''}
        text="A reason is optional. The waiter sees it."
        reasons={['Already cooked', 'Not allowed', 'Ask me at the counter']}
        submitLabel="Reject"
        optional
        onSubmit={reject}
        onClose={() => setRejecting(null)}
      />
    </Screen>
  );
}
