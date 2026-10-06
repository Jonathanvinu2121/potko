import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../../src/theme';
import { useLive } from '../../src/store/live';
import { useConnection, send } from '../../src/lib/ws';
import { toast } from '../../src/store/toast';
import { orderLabel } from '../../src/lib/format';
import { isOpen, readyItems } from '../../src/lib/orders';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';

// W9 Ready: every dish the kitchen has finished, grouped by order. Tap rows to select, then one
// button delivers them all. There are no per-dish Deliver buttons.
export default function Ready() {
  const t = useTheme();
  const orders = useLive((s) => s.orders);
  const online = useConnection((s) => s.status) === 'online';
  const [picked, setPicked] = useState([]); // ids of the selected dishes
  const [busy, setBusy] = useState(false);

  const groups = orders
    .filter(isOpen)
    .map((order) => ({ order, items: readyItems(order) }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => new Date(a.order.created_at) - new Date(b.order.created_at));
  const readyIds = groups.flatMap((g) => g.items.map((i) => i.id));
  // A dish delivered from another screen may still be in the selection: only count what is still ready.
  const selected = picked.filter((id) => readyIds.includes(id));

  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const setGroup = (items, on) =>
    setPicked((list) => {
      const ids = items.map((i) => i.id);
      return on ? [...new Set([...list, ...ids])] : list.filter((x) => !ids.includes(x));
    });

  const deliver = async () => {
    setBusy(true);
    try {
      const result = await send('waiter.deliver', { itemIds: selected });
      setPicked([]);
      toast(`${result.delivered} ${result.delivered === 1 ? 'item' : 'items'} delivered`, { tone: 'success' });
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll={groups.length > 0}
      edges={['top', 'left', 'right']}
      header={<AppHeader title="Ready to deliver" />}
      footer={
        groups.length === 0 ? null : (
          <Button
            title={selected.length === 0 ? 'Select items to deliver' : `Deliver selected (${selected.length})`}
            disabled={selected.length === 0 || !online}
            loading={busy}
            onPress={deliver}
          />
        )
      }
    >
      {groups.length === 0 ? (
        <EmptyState icon="bell-outline" title="Nothing ready yet" text="Ready kitchen items will appear here as soon as they are prepared." />
      ) : (
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: t.radius.control, backgroundColor: t.c.successTint }}>
            <Txt size={13} weight={700} color="successText" tabular>
              {selected.length} selected
            </Txt>
            <Txt size={13} weight={600} color="successText" tabular>
              {readyIds.length} {readyIds.length === 1 ? 'item' : 'items'} ready
            </Txt>
          </View>

          {groups.map(({ order, items }) => {
            const allOn = items.every((i) => selected.includes(i.id));
            return (
              <View key={order.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt size={15} weight={700} style={{ flex: 1 }} numberOfLines={1}>
                    {orderLabel(order)}
                  </Txt>
                  <Txt size={12} color="textSecondary" tabular>
                    Order #{order.number}
                  </Txt>
                  <Button title={allOn ? 'Clear' : 'Select all'} variant="link" onPress={() => setGroup(items, !allOn)} />
                </View>
                {items.map((item) => {
                  const on = selected.includes(item.id);
                  const detail = [item.size, ...item.customisations].filter(Boolean).join(' · ');
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => toggle(item.id)}
                      accessibilityRole="checkbox"
                      aria-checked={on}
                      accessibilityLabel={`${item.qty} ${item.name_snapshot}`}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        minHeight: 60,
                        padding: 12,
                        borderRadius: t.radius.card,
                        borderWidth: on ? 2 : t.borderWidth,
                        borderColor: on ? t.c.success : t.c.border,
                        backgroundColor: pressed ? t.c.pressed : t.c.card,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={26} color={on ? 'success' : 'textSecondary'} />
                      <View style={{ flex: 1 }}>
                        <Txt size={16} weight={600}>
                          <Txt size={16} weight={700} color="primary" tabular>
                            {item.qty}×{' '}
                          </Txt>
                          {item.name_snapshot}
                        </Txt>
                        {detail ? (
                          <Txt size={13} color="textSecondary">
                            {detail}
                          </Txt>
                        ) : null}
                        {item.allergy_note ? (
                          <Txt size={13} weight={600} color="error">
                            Allergy: {item.allergy_note}
                          </Txt>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
