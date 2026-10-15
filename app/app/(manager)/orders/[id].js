import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useAuth, useCan } from '../../../src/store/auth';
import { useLive } from '../../../src/store/live';
import { api } from '../../../src/lib/api';
import { send } from '../../../src/lib/ws';
import { toast } from '../../../src/store/toast';
import { describe, when } from '../../../src/lib/audit';
import { money, orderLabel, clock, duration, plural } from '../../../src/lib/format';
import { useNow, minutesSince } from '../../../src/lib/useNow';
import { MANAGER_PATHS } from '../../../src/lib/paths';
import { printReceipt, shareReceipt } from '../../../src/lib/receipt';
import { isOpen, onFloor, orderStage, allSettled, amountDue, goodPayments, refundedTotal, methodLabel, readyItems, METHODS, TYPE_LABEL, TYPE_ICON } from '../../../src/lib/orders';
import { OrderTags } from '../../../src/components/OrderTags';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { TextField } from '../../../src/components/TextField';
import { BottomSheet } from '../../../src/components/BottomSheet';
import { Section } from '../../../src/components/Bits';
import { Line } from '../../../src/components/Lists';
import { ListState, Notice } from '../../../src/components/Feedback';
import { OrderLines } from '../../../src/components/OrderLines';
import { BillSummary } from '../../../src/components/BillSummary';
import { TableSheet } from '../../../src/components/TableSheet';
import { PinSheet } from '../../../src/components/PinSheet';

// One order: who, where and how long; every dish with its kitchen state; the bill; and the
// actions its state allows. Below, the tickets sent to the kitchen and everything that ever
// happened to the order, each with the person and the time.
export default function OrderDetail() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const restaurant = useAuth((s) => s.restaurant);
  const manages = useCan('orders.manage');
  const collects = useCan('payments.collect');
  const refunds = useCan('refunds.issue');
  // While the order is in progress the live copy keeps this screen current; its history is re-read on each change.
  const live = useLive((s) => s.orders.find((o) => o.id === id));
  const table = useLive((s) => (live?.table_id ? s.tables.find((x) => x.id === live.table_id) : null));
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [refund, setRefund] = useState(null); // { amount, method, reason } while the refund sheet is open
  const [askPin, setAskPin] = useState(false);

  const stamp = live ? `${live.status}|${live.total}|${live.paid_total}|${live.items.map((i) => i.status + i.qty).join()}|${live.pending_approvals.length}|${live.payments.length}|${live.table_id}` : '';
  const load = () => {
    setError(null);
    api(`/orders/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };
  useEffect(load, [id, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = live ?? data?.order;
  if (!order) {
    return (
      <Screen header={<AppHeader title="Order" back />}>
        <ListState loading={!error} error={error} onRetry={load} rowHeight={120} />
      </Screen>
    );
  }

  const stage = orderStage(order);
  const open = isOpen(order);
  const settled = allSettled(order);
  const due = amountDue(order);
  const ready = readyItems(order);
  const paid = goodPayments(order);
  const refundable = Math.max(0, Math.round((paid.filter((p) => p.kind === 'payment').reduce((s, p) => s + p.amount, 0) - refundedTotal(order)) * 100) / 100);
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

  const act = async (key, fn, done) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done, { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const doRefund = async (pin) => {
    await send('payment.refund', { orderId: order.id, amount: Number(refund.amount), method: refund.method, reason: refund.reason, pin });
    setAskPin(false);
    setRefund(null);
    toast(`${money(Number(refund.amount))} refunded`, { tone: 'success', duration: 4000 });
  };

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={orderLabel(order)} subtitle={[`Order #${order.number}`, order.area_name].filter(Boolean).join(' · ')} back />}
    >
      <View style={{ gap: 16 }}>
        <OrderTags order={order} size={13} max={8} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label={TYPE_LABEL[order.type]} icon={TYPE_ICON[order.type]} />
          <Chip label={order.waiter_name} icon="account-outline" />
          <Chip label={onFloor(order) && !order.paid_at ? `${clock(order.created_at)} · ${duration(minutesSince(order.created_at, now))}` : when(order.created_at)} icon="clock-outline" />
        </View>
        {order.customer_phone || order.delivery_address ? (
          <Txt size={13} color="textSecondary">
            {[order.customer_phone, order.delivery_address].filter(Boolean).join(' · ')}
          </Txt>
        ) : null}
        {order.pending_approvals.length > 0 ? <Notice tone="warning" icon="shield-account-outline" text={`${plural(order.pending_approvals.length, 'request')} waiting for approval. The bill cannot be settled until ${order.pending_approvals.length === 1 ? 'it is' : 'they are'} decided.`} /> : null}

        <Card style={{ gap: 12 }}>
          <OrderLines order={order} showStatus={!order.paid_at} />
          {open && manages ? <Button title="Add Items" icon="plus-circle-outline" variant="secondary" onPress={() => router.push(`/orders/add/${order.id}`)} /> : null}
        </Card>

        <Card style={{ gap: 12 }}>
          <Txt size={15} weight={700}>
            Bill Summary
          </Txt>
          <BillSummary bill={order} />
          {order.discount_reason ? (
            <Txt size={13} color="textSecondary">
              Discount reason: {order.discount_reason}
            </Txt>
          ) : null}
          {paid.length > 0 ? (
            <View style={{ gap: 6, paddingTop: 10, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
              {paid.map((p) => (
                <Line key={p.id} label={`${p.kind === 'refund' ? 'Refund' : 'Paid'} · ${methodLabel(p.method)}${p.reference ? ` · ${p.reference}` : ''} · ${clock(p.created_at)}${p.by_name ? ` · ${p.by_name}` : ''}`} value={`${p.kind === 'refund' ? '− ' : ''}${money(p.amount)}`} tone={p.kind === 'refund' ? 'error' : 'successText'} muted />
              ))}
              {open && due > 0 && order.paid_total > 0 ? <Line label="Still to pay" value={money(due)} strong /> : null}
            </View>
          ) : null}
        </Card>

        {/* What can be done now. Only what this order's state allows is offered. */}
        <View style={{ gap: 8 }}>
          {open && ready.length > 0 && manages ? (
            <Button title={`Mark ${plural(ready.length, 'dish', 'dishes')} served`} icon="check-all" variant="secondary" loading={busy === 'serve'} onPress={() => act('serve', () => send('waiter.deliver', { itemIds: ready.map((i) => i.id) }), 'Marked served')} />
          ) : null}
          {open && settled && !order.bill_requested_at && manages && order.pending_approvals.length === 0 ? (
            <Button title="Request Bill" icon="receipt-text-outline" variant="secondary" loading={busy === 'bill'} onPress={() => act('bill', () => send('bill.request', { orderId: order.id }), 'Added to the payment queue')} />
          ) : null}
          {open && settled && collects ? <Button title={order.paid_total > 0 ? `Take the remaining ${money(due)}` : 'Proceed to Payment'} icon="cash-register" onPress={() => router.push(MANAGER_PATHS.bill(order.id))} /> : null}
          {open && !settled ? <Notice text="The bill can be asked for once every dish is served, removed or cancelled." /> : null}
          {order.status === 'paid' && (manages || collects) ? (
            <Button title="Close Table" icon="check-circle-outline" loading={busy === 'close'} onPress={() => act('close', () => send('order.close', { orderId: order.id }), `${orderLabel(order)} closed`)} />
          ) : null}
          {table && onFloor(order) && manages ? <Button title="Split, Merge or Transfer" icon="table-furniture" variant="secondary" onPress={() => setSheet(true)} /> : null}
          {order.paid_at ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Print Bill" icon="printer-outline" variant="secondary" loading={busy === 'print'} onPress={() => act('print', () => printReceipt(order, restaurant))} style={{ flex: 1 }} />
              <Button title="Share" icon="share-variant-outline" variant="secondary" loading={busy === 'share'} onPress={() => act('share', async () => { if ((await shareReceipt(order, restaurant)) === 'copied') toast('Bill copied. Paste it into a message.'); })} style={{ flex: 1 }} />
            </View>
          ) : null}
          {order.paid_at && refunds && refundable > 0 ? <Button title="Refund" icon="cash-refund" variant="link" onPress={() => setRefund({ amount: String(refundable), method: paid[0]?.method ?? 'cash', reason: '' })} /> : null}
        </View>

        {data?.kots?.length ? (
          <Section title={`Kitchen tickets (${data.kots.length})`}>
            <Card style={{ gap: 8 }}>
              {data.kots.map((kot) => (
                <Line key={kot.id} label={`KOT #${kot.number} · ${kot.terminal_name}`} value={`${clock(kot.sent_at)}${kot.sent_by_name ? ` · ${kot.sent_by_name}` : ''}`} muted />
              ))}
            </Card>
          </Section>
        ) : null}

        <Section title={`History${data ? ` (${data.audit.length})` : ''}`}>
          {!data ? (
            <ListState loading={!error} error={error} onRetry={load} rows={2} rowHeight={44} />
          ) : data.audit.length === 0 ? (
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
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </Txt>
                </View>
              ))}
            </Card>
          )}
        </Section>
      </View>

      {sheet && table ? <TableSheet table={table} onClose={() => setSheet(false)} paths={{ ...MANAGER_PATHS, order: () => `/orders/${order.id}` }} /> : null}

      <BottomSheet
        visible={!!refund && !askPin}
        onClose={() => setRefund(null)}
        title="Refund"
        footer={<Button title="Continue" disabled={!refund || !(Number(refund.amount) > 0) || Number(refund.amount) > refundable || !refund.reason.trim()} onPress={() => setAskPin(true)} />}
      >
        <Txt size={13} color="textSecondary">
          Up to {money(refundable)} can be given back on this bill. The bill and its payments stay on record; the refund is added to them.
        </Txt>
        <TextField label="Amount" required value={refund?.amount ?? ''} onChangeText={(v) => setRefund((r) => ({ ...r, amount: v.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" maxLength={9} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(restaurant?.settings?.payment_methods ?? ['cash', 'upi', 'card']).map((m) => (
            <Chip key={m} label={METHODS[m]?.label ?? m} icon={METHODS[m]?.icon} selected={refund?.method === m} onPress={() => setRefund((r) => ({ ...r, method: m }))} />
          ))}
        </View>
        <TextField label="Reason" required value={refund?.reason ?? ''} onChangeText={(reason) => setRefund((r) => ({ ...r, reason }))} placeholder="Why is the money going back?" autoCapitalize="sentences" maxLength={200} />
      </BottomSheet>
      <PinSheet
        visible={askPin}
        text={refund ? `Enter your PIN to refund ${money(Number(refund.amount))}` : ''}
        confirmLabel="Verify & Refund"
        onSubmit={doRefund}
        onClose={() => setAskPin(false)}
        onForgot={() => { setAskPin(false); setRefund(null); router.push('/more/settings/pin'); }}
      />
    </Screen>
  );
}
