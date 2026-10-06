import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { useDraft } from '../../../../src/store/draft';
import { useConnection, send } from '../../../../src/lib/ws';
import { toast } from '../../../../src/store/toast';
import { money, orderLabel } from '../../../../src/lib/format';
import { allSettled, isOpen, itemsWith, pendingDiscount } from '../../../../src/lib/orders';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { EmptyState } from '../../../../src/components/EmptyState';
import { ReasonSheet } from '../../../../src/components/ReasonSheet';

const METHODS = [
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'upi', label: 'UPI', icon: 'qrcode-scan' },
  { key: 'card', label: 'Card', icon: 'credit-card-outline' },
];
const DISCOUNT_REASONS = ['Regular customer', 'Complaint about food', 'Long wait', 'Manager offer'];

// W8 Bill and payment.
//   A discount within the waiter's own limit applies at once.
//   A bigger one is sent to the manager, who approves it with their PIN.
export default function Bill() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const order = useLive((s) => s.orders.find((o) => o.id === id));
  const user = useAuth((s) => s.user);
  const restaurant = useAuth((s) => s.restaurant);
  const online = useConnection((s) => s.status) === 'online';
  const [pctText, setPctText] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(null); // 'discount' | 'pay' | 'counter'
  const [asking, setAsking] = useState(false); // the "request manager approval" sheet

  if (!order || !isOpen(order)) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']} header={<AppHeader title="Bill" back />}>
        <EmptyState icon="cash-check" title="This bill is settled" text="The order has been paid or cancelled." />
      </Screen>
    );
  }

  const limit = user.discount_limit_pct;
  const pct = Number(pctText);
  const pctValid = pctText.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const waitingDiscount = pendingDiscount(order);
  const blocked = order.pending_approvals.length > 0; // nothing can be paid while a manager decision is open
  const settled = allSettled(order);
  const charged = itemsWith(order, 'delivered');
  const counterAllowed = restaurant?.settings?.payment_at === 'counter';
  const canPay = settled && !blocked && online;

  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });

  const applyDiscount = async () => {
    if (pct > limit) return setAsking(true);
    setBusy('discount');
    try {
      await send('discount.apply', { orderId: order.id, pct });
      setPctText('');
      toast(pct === 0 ? 'Discount removed' : `${pct}% discount applied`, { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const requestDiscount = async (reason) => {
    try {
      await send('approval.request', { type: 'discount', orderId: order.id, payload: { pct, reason } });
      setPctText('');
      toast('Discount request sent to manager', { icon: 'shield-account-outline' });
    } catch (err) {
      fail(err);
    }
    setAsking(false);
  };

  const pay = async (how) => {
    setBusy(how === 'counter' ? 'counter' : 'pay');
    try {
      await send('payment.mark', { orderId: order.id, method: how });
      if (how === 'counter') {
        toast(`${orderLabel(order)} sent to manager counter`, { icon: 'send-outline' });
      } else {
        toast(`${orderLabel(order)} closed · paid by ${METHODS.find((m) => m.key === how).label}`, { tone: 'success' });
      }
      // Back to the New Order page, ready for the next customer.
      router.dismissAll();
      router.navigate('/new-order');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const addMore = () => {
    useDraft.getState().startAdd(order);
    router.push('/new-order/menu');
  };

  const row = (label, value, strong) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <Txt size={strong ? 17 : 15} weight={strong ? 700 : 400} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Txt>
      <Txt size={strong ? 22 : 15} weight={strong ? 700 : 600} tabular>
        {value}
      </Txt>
    </View>
  );

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={`Bill · ${orderLabel(order)}`} back />}
      footer={
        order.at_counter ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.warningTint }}>
            <Icon name="cash-register" color="warningText" />
            <Txt weight={700} color="warningText" style={{ flex: 1 }}>
              Sent to manager counter · waiting for payment
            </Txt>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {!settled ? (
              <Txt size={12} color="error" center>
                Deliver or remove every item before taking payment.
              </Txt>
            ) : blocked ? (
              <Txt size={12} color="warningText" center>
                Waiting for the manager’s decision before payment.
              </Txt>
            ) : null}
            <Button title={`Mark Paid · ${METHODS.find((m) => m.key === method).label} · ${money(order.total)}`} loading={busy === 'pay'} disabled={!canPay || !!busy} onPress={() => pay(method)} />
          </View>
        )
      }
    >
      <View style={{ gap: 16 }}>
        <Card style={{ gap: 10 }}>
          {charged.length === 0 ? (
            <Txt color="textSecondary">Nothing was delivered on this order.</Txt>
          ) : (
            charged.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: 10 }}>
                <Txt weight={600} color="textSecondary" tabular style={{ minWidth: 30 }}>
                  {item.qty}×
                </Txt>
                <Txt style={{ flex: 1 }}>
                  {item.name_snapshot}
                  {item.size ? ` (${item.size})` : ''}
                </Txt>
                <Txt weight={600} tabular>
                  {money(item.qty * item.unit_price)}
                </Txt>
              </View>
            ))
          )}
          <View style={{ height: t.borderWidth, backgroundColor: t.c.border }} />
          {row('Subtotal', money(order.subtotal))}
          {order.discount_pct > 0 ? row(`Discount ${order.discount_pct}%`, `− ${money(order.discount_amount)}`) : null}
          {row('Total', money(order.total), true)}
        </Card>

        {order.at_counter ? null : (
          <>
            <Card style={{ gap: 10 }}>
              <Txt size={15} weight={700}>
                Apply discount
              </Txt>
              <Txt size={13} color="textSecondary">
                You can give up to {limit}%. More than that needs the manager.
              </Txt>
              {waitingDiscount ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.warningTint }}>
                  <Icon name="shield-account-outline" color="warningText" />
                  <Txt weight={600} color="warningText" style={{ flex: 1 }}>
                    Waiting for manager · {waitingDiscount.payload.pct}% requested
                  </Txt>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <TextField
                    label="Discount %"
                    value={pctText}
                    onChangeText={(v) => setPctText(v.replace(/[^0-9.]/g, ''))}
                    placeholder={order.discount_pct > 0 ? String(order.discount_pct) : '0'}
                    keyboardType="decimal-pad"
                    maxLength={5}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title={pctValid && pct > limit ? 'Ask manager' : 'Apply'}
                    variant="secondary"
                    loading={busy === 'discount'}
                    disabled={!pctValid || !online || !!busy}
                    onPress={applyDiscount}
                    style={{ minWidth: 120 }}
                  />
                </View>
              )}
            </Card>

            <View style={{ gap: 8 }}>
              <Txt size={15} weight={700}>
                Payment method
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {METHODS.map((m) => (
                  <Chip key={m.key} label={m.label} icon={m.icon} selected={method === m.key} onPress={() => setMethod(m.key)} />
                ))}
              </View>
              {counterAllowed ? (
                <Button title="Send to manager counter" icon="send-outline" variant="secondary" loading={busy === 'counter'} disabled={!canPay || !!busy} onPress={() => pay('counter')} />
              ) : null}
            </View>

            <Button title="+ Add more items" variant="link" disabled={!!busy} onPress={addMore} />
          </>
        )}
      </View>

      <ReasonSheet
        visible={asking}
        title="Request manager approval"
        text={`${pctValid ? pct : ''}% is above your ${limit}% limit. The manager approves it with their PIN.`}
        reasons={DISCOUNT_REASONS}
        onSubmit={requestDiscount}
        onClose={() => setAsking(false)}
      />
    </Screen>
  );
}
