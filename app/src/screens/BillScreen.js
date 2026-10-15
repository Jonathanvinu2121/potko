import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { useAuth, useCan } from '../store/auth';
import { useLive } from '../store/live';
import { send } from '../lib/ws';
import { toast } from '../store/toast';
import { useNow, minutesSince } from '../lib/useNow';
import { money, orderLabel, clock, duration, plural, tableName } from '../lib/format';
import { printReceipt, shareReceipt } from '../lib/receipt';
import { isOpen, allSettled, amountDue, goodPayments, methodLabel, pendingDiscount, liveItems, METHODS, TYPE_LABEL } from '../lib/orders';
import { Screen } from '../components/Screen';
import { AppHeader } from '../components/AppHeader';
import { Txt } from '../components/Txt';
import { Icon } from '../components/Icon';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { BottomSheet } from '../components/BottomSheet';
import { EmptyState } from '../components/EmptyState';
import { Toggle } from '../components/Bits';
import { Line, Tabs } from '../components/Lists';
import { Success, Notice } from '../components/Feedback';
import { OrderLines } from '../components/OrderLines';
import { BillSummary } from '../components/BillSummary';

const num = (text) => Number(String(text).replace(/[^0-9.]/g, '')) || 0;
const round2 = (n) => Math.round(n * 100) / 100;

// Round amounts a guest is likely to hand over: the exact bill, then the next 50, 100 and 500.
function quickCash(due) {
  const up = (step) => Math.ceil(due / step) * step;
  return [...new Set([due, up(50), up(100), up(500)])].filter((v) => v >= due).slice(0, 4);
}

// The discount sheet: a percentage or a fixed amount, with a reason. Within the person's own
// limit it applies at once; above it, it goes to a manager and the bill waits for the answer.
function DiscountSheet({ visible, order, onClose }) {
  const settings = useAuth((s) => s.restaurant?.settings);
  const limit = useAuth((s) => s.user?.discount_limit ?? 0);
  const [type, setType] = useState('pct');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setType(order.discount_type === 'amount' && order.discount_value > 0 ? 'amount' : 'pct');
    setValue(order.discount_value > 0 ? String(order.discount_value) : '');
    setReason(null);
    setNote('');
    setBusy(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = num(value);
  const amount = type === 'pct' ? round2((order.subtotal * v) / 100) : v;
  const pct = type === 'pct' ? v : order.subtotal > 0 ? round2((v / order.subtotal) * 100) : 0;
  const tooMuch = type === 'pct' ? v > 100 : v > order.subtotal;
  const needsApproval = pct > limit;
  const why = [reason, note.trim()].filter(Boolean).join(' — ');
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

  const apply = async () => {
    setBusy(true);
    try {
      if (needsApproval) {
        await send('approval.request', { type: 'discount', orderId: order.id, payload: { type, value: v, reason: why } });
        toast('Sent to the manager for approval', { icon: 'shield-account-outline', duration: 4000 });
      } else {
        await send('discount.apply', { orderId: order.id, type, value: v, reason: why });
        toast(v > 0 ? `Discount of ${money(amount)} applied` : 'Discount removed', { tone: 'success' });
      }
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await send('discount.apply', { orderId: order.id, type: 'pct', value: 0 });
      toast('Discount removed', { tone: 'success' });
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title="Apply Discount"
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title={needsApproval ? 'Ask Manager' : 'Apply Discount'} disabled={!(v > 0) || tooMuch || !why} loading={busy} onPress={apply} style={{ flex: 1.5 }} />
        </View>
      }
    >
      <Tabs options={[{ value: 'pct', label: 'Percentage' }, { value: 'amount', label: 'Fixed Amount' }]} value={type} onChange={(next) => { setType(next); setValue(''); }} />
      {type === 'pct' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(settings?.discount_presets ?? [5, 10, 15, 20]).map((p) => (
            <Chip key={p} label={`${p}%`} selected={v === p} onPress={() => setValue(String(p))} />
          ))}
        </View>
      ) : null}
      <TextField label={type === 'pct' ? 'Discount (%)' : 'Discount amount (₹)'} value={value} onChangeText={(text) => setValue(text.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={8} placeholder={type === 'pct' ? 'e.g. 10' : 'e.g. 100'} error={tooMuch} />
      {tooMuch ? (
        <Txt size={13} weight={600} color="error">
          The discount cannot be more than the bill ({money(order.subtotal)}).
        </Txt>
      ) : v > 0 ? (
        <Card style={{ gap: 6 }}>
          <Line label={type === 'pct' ? `Discount (${v}%)` : `Discount (${pct}% of the bill)`} value={`− ${money(amount)}`} tone="error" />
          <Txt size={12} color="textSecondary">
            Taken off {money(order.subtotal)} before tax. The new total shows as soon as it is applied.
          </Txt>
        </Card>
      ) : null}
      <View style={{ gap: 8 }}>
        <Txt size={13} weight={600}>
          Reason *
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(settings?.discount_reasons ?? ['Regular customer', 'Other']).map((r) => (
            <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(reason === r ? null : r)} />
          ))}
        </View>
        <TextField value={note} onChangeText={setNote} placeholder="Add a note (optional)" autoCapitalize="sentences" maxLength={120} />
      </View>
      {needsApproval ? (
        <Notice tone="warning" icon="shield-account-outline" text={`You can give up to ${limit}% yourself. This goes to a manager, and the bill waits for the answer.`} />
      ) : null}
      {order.discount_amount > 0 ? <Button title="Remove the current discount" variant="link" disabled={busy} onPress={remove} /> : null}
    </BottomSheet>
  );
}

// One bill from review to money: the dishes and totals, a discount if needed, the payment
// (in one go or in parts), and what follows a successful payment.
//   paths  where "Edit Order" leads for this role
export function BillScreen({ orderId, paths }) {
  const t = useTheme();
  const router = useRouter();
  const restaurant = useAuth((s) => s.restaurant);
  const role = useAuth((s) => s.user?.role);
  const collects = useCan('payments.collect');
  const order = useLive((s) => s.orders.find((o) => o.id === orderId));
  const now = useNow();
  const [step, setStep] = useState('review'); // review -> pay -> done
  const [discounting, setDiscounting] = useState(false);
  const [method, setMethod] = useState(null);
  const [split, setSplit] = useState(false);
  const [part, setPart] = useState('');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null); // the payment that settled the bill

  const methods = restaurant?.settings?.payment_methods ?? ['cash', 'upi', 'card'];
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

  if (!order) {
    return (
      <Screen scroll={false} header={<AppHeader title="Bill" back />}>
        <EmptyState icon="receipt-text-outline" title="This bill is no longer open" text="It was settled or closed from another screen." />
      </Screen>
    );
  }

  const name = orderLabel(order);
  const due = amountDue(order);
  const paid = goodPayments(order);
  const waitingDiscount = pendingDiscount(order);
  const blocked = !allSettled(order)
    ? 'Serve or remove every dish before taking payment.'
    : order.pending_approvals.length > 0
      ? 'A request on this order is waiting for a manager.'
      : null;
  const chosen = method ?? methods[0];
  const amount = split ? Math.min(num(part), due) : due;
  const cash = chosen === 'cash' && received !== '' ? num(received) : null;
  const change = cash !== null ? round2(cash - amount) : null;
  const payProblem = split && !(amount > 0) ? 'Enter the amount paid by this method.' : cash !== null && cash < amount ? `${money(cash)} is less than ${money(amount)}.` : null;

  const act = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const pay = (status) =>
    act(status === 'failed' ? 'failed' : 'pay', async () => {
      const after = await send('payment.add', {
        orderId: order.id,
        method: chosen,
        amount: split ? amount : undefined,
        received: cash ?? undefined,
        reference: reference.trim() || undefined,
        status,
      });
      setConfirming(false);
      if (status === 'failed') return toast('Recorded as failed. The bill is still open.', { icon: 'close-circle-outline', tone: 'error', duration: 4000 });
      setReceived('');
      setReference('');
      setPart('');
      if (isOpen(after)) {
        toast(`${money(amount)} by ${methodLabel(chosen)} recorded · ${money(amountDue(after))} left`, { tone: 'success', duration: 4000 });
        return;
      }
      setLast({ amount, method: chosen, change: change > 0 ? change : 0, total: after.total, split: after.payment_method === 'split' });
      setStep('done');
    });

  // ---------- After a successful payment ----------
  if (step === 'done' || (!isOpen(order) && order.paid_at)) {
    const seated = order.status === 'paid';
    return (
      <Screen
        header={<AppHeader title={name} subtitle={`Order #${order.number}`} back onBack={() => router.back()} />}
        footer={
          seated ? (
            <View style={{ gap: 8 }}>
              <Button title="Close Table" icon="check-circle-outline" loading={busy === 'close'} onPress={() => act('close', async () => { await send('order.close', { orderId: order.id }); toast(`${name} closed and free again`, { tone: 'success' }); router.back(); })} />
              <Button title="Guests are still seated" variant="link" onPress={() => router.back()} />
            </View>
          ) : (
            <Button title="Done" onPress={() => router.back()} />
          )
        }
      >
        <Success title="Payment successful" text={`${money(order.paid_total)} received from ${name}${last?.split || order.payment_method === 'split' ? ' in parts' : ` by ${methodLabel(order.payment_method)}`}`}>
          {last?.change > 0 ? <Notice tone="primary" icon="cash" title={`Give ${money(last.change)} change`} /> : null}
          <Card style={{ gap: 6 }}>
            <Line label={`Bill #${order.number}`} value={money(order.total)} strong />
            {paid.map((p) => (
              <Line key={p.id} label={`${methodLabel(p.method)}${p.reference ? ` · ${p.reference}` : ''} · ${clock(p.created_at)}`} value={`${p.kind === 'refund' ? '− ' : ''}${money(p.amount)}`} muted />
            ))}
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Print Bill" icon="printer-outline" variant="secondary" loading={busy === 'print'} onPress={() => act('print', () => printReceipt(order, restaurant))} style={{ flex: 1 }} />
            <Button title="Share Receipt" icon="share-variant-outline" variant="secondary" loading={busy === 'share'} onPress={() => act('share', async () => { if ((await shareReceipt(order, restaurant)) === 'copied') toast('Bill copied. Paste it into a message.'); })} style={{ flex: 1 }} />
          </View>
          {seated ? <Txt size={13} color="textSecondary" center>{tableName(order.table_label)} stays marked Paid until it is closed.</Txt> : null}
        </Success>
      </Screen>
    );
  }

  // ---------- Payment method and confirmation ----------
  if (step === 'pay') {
    return (
      <Screen
        header={<AppHeader title={name} subtitle={`Order #${order.number} · ${TYPE_LABEL[order.type]}`} back onBack={() => setStep('review')} />}
        footer={
          <View style={{ gap: 8 }}>
            {payProblem ? (
              <Txt size={13} weight={600} color="error" center accessibilityRole="alert">
                {payProblem}
              </Txt>
            ) : null}
            <Button title={`Confirm Payment · ${money(amount)}`} icon="arrow-right" disabled={!!payProblem || !!blocked} onPress={() => setConfirming(true)} />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <Card style={{ gap: 6 }}>
            <Line label={order.paid_total > 0 ? 'Still to pay' : 'Bill Amount'} value={money(due)} strong />
            {paid.map((p) => (
              <Line key={p.id} label={`Paid · ${methodLabel(p.method)} · ${clock(p.created_at)}`} value={money(p.amount)} tone="successText" muted />
            ))}
          </Card>
          {blocked ? <Notice tone="warning" icon="lock-outline" text={blocked} /> : null}

          <Txt size={15} weight={700}>
            Select Payment Method
          </Txt>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {methods.map((m) => {
              const selected = chosen === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => { setMethod(m); setReceived(''); }}
                  accessibilityRole="radio"
                  accessibilityLabel={METHODS[m]?.label ?? m}
                  aria-checked={selected}
                  style={({ pressed }) => ({
                    flexGrow: 1,
                    flexBasis: 72,
                    minHeight: 72,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    borderRadius: t.radius.control,
                    borderWidth: selected ? 2 : t.borderWidth,
                    borderColor: selected ? t.c.primary : t.c.border,
                    backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                  })}
                >
                  <Icon name={METHODS[m]?.icon ?? 'cash'} size={24} color={selected ? 'primary' : 'textSecondary'} />
                  <Txt size={13} weight={600} color={selected ? 'primary' : 'text'}>
                    {METHODS[m]?.label ?? m}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Txt size={15} weight={600}>
                  Split payment
                </Txt>
                <Txt size={13} color="textSecondary">
                  Pay part now by this method and the rest by another
                </Txt>
              </View>
              <Toggle label={split ? 'On' : 'Off'} value={split} onChange={(on) => { setSplit(on); setPart(''); }} />
            </View>
            {split ? <TextField label={`Amount by ${METHODS[chosen]?.label ?? chosen} (up to ${money(due)})`} value={part} onChangeText={(text) => setPart(text.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={9} placeholder="0" /> : null}
          </Card>

          {chosen === 'cash' ? (
            <Card style={{ gap: 12 }}>
              <Txt size={15} weight={600}>
                Cash received
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {quickCash(amount || due).map((v) => (
                  <Chip key={v} label={money(v)} selected={cash === v} onPress={() => setReceived(String(v))} />
                ))}
              </View>
              <TextField value={received} onChangeText={(text) => setReceived(text.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" maxLength={9} placeholder="Other amount (optional)" />
              {change !== null && change >= 0 ? <Line label="Change to give back" value={money(change)} strong tone={change > 0 ? 'primary' : 'text'} /> : null}
            </Card>
          ) : (
            <Card style={{ gap: 12 }}>
              {chosen === 'upi' && restaurant?.settings?.devices?.upi_id ? (
                <Notice tone="primary" icon="qrcode-scan" title="Collect on UPI ID" text={restaurant.settings.devices.upi_id} />
              ) : null}
              <TextField label="Reference (optional)" value={reference} onChangeText={setReference} placeholder={chosen === 'card' ? 'Slip or approval number' : 'Transaction ID'} autoCapitalize="characters" maxLength={40} />
            </Card>
          )}
        </View>

        <BottomSheet
          visible={confirming}
          onClose={busy ? () => {} : () => setConfirming(false)}
          title={`${money(amount)} by ${METHODS[chosen]?.label ?? chosen}`}
          footer={
            chosen === 'cash' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Cancel" variant="secondary" disabled={!!busy} onPress={() => setConfirming(false)} style={{ flex: 1 }} />
                <Button title="Cash Received" loading={busy === 'pay'} onPress={() => pay('successful')} style={{ flex: 1.5 }} />
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Button title="Payment Received" icon="check" loading={busy === 'pay'} disabled={busy === 'failed'} onPress={() => pay('successful')} />
                <Button title="Payment Failed" icon="close" variant="secondary" loading={busy === 'failed'} disabled={busy === 'pay'} onPress={() => pay('failed')} />
              </View>
            )
          }
        >
          <Txt color="textSecondary">
            {chosen === 'cash'
              ? `Confirm that ${money(cash ?? amount)} was handed over${change > 0 ? ` and give ${money(change)} back` : ''}.`
              : `Confirm only when the ${METHODS[chosen]?.label ?? chosen} payment has gone through. A failed or cancelled try is recorded and the bill stays open.`}
          </Txt>
          {amount < due ? <Line label="Left to pay after this" value={money(round2(due - amount))} /> : null}
        </BottomSheet>
      </Screen>
    );
  }

  // ---------- Bill review ----------
  return (
    <Screen
      header={<AppHeader title={name} subtitle={[TYPE_LABEL[order.type], order.area_name].filter(Boolean).join(' · ')} back />}
      footer={
        collects ? (
          <Button title={order.paid_total > 0 ? `Take the remaining ${money(due)}` : 'Proceed to Payment'} icon="arrow-right" disabled={!!blocked} onPress={() => setStep('pay')} />
        ) : order.bill_requested_at ? (
          <Button title="Sent to the manager" icon="check" disabled onPress={() => {}} />
        ) : (
          <Button title="Send Bill to Manager" icon="send-outline" disabled={!!blocked} loading={busy === 'bill'} onPress={() => act('bill', async () => { await send('bill.request', { orderId: order.id }); toast('The bill is with the manager for payment', { tone: 'success', duration: 4000 }); })} />
        )
      }
    >
      <View style={{ gap: 14 }}>
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="receipt-text-outline" color="textSecondary" />
            <View style={{ flex: 1 }}>
              <Txt size={16} weight={700}>
                Order #{order.number}
              </Txt>
              <Txt size={13} color="textSecondary" tabular>
                {clock(order.created_at)} · {duration(minutesSince(order.created_at, now))} · {order.waiter_name}
              </Txt>
            </View>
            <Button title="Edit Order" icon="pencil-outline" variant="link" onPress={() => router.push(paths.order(order.id))} />
          </View>
          <OrderLines order={{ ...order, items: liveItems(order) }} />
        </Card>

        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Txt size={16} weight={700}>
              Bill Summary
            </Txt>
            <Button title={order.discount_amount > 0 ? 'Edit Discount' : 'Apply Discount'} icon="tag-outline" variant="link" disabled={!!waitingDiscount || order.paid_total > 0} onPress={() => setDiscounting(true)} />
          </View>
          <BillSummary bill={order} />
          {order.discount_reason && order.discount_amount > 0 ? (
            <Txt size={13} color="textSecondary">
              Discount reason: {order.discount_reason}
            </Txt>
          ) : null}
          {paid.length > 0 ? (
            <View style={{ gap: 6, paddingTop: 10, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
              {paid.map((p) => (
                <Line key={p.id} label={`Paid · ${methodLabel(p.method)} · ${clock(p.created_at)}`} value={money(p.amount)} tone="successText" muted />
              ))}
              <Line label="Still to pay" value={money(due)} strong />
            </View>
          ) : null}
        </Card>

        {waitingDiscount ? (
          <Notice
            tone="warning"
            icon="shield-account-outline"
            title="Discount waiting for approval"
            text={`${waitingDiscount.payload.type === 'amount' ? money(waitingDiscount.payload.value) : `${waitingDiscount.payload.value ?? waitingDiscount.payload.pct}%`} was asked for. It is not on the bill until a manager approves it.`}
          />
        ) : null}
        {blocked && !waitingDiscount ? <Notice tone="warning" icon="lock-outline" text={blocked} /> : null}
        {!collects && role === 'waiter' ? <Notice text="You do not take payments. Send the bill to the manager, who settles it." /> : null}
      </View>

      <DiscountSheet visible={discounting} order={order} onClose={() => setDiscounting(false)} />
    </Screen>
  );
}
