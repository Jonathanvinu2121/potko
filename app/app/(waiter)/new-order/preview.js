import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useMenu } from '../../../src/store/menu';
import { useDraft, lineTotal, totals } from '../../../src/store/draft';
import { useConnection, send } from '../../../src/lib/ws';
import { toast } from '../../../src/store/toast';
import { money, orderLabel } from '../../../src/lib/format';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Card } from '../../../src/components/Card';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { Stepper } from '../../../src/components/Stepper';
import { VegMark } from '../../../src/components/VegMark';
import { ItemSheet } from '../../../src/components/ItemSheet';

const TYPE_ICONS = { dine_in: 'silverware-fork-knife', delivery: 'moped-outline', takeaway: 'car-outline' };
// Padding inside a dish's box. The remove cross is pulled back out by the same amounts to sit in the corner.
const BOX_PAD_X = 14;
const BOX_PAD_Y = 12;

// W7 Order preview: check the items, edit or remove, then Send to Kitchen.
export default function Preview() {
  const t = useTheme();
  const router = useRouter();
  const draft = useDraft();
  const menuItems = useMenu((s) => s.items);
  const online = useConnection((s) => s.status) === 'online';
  const [editing, setEditing] = useState(null); // the line open in the item sheet
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null); // the saved order, once the kitchen has it

  if (!draft.type && !sent) return <Redirect href="/new-order" />;

  const { count, subtotal } = totals(draft.lines);
  const label = sent ? orderLabel(sent) : orderLabel(draft);
  const locked = !!sent || sending; // nothing can be changed while sending or once sent
  const adding = !!draft.addTo;

  const remove = (line) => {
    const removed = draft.removeLine(line.key);
    if (!removed) return;
    toast(`${line.name} removed`, {
      icon: 'trash-can-outline',
      duration: 4000,
      action: { label: 'Undo', onPress: () => useDraft.getState().restoreLine(removed) },
    });
  };

  const sendToKitchen = async () => {
    setSending(true);
    try {
      const adding = draft.addTo;
      const order = await send(
        adding ? 'order.addItems' : 'order.create',
        {
          orderId: adding?.orderId,
          replacesItemId: adding?.replacesItemId ?? undefined,
          type: draft.type,
          tableId: draft.table?.id,
          customerName: draft.customerName,
          customerPhone: draft.customerPhone,
          deliveryAddress: draft.deliveryAddress,
          carNumber: draft.carNumber,
          items: draft.lines.map((l) => ({
            menuItemId: l.itemId,
            size: l.size,
            qty: l.qty,
            customisations: l.customisations,
            note: l.note,
            allergyNote: l.allergyNote,
          })),
        },
        draft.clientId // the same id on a retry, so the kitchen never gets the order twice
      );
      // Only now, with the server's answer in hand, is success shown.
      setSent(order);
      toast(`Sent to kitchen · Order #${order.number}`, { tone: 'success' });
      setTimeout(() => {
        useDraft.getState().clear();
        router.dismissAll(); // back to the New Order page, ready for the next order
      }, 1500);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
      if (err.code === 'item_unavailable' || err.code === 'unknown_item') useMenu.getState().load();
      // The table lock ran out (5 minutes idle) or someone else has it now: choose the table again.
      if (err.code === 'table_not_yours') router.dismissTo('/new-order/tables');
      // The order was paid or closed meanwhile: there is nothing left to add to.
      if (err.code === 'no_order') {
        useDraft.getState().clear();
        router.dismissAll();
      }
    } finally {
      setSending(false);
    }
  };

  const lines = draft.lines;

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={adding ? 'Review added items' : 'Review order'} back={!sent} />}
      footer={
        sent ? (
          <View
            accessibilityRole="alert"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: t.d.control,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: t.radius.control,
              backgroundColor: t.c.successTint,
            }}
          >
            <Icon name="check-circle" size={26} color="success" />
            <View>
              <Txt size={15} weight={700} color="successText">
                Sent to kitchen
              </Txt>
              <Txt size={12} color="successText" tabular>
                Order #{sent.number} · {label}
              </Txt>
            </View>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            {!online ? (
              <Txt size={12} color="error" center>
                Not connected. You can send as soon as the connection is back.
              </Txt>
            ) : null}
            <Button
              title={`Send to Kitchen · ${money(subtotal)}`}
              icon="send-outline"
              loading={sending}
              disabled={!online || count === 0}
              onPress={sendToKitchen}
            />
          </View>
        )
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Chip label={label} icon={TYPE_ICONS[sent?.type ?? draft.type]} tone="primary" />
        <Txt size={12} weight={700} color="textSecondary" tabular style={{ letterSpacing: 1.2 }}>
          {count} {count === 1 ? 'ITEM' : 'ITEMS'}
        </Txt>
      </View>

      <View style={{ gap: t.d.gap }}>
        {/* One box per dish. Tap the name to edit it, − / + for quantity, and the red cross in the
            box's top-right corner (where a window's close button is) takes the dish off the order. */}
        {lines.map((line) => {
          const extras = [...line.customisations, line.note].filter(Boolean).join(' · ');
          return (
            <View
              key={line.key}
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  gap: 8,
                  paddingHorizontal: BOX_PAD_X,
                  paddingVertical: BOX_PAD_Y,
                  borderRadius: t.radius.card,
                  borderWidth: t.borderWidth,
                  borderColor: t.c.border,
                  backgroundColor: t.c.card,
                },
                t.shadow,
              ]}
            >
              <Pressable
                onPress={() => setEditing(line)}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${line.qty} ${line.name}`}
                style={({ pressed }) => ({ flex: 1, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  {/* the veg mark lines up with the first line of the name */}
                  <View style={{ height: Math.round(t.size(15) * 1.35), justifyContent: 'center' }}>
                    <VegMark veg={line.veg} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={15} weight={600}>
                      {line.name}
                      {line.size ? ` (${line.size})` : ''}
                    </Txt>
                    {extras ? (
                      <Txt size={13} color="primary">
                        {extras}
                      </Txt>
                    ) : null}
                    {line.allergyNote ? (
                      <Txt size={13} weight={600} color="error">
                        Allergy: {line.allergyNote}
                      </Txt>
                    ) : null}
                  </View>
                </View>
              </Pressable>

              <View style={{ justifyContent: 'center' }}>
                {locked ? (
                  <Txt size={15} weight={700} color="primary" tabular>
                    {line.qty}×
                  </Txt>
                ) : (
                  <Stepper compact value={line.qty} onChange={(qty) => draft.updateLine(line.key, { qty })} />
                )}
              </View>

              {/* right-hand column: the cross sits flush in the box's corner, the price under it */}
              <View style={{ minWidth: 46, alignItems: 'flex-end', justifyContent: locked ? 'center' : 'space-between' }}>
                {locked ? null : (
                  <Pressable
                    onPress={() => remove(line)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${line.name}`}
                    hitSlop={{ left: 8, bottom: 8 }}
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      marginTop: -BOX_PAD_Y,
                      marginRight: -BOX_PAD_X,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.6 : 1,
                      transform: [{ scale: pressed ? 0.9 : 1 }],
                    })}
                  >
                    <View style={{ width: 24, height: 24, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.error }}>
                      <Icon name="close" size={16} color="onPrimary" />
                    </View>
                  </Pressable>
                )}
                <Txt size={15} weight={700} tabular>
                  {money(lineTotal(line))}
                </Txt>
              </View>
            </View>
          );
        })}

        {sent ? null : (
          <Button title="+ Add more items" variant="secondary" disabled={sending} onPress={() => router.back()} />
        )}

        {lines.length === 0 ? (
          <Txt color="textSecondary" center style={{ paddingVertical: 12 }}>
            Nothing in this order yet. Add items to send it to the kitchen.
          </Txt>
        ) : (
          <Card style={{ gap: 8 }}>
            <Txt size={12} weight={700} color="textSecondary" style={{ letterSpacing: 1.2 }}>
              BILL SUMMARY
            </Txt>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt color="textSecondary">Subtotal</Txt>
              <Txt weight={600} tabular>
                {money(subtotal)}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Txt color="textSecondary">Discount</Txt>
              <Txt weight={600} tabular color="textSecondary">
                {money(0)}
              </Txt>
            </View>
            <View style={{ borderTopWidth: t.borderWidth, borderTopColor: t.c.border, borderStyle: 'dashed', marginVertical: 2 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Txt size={17} weight={700}>
                Total
              </Txt>
              <Txt size={20} weight={700} tabular>
                {money(subtotal)}
              </Txt>
            </View>
          </Card>
        )}
      </View>

      <ItemSheet
        item={editing ? menuItems.find((m) => m.id === editing.itemId) ?? null : null}
        line={editing}
        onClose={() => setEditing(null)}
        onDone={(message) => toast(message)}
      />
    </Screen>
  );
}
