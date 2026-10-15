import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { api } from '../../../../src/lib/api';
import { send } from '../../../../src/lib/ws';
import { toast } from '../../../../src/store/toast';
import { approvalShort } from '../../../../src/lib/approvals';
import { money, orderLabel, clock, ago, plural, tableName } from '../../../../src/lib/format';
import { APPROVAL_TYPES, ITEM_STATUS, TYPE_LABEL, liveItems, methodLabel } from '../../../../src/lib/orders';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { BottomSheet } from '../../../../src/components/BottomSheet';
import { Line, Tabs } from '../../../../src/components/Lists';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { IconTile, Avatar } from '../../../../src/components/Picture';
import { OrderLines } from '../../../../src/components/OrderLines';
import { BillSummary } from '../../../../src/components/BillSummary';
import { PinSheet } from '../../../../src/components/PinSheet';
import { ReasonSheet } from '../../../../src/components/ReasonSheet';

const round2 = (n) => Math.round(n * 100) / 100;

// One request in full: what is asked, by whom and why, the order it is about, what it changes,
// and what the bill would be afterwards. Reject, or approve with the manager PIN. Nothing
// changes until the server has checked the PIN.
export default function ApprovalDetail() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const hasPin = useAuth((s) => s.user?.has_pin);
  const decides = useCan('approvals.decide');
  const livePending = useLive((s) => s.approvals.some((a) => a.id === id));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [adjust, setAdjust] = useState(null); // { type, value, note } while "Approve Discount" is open
  const [askPin, setAskPin] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const load = () => {
    setError(null);
    api(`/approvals/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  };
  useEffect(load, [id, livePending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return (
      <Screen header={<AppHeader title="Request" back />}>
        <ListState loading={!error} error={error} onRetry={load} rowHeight={110} />
      </Screen>
    );
  }

  const { approval: a, order } = data;
  const meta = APPROVAL_TYPES[a.type] ?? APPROVAL_TYPES.discount;
  const p = a.payload || {};
  const waiting = a.status === 'pending';
  const where = a.table_label ? tableName(a.table_label) : orderLabel({ type: a.order_type, customer_name: a.customer_name, car_number: a.car_number });
  const isDiscount = a.type === 'discount';
  const item = order.items.find((i) => i.id === a.order_item_id);
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

  // The approver may change what is given before confirming.
  const given = adjust ? { type: adjust.type, value: Number(adjust.value) || 0 } : { type: p.type || 'pct', value: p.value ?? p.pct };
  const givenAmount = given.type === 'amount' ? given.value : round2((order.subtotal * given.value) / 100);
  const changed = adjust && (adjust.type !== (p.type || 'pct') || Number(adjust.value) !== Number(p.value ?? p.pct));
  const overBill = given.type === 'amount' ? given.value > order.subtotal : given.value > 100;

  // Throws on a wrong PIN, so the PIN pad can show the message and ask again.
  const approve = async (pin) => {
    await send('approval.decide', {
      approvalId: a.id,
      approve: true,
      pin,
      reason: adjust?.note?.trim() || undefined,
      override: isDiscount && changed ? given : undefined,
    });
    setAskPin(false);
    setAdjust(null);
    toast(`${approvalShort(a)} approved · ${a.requested_by_name} notified`, { tone: 'success', duration: 4000 });
    router.back();
  };

  const reject = async (reason) => {
    try {
      await send('approval.decide', { approvalId: a.id, approve: false, reason });
      toast(`${approvalShort(a)} rejected · ${a.requested_by_name} notified`, { icon: 'close-circle-outline' });
      setRejecting(false);
      router.back();
    } catch (err) {
      fail(err);
    }
  };

  const startApprove = () => (isDiscount ? setAdjust({ type: p.type || 'pct', value: String(p.value ?? p.pct ?? ''), note: '' }) : setAskPin(true));

  return (
    <Screen
      header={<AppHeader title={meta.title} subtitle={`Request #A${a.id} · ${ago(a.created_at)}`} back />}
      footer={
        waiting && decides ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Reject" icon="close" variant="secondary" onPress={() => setRejecting(true)} style={{ flex: 1 }} />
            <Button title="Approve" icon="check" disabled={!hasPin} onPress={startApprove} style={{ flex: 1.3 }} />
          </View>
        ) : null
      }
    >
      <View style={{ gap: 14 }}>
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconTile icon={meta.icon} tone={meta.tone} />
            <View style={{ flex: 1 }}>
              <Txt size={17} weight={700}>
                {where}
              </Txt>
              <Txt size={13} color="textSecondary">
                {a.area_name || TYPE_LABEL[a.order_type]}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt size={15} weight={700}>
                Order #{a.order_number}
              </Txt>
              <Txt size={12} color="textSecondary" tabular>
                {clock(a.order_created_at)} · {TYPE_LABEL[a.order_type]}
              </Txt>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
            <Avatar name={a.requested_by_name} size={36} />
            <View style={{ flex: 1 }}>
              <Txt size={12} color="textSecondary">
                Requested by
              </Txt>
              <Txt size={15} weight={600}>
                {a.requested_by_name}
                {a.requested_by_role ? ` (${a.requested_by_role})` : ''}
              </Txt>
            </View>
            <Chip label={waiting ? 'Pending' : a.status === 'approved' ? 'Approved' : 'Rejected'} tone={waiting ? 'warning' : a.status === 'approved' ? 'success' : 'neutral'} />
          </View>
          <View style={{ gap: 4, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.primaryTint }}>
            <Txt size={13} weight={700}>
              Reason
            </Txt>
            <Txt size={14}>{p.reason || 'No reason given'}</Txt>
          </View>
        </Card>

        {!waiting ? (
          <Notice
            tone={a.status === 'approved' ? 'success' : 'neutral'}
            icon={a.status === 'approved' ? 'check-circle-outline' : 'close-circle-outline'}
            title={`${a.status === 'approved' ? 'Approved' : 'Rejected'} by ${a.decided_by_name ?? 'a manager'} · ${ago(a.decided_at)}`}
            text={p.decision_reason || undefined}
          />
        ) : null}

        {a.type === 'cancel' || a.type === 'void' ? (
          <Card style={{ gap: 10 }}>
            <Txt size={15} weight={700}>
              {a.type === 'void' ? 'Item to void (already served)' : 'Item to cancel'}
            </Txt>
            <Line label={`${a.item_qty} × ${a.item_name}${a.item_size ? ` (${a.item_size})` : ''}`} value={money(p.amount ?? a.item_amount)} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip label={`Kitchen: ${ITEM_STATUS[p.item_status ?? a.item_status]?.label ?? a.item_status}`} icon="pot-steam-outline" tone="warning" />
              {item?.kot_number ? <Chip label={`KOT #${item.kot_number}`} icon="receipt-text-outline" /> : null}
            </View>
            <View style={{ gap: 6, paddingTop: 10, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
              <Line label="Bill now" value={money(p.total_before ?? order.total)} muted />
              <Line label="Taken off the bill" value={`− ${money(round2((p.total_before ?? 0) - (p.total_after ?? 0)) || p.amount || 0)}`} tone="error" muted />
              <Line label="Bill after" value={money(p.total_after ?? order.total)} strong />
            </View>
            {a.type === 'cancel' ? <Txt size={13} color="textSecondary">The kitchen has already started this dish, so the food is lost if it is cancelled.</Txt> : null}
          </Card>
        ) : null}

        {a.type === 'refund' ? (
          <Card style={{ gap: 8 }}>
            <Txt size={15} weight={700}>
              Refund requested
            </Txt>
            <Line label="Paid on this bill" value={money(p.paid ?? order.paid_total)} muted />
            <Line label={`Give back by ${methodLabel(p.method)}`} value={`− ${money(p.amount)}`} tone="error" strong />
          </Card>
        ) : null}

        <Card style={{ gap: 12 }}>
          <Txt size={15} weight={700}>
            {isDiscount && waiting ? 'Bill Details (Before Discount)' : 'Bill Details'}
          </Txt>
          <OrderLines order={{ ...order, items: liveItems(order) }} />
          <BillSummary bill={order} totalLabel={isDiscount && waiting ? 'Total Amount (Before Discount)' : 'Total Amount'} />
        </Card>

        {isDiscount ? (
          <View style={{ gap: 8, padding: 14, borderRadius: t.radius.card, backgroundColor: t.c.primaryTint }}>
            <Txt size={15} weight={700}>
              Requested Discount
            </Txt>
            <Line label="Discount type" value={p.type === 'amount' ? `Fixed amount (${money(p.value)})` : `Percentage (${p.value ?? p.pct}%)`} muted />
            <Line label="Discount amount" value={`− ${money(p.amount ?? 0)}`} tone="error" muted />
            <Line label="Estimated total (after discount)" value={money(p.total_after ?? order.total)} strong />
          </View>
        ) : null}

        {waiting && decides && !hasPin ? (
          <Notice tone="warning" icon="lock-outline" title="Set your Manager PIN first" text="Approving needs a PIN only you know.">
            <Button title="Open Manager PIN" variant="link" onPress={() => router.push('/more/settings/pin')} />
          </Notice>
        ) : null}
      </View>

      <BottomSheet
        visible={!!adjust && !askPin}
        onClose={() => setAdjust(null)}
        title="Approve Discount"
        footer={<Button title="Confirm Approval" disabled={!(given.value > 0) || overBill} onPress={() => setAskPin(true)} />}
      >
        <Txt size={13} color="textSecondary">
          {where} · Order #{a.order_number}. Change the discount here if you want to give something else.
        </Txt>
        <Tabs options={[{ value: 'pct', label: 'Percentage' }, { value: 'amount', label: 'Fixed Amount' }]} value={adjust?.type ?? 'pct'} onChange={(type) => setAdjust((d) => ({ ...d, type, value: '' }))} />
        <TextField label={adjust?.type === 'amount' ? 'Discount amount (₹)' : 'Discount (%)'} value={adjust?.value ?? ''} onChangeText={(text) => setAdjust((d) => ({ ...d, value: text.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" maxLength={8} error={overBill} />
        <Card style={{ gap: 6 }}>
          <Line label="Discount amount" value={`− ${money(givenAmount)}`} tone="error" />
          {changed ? <Txt size={12} color="textSecondary">Changed from the {p.type === 'amount' ? money(p.value) : `${p.value ?? p.pct}%`} that was asked for.</Txt> : null}
        </Card>
        <TextField label="Note (optional)" value={adjust?.note ?? ''} onChangeText={(note) => setAdjust((d) => ({ ...d, note }))} placeholder="e.g. Approved, birthday offer" autoCapitalize="sentences" maxLength={150} />
      </BottomSheet>

      <PinSheet
        visible={askPin}
        text={`Enter your PIN to approve: ${approvalShort(a)}`}
        onSubmit={approve}
        onClose={() => setAskPin(false)}
        onForgot={() => { setAskPin(false); setAdjust(null); router.push('/more/settings/pin'); }}
      />
      <ReasonSheet
        visible={rejecting}
        title={`Reject: ${approvalShort(a)}?`}
        text={`A reason is optional. ${a.requested_by_name} sees it.`}
        reasons={a.type === 'discount' ? ['Not allowed', 'Too much', 'Ask me at the counter'] : ['Already cooked', 'Already served', 'Not allowed']}
        submitLabel="Reject"
        optional
        onSubmit={reject}
        onClose={() => setRejecting(false)}
      />
    </Screen>
  );
}
