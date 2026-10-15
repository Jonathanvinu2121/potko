import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useMenu } from '../../../src/store/menu';
import { useDraft } from '../../../src/store/draft';
import { useConnection, send } from '../../../src/lib/ws';
import { toast } from '../../../src/store/toast';
import { money, orderLabel } from '../../../src/lib/format';
import { ITEM_STATUS, TYPE_LABEL, TYPE_ICON, allSettled, cancelRequested, isOpen, itemsWith, onFloor } from '../../../src/lib/orders';
import { usePrices, useSeesBills } from '../../../src/lib/prices';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { ItemRow } from '../../../src/components/ItemRow';
import { ItemSheet } from '../../../src/components/ItemSheet';
import { ConfirmSheet } from '../../../src/components/ConfirmSheet';
import { ReasonSheet } from '../../../src/components/ReasonSheet';

const CANCEL_REASONS = ['Customer changed mind', 'Wrong item ordered', 'Waited too long', 'Customer left'];

// W6 Order status: what the kitchen has done with each dish, and what the waiter can still do.
//   Sent              Edit, Remove (until the kitchen starts preparing)
//   Preparing         locked; cancelling needs the manager
//   Ready             deliver
//   Unavailable       Replace item or Remove
export default function OrderStatus() {
  const t = useTheme();
  const prices = usePrices();
  const seesBills = useSeesBills();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const order = useLive((s) => s.orders.find((o) => o.id === id));
  const synced = useLive((s) => s.synced);
  const menuItems = useMenu((s) => s.items);
  const online = useConnection((s) => s.status) === 'online';
  const [busy, setBusy] = useState(null); // 'deliver' | 'close' | 'remove' | item id
  const [editing, setEditing] = useState(null); // dish open in the item sheet
  const [removing, setRemoving] = useState(null); // dish waiting for "are you sure?"
  const [cancelling, setCancelling] = useState(null); // dish whose cancel reason is being asked
  const [closing, setClosing] = useState(false);
  const [showDelivered, setShowDelivered] = useState(false);

  // Editing a dish needs the menu (its sizes and chips).
  useEffect(() => {
    useMenu.getState().load();
  }, []);

  // A paid table stays here until it is closed, so the waiter can still close or move it.
  if (!order || !onFloor(order)) {
    return (
      <Screen scroll={false} edges={['top', 'left', 'right']} header={<AppHeader title="Order" back />}>
        {synced ? (
          <EmptyState icon="receipt-text-check-outline" title="This order is closed" text="It has been paid or cancelled. Open orders are in the list." />
        ) : (
          <View style={{ gap: 12, paddingTop: 16 }}>
            <Skeleton height={48} />
            <Skeleton height={160} />
          </View>
        )}
      </Screen>
    );
  }

  const ready = itemsWith(order, 'ready');
  const unavailable = itemsWith(order, 'unavailable');
  const preparing = itemsWith(order, 'preparing');
  const waiting = itemsWith(order, 'accepted', 'sent');
  const delivered = itemsWith(order, 'delivered');
  const cancelled = itemsWith(order, 'cancelled');
  const settled = allSettled(order);
  const dineIn = order.type === 'dine_in';
  const paidBill = !isOpen(order); // paid, guests still seated

  // Runs one action. The screen itself redraws from the server's order.updated event.
  const run = async (key, type, payload, done) => {
    setBusy(key);
    try {
      const result = await send(type, payload);
      done?.(result);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(null);
    }
  };

  const deliver = () =>
    run('deliver', 'waiter.deliver', { itemIds: ready.map((i) => i.id) }, (r) =>
      toast(`${r.delivered} ${r.delivered === 1 ? 'item' : 'items'} delivered`, { tone: 'success' })
    );

  const addMore = (replaces = null) => {
    useDraft.getState().startAdd(order, replaces);
    router.push('/new-order/menu');
  };

  const saveEdit = (item, chosen) =>
    run(item.id, 'item.edit', {
      itemId: item.id,
      size: chosen.size,
      qty: chosen.qty,
      customisations: chosen.customisations,
      note: chosen.note,
      allergyNote: chosen.allergyNote,
    }, () => toast(`${item.name_snapshot} updated`));

  const remove = async () => {
    const item = removing;
    await run('remove', 'item.remove', { itemId: item.id }, (updated) => {
      toast(`${item.name_snapshot} removed`, { icon: 'trash-can-outline' });
      if (updated.status === 'cancelled') router.back(); // that was the last dish: the order is gone
    });
    setRemoving(null);
  };

  const requestCancel = async (reason) => {
    const item = cancelling;
    try {
      await send('approval.request', { type: 'cancel', orderId: order.id, itemId: item.id, payload: { reason } });
      toast(`${item.status === 'delivered' ? 'Void' : 'Cancel'} request sent to manager`, { icon: 'shield-account-outline' });
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    }
    setCancelling(null);
  };

  // The meal is over: the table shows "Bill requested", joins the payment queue, and the bill opens.
  // (Someone who may not see bills only asks for it: the counter takes it from there.)
  const askForBill = () =>
    run('close', 'bill.request', { orderId: order.id }, () => {
      setClosing(false);
      if (seesBills) router.push(`/given-orders/bill/${order.id}`);
      else toast('Bill sent to the counter', { icon: 'receipt-text-outline', tone: 'success' });
    }).then(() => setClosing(false));
  const openBill = () => (order.bill_requested_at ? (seesBills ? router.push(`/given-orders/bill/${order.id}`) : toast('The bill is with the counter', { icon: 'receipt-text-outline' })) : setClosing(true));

  // The guests have left a paid table: free it.
  const closePaidTable = () =>
    run('close', 'order.close', { orderId: order.id }, () => {
      toast(dineIn ? `${orderLabel(order)} closed and free again` : 'Order completed', { tone: 'success' });
      router.back();
    });

  // The saved dish, shaped like a draft line so the item sheet can open it filled in.
  const asLine = (item) => ({
    key: String(item.id),
    size: item.size,
    qty: item.qty,
    customisations: item.customisations,
    addons: item.addons || [],
    addonsTotal: (item.addons || []).reduce((sum, a) => sum + (Number(a.price) || 0), 0),
    note: item.note || '',
    allergyNote: item.allergy_note || '',
  });

  const card = (item) => {
    const status = ITEM_STATUS[item.status];
    const asked = cancelRequested(order, item.id);
    const working = busy === item.id;
    return (
      <Card key={item.id} style={[{ gap: 10 }, item.status === 'ready' && { borderColor: t.c.success, borderWidth: 2 }, item.status === 'unavailable' && { borderColor: t.c.error }]}>
        <ItemRow
          qty={item.qty}
          name={item.name_snapshot}
          veg={item.veg}
          size={item.size}
          customisations={[...(item.addons || []).map((a) => a.name), ...item.customisations]}
          note={item.note}
          allergyNote={item.allergy_note}
          done={item.status === 'cancelled'}
          right={
            <Txt size={16} weight={700} tabular color={item.status === 'unavailable' || item.status === 'cancelled' ? 'textSecondary' : 'text'}>
              {prices.show ? money(item.qty * item.unit_price) : ''}
            </Txt>
          }
        />
        {item.status === 'unavailable' && item.unavailable_reason ? (
          <Txt size={13} color="error">
            Kitchen: {item.unavailable_reason}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={status.label} icon={status.icon} tone={status.tone} />
          <View style={{ flex: 1 }} />
          {paidBill ? null : item.status === 'sent' || item.status === 'accepted' ? (
            <>
              <Button title="Edit" variant="secondary" loading={working} disabled={!!busy || !online} onPress={() => setEditing(item)} />
              <Button title="Remove" variant="secondary" disabled={!!busy || !online} onPress={() => setRemoving(item)} />
            </>
          ) : null}
          {!paidBill && item.status === 'unavailable' ? (
            <>
              <Button title="Replace item" variant="secondary" disabled={!!busy || !online} onPress={() => addMore(item)} />
              <Button title="Remove" variant="secondary" disabled={!!busy || !online} onPress={() => setRemoving(item)} />
            </>
          ) : null}
          {!paidBill && ['preparing', 'ready', 'delivered'].includes(item.status) ? (
            asked ? (
              <Chip label={`${item.status === 'delivered' ? 'Void' : 'Cancel'} requested · waiting for manager`} icon="shield-account-outline" tone="warning" />
            ) : (
              <Button title={`Request ${item.status === 'delivered' ? 'void' : 'cancel'} (needs manager)`} variant="link" disabled={!!busy || !online} onPress={() => setCancelling(item)} />
            )
          ) : null}
        </View>
      </Card>
    );
  };

  const group = (title, items) =>
    items.length === 0 ? null : (
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Txt size={15} weight={700}>
            {title}
          </Txt>
          <Txt size={12} color="textSecondary" tabular>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Txt>
        </View>
        {items.map(card)}
      </View>
    );

  const editingMenuItem = editing ? menuItems.find((m) => m.id === editing.menu_item_id) ?? null : null;

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={orderLabel(order)} back />}
      footer={
        <View style={{ gap: 8 }}>
          {!online ? (
            <Txt size={12} color="error" center>
              Not connected. Buttons work again as soon as the connection is back.
            </Txt>
          ) : null}
          {paidBill ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="View Bill" icon="receipt-text-outline" variant="secondary" disabled={!!busy} onPress={() => router.push(`/given-orders/bill/${order.id}`)} style={{ flex: 1 }} />
              <Button title={dineIn ? 'Close Table' : 'Complete Order'} icon="check-circle-outline" loading={busy === 'close'} disabled={!online} onPress={closePaidTable} style={{ flex: 1.2 }} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="Add Items" icon="plus-circle-outline" variant="secondary" disabled={!!busy || !online} onPress={() => addMore()} style={{ flex: 1 }} />
              {ready.length > 0 ? (
                <Button title={`Deliver ready (${ready.length})`} loading={busy === 'deliver'} disabled={!online} onPress={deliver} style={{ flex: 1.2 }} />
              ) : settled ? (
                <Button title={seesBills ? 'Bill & Payment' : order.bill_requested_at ? 'Bill at counter' : 'Send bill to counter'} icon="receipt-text-outline" disabled={!!busy || !online} onPress={openBill} style={{ flex: 1.2 }} />
              ) : null}
            </View>
          )}
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Chip label={TYPE_LABEL[order.type]} icon={TYPE_ICON[order.type]} tone="primary" />
          <Chip label={`Order #${order.number}`} />
          {order.prep_minutes && preparing.length > 0 ? <Chip label={`Kitchen says about ${order.prep_minutes} min`} icon="clock-outline" /> : null}
        </View>

        {ready.length > 0 ? (
          <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.successTint }}>
            <Icon name="bell-ring-outline" color="successText" />
            <Txt weight={700} color="successText">
              {ready.length} {ready.length === 1 ? 'item' : 'items'} ready to deliver
            </Txt>
          </View>
        ) : null}
        {settled && delivered.length > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.successTint }}>
            <Icon name={paidBill ? 'cash-check' : 'check-all'} color="successText" />
            <Txt weight={700} color="successText" style={{ flex: 1 }}>
              {paidBill ? `${prices.withPrice('Bill paid', order.total)}. Close the table when the guests leave${dineIn ? ', or move them from the Tables screen' : ''}.` : order.bill_requested_at ? 'All items delivered · bill requested' : 'All items delivered'}
            </Txt>
          </View>
        ) : null}

        {group('Unavailable', unavailable)}
        {group('Ready', ready)}
        {group('Preparing', preparing)}
        {group('Sent to kitchen', waiting)}

        {delivered.length + cancelled.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Pressable
              onPress={() => setShowDelivered((v) => !v)}
              accessibilityRole="button"
              aria-expanded={showDelivered}
              accessibilityLabel={`Delivered ${delivered.length}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 48,
                paddingHorizontal: 12,
                borderRadius: t.radius.control,
                borderWidth: t.borderWidth,
                borderColor: t.c.border,
                backgroundColor: pressed ? t.c.pressed : t.c.card,
              })}
            >
              <Icon name="check-all" color="successText" />
              <Txt weight={700} style={{ flex: 1 }}>
                Delivered ({delivered.length}){cancelled.length ? ` · Cancelled (${cancelled.length})` : ''}
              </Txt>
              <Icon name={showDelivered ? 'chevron-up' : 'chevron-down'} color="textSecondary" />
            </Pressable>
            {showDelivered ? [...delivered, ...cancelled].map(card) : null}
          </View>
        ) : null}
      </View>

      <ItemSheet item={editingMenuItem} line={editing ? asLine(editing) : null} onClose={() => setEditing(null)} onSubmit={(chosen) => saveEdit(editing, chosen)} />
      <ConfirmSheet
        visible={!!removing}
        title={removing ? `Remove ${removing.qty}× ${removing.name_snapshot}?` : ''}
        text="The kitchen is told straight away. This cannot be undone."
        confirmLabel="Remove"
        destructive
        busy={busy === 'remove'}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      <ConfirmSheet
        visible={closing}
        title={`Get the bill for ${orderLabel(order)}?`}
        text={dineIn ? 'The table shows "Bill requested" and the bill joins the payment queue. More items can still be added until it is paid.' : 'The bill joins the payment queue. More items can still be added until it is paid.'}
        confirmLabel="Get the Bill"
        busy={busy === 'close'}
        onConfirm={askForBill}
        onClose={() => setClosing(false)}
      />
      <ReasonSheet
        visible={!!cancelling}
        title={cancelling ? `${cancelling.status === 'delivered' ? 'Void' : 'Cancel'} ${cancelling.qty}× ${cancelling.name_snapshot}?` : ''}
        text={cancelling?.status === 'delivered' ? 'This dish was already served, so taking it off the bill needs a manager. Say why.' : 'The kitchen has started this dish, so a manager has to approve. Say why.'}
        reasons={CANCEL_REASONS}
        onSubmit={requestCancel}
        onClose={() => setCancelling(null)}
      />
    </Screen>
  );
}
