import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useLive } from '../../../../src/store/live';
import { useMenu } from '../../../../src/store/menu';
import { useDraft, lineTotal, totals } from '../../../../src/store/draft';
import { send } from '../../../../src/lib/ws';
import { toast } from '../../../../src/store/toast';
import { money, orderLabel, plural } from '../../../../src/lib/format';
import { isOpen } from '../../../../src/lib/orders';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { EmptyState } from '../../../../src/components/EmptyState';
import { Stepper } from '../../../../src/components/Stepper';
import { VegMark } from '../../../../src/components/VegMark';
import { SearchField } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';
import { ItemSheet } from '../../../../src/components/ItemSheet';

// Orders > an order > Add Item: more dishes for an order that is already with the kitchen.
// Pick dishes, check the list at the top, then send them: the kitchen gets a new ticket.
export default function AddItems() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const order = useLive((s) => s.orders.find((o) => o.id === id));
  const { categories, items, status, error, load } = useMenu();
  const lines = useDraft((s) => s.lines);
  const addTo = useDraft((s) => s.addTo);
  const clientId = useDraft((s) => s.clientId);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [sheetItem, setSheetItem] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    load();
  }, [load]);
  // The list being built belongs to this order; one left over from another order is dropped.
  useEffect(() => {
    if (order && useDraft.getState().addTo?.orderId !== order.id) useDraft.getState().startAdd(order);
  }, [order]);

  if (!order || !isOpen(order)) {
    return (
      <Screen scroll={false} header={<AppHeader title="Add Item" back />}>
        <EmptyState icon="receipt-text-check-outline" title="Nothing can be added" text="This order is paid or closed." />
      </Screen>
    );
  }

  const mine = addTo?.orderId === order.id ? lines : [];
  const { count, subtotal } = totals(mine);
  const text = query.trim().toLowerCase();
  const shown = items.filter((i) => (text ? `${i.name} ${i.code}`.toLowerCase().includes(text) : categoryId ? i.category_id === categoryId : true));

  const sendToKitchen = async () => {
    setSending(true);
    try {
      await send(
        'order.addItems',
        {
          orderId: order.id,
          items: mine.map((l) => ({ menuItemId: l.itemId, price: l.openPrice ?? undefined, size: l.size, qty: l.qty, customisations: l.customisations, addons: (l.addons || []).map(({ group, name }) => ({ group, name })), note: l.note, allergyNote: l.allergyNote })),
        },
        clientId // the same id on a retry, so the kitchen never gets the dishes twice
      );
      toast(`${plural(count, 'item')} sent to the kitchen`, { tone: 'success' });
      useDraft.getState().clear();
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
      if (err.code === 'item_unavailable' || err.code === 'unknown_item') load();
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen
      header={<AppHeader title="Add Item" subtitle={`${orderLabel(order)} · Order #${order.number}`} back />}
      footer={<Button title={count ? `Send to Kitchen · ${plural(count, 'item')} · ${money(subtotal)}` : 'Choose items to add'} icon={count ? 'send-outline' : undefined} disabled={count === 0} loading={sending} onPress={sendToKitchen} />}
    >
      <View style={{ gap: 12 }}>
        {mine.length ? (
          <Card style={{ gap: 6 }}>
            <Txt size={12} weight={700} color="textSecondary" style={{ letterSpacing: 1.2 }}>
              TO SEND
            </Txt>
            {mine.map((line) => (
              <View key={line.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable onPress={() => setEditing(line)} accessibilityRole="button" accessibilityLabel={`Edit ${line.name}`} style={({ pressed }) => ({ flex: 1, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <Txt size={15} weight={600} numberOfLines={1}>
                    {line.name}
                    {line.size ? ` (${line.size})` : ''}
                  </Txt>
                  <Txt size={12} color="textSecondary" numberOfLines={1}>
                    {[...(line.addons || []).map((a) => a.name), ...line.customisations, line.note, money(lineTotal(line))].filter(Boolean).join(' · ')}
                  </Txt>
                </Pressable>
                <Stepper compact value={line.qty} onChange={(qty) => useDraft.getState().updateLine(line.key, { qty })} />
                <Pressable onPress={() => useDraft.getState().removeLine(line.key)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${line.name}`} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close-circle" color="error" />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <SearchField value={query} onChangeText={setQuery} placeholder="Search by name or code" />
        {text ? null : (
          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            <Chip label="All" selected={categoryId === null} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </ScrollView>
        )}

        {status === 'error' ? (
          <ListState error={error} onRetry={load} />
        ) : status !== 'ready' ? (
          <ListState loading rows={6} rowHeight={56} />
        ) : shown.length === 0 ? (
          <ListState empty icon="food-off-outline" title="No dish matches" text="Try another name, code or category." />
        ) : (
          shown.map((item) => {
            const inList = mine.filter((l) => l.itemId === item.id).reduce((n, l) => n + l.qty, 0);
            return (
              <Pressable
                key={item.id}
                onPress={() => setSheetItem(item)}
                disabled={!item.available}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${money(item.price)}${item.available ? '' : ', unavailable'}${inList ? `, ${inList} to send` : ''}`}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: t.radius.control, borderWidth: inList ? 2 : t.borderWidth, borderColor: inList ? t.c.primary : t.c.border, backgroundColor: pressed ? t.c.pressed : t.c.card, opacity: item.available ? 1 : 0.5 })}
              >
                <VegMark veg={item.veg} size={14} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600} numberOfLines={1}>
                    {item.name}
                  </Txt>
                  <Txt size={12} color="textSecondary" tabular>
                    {item.code} · {item.available ? money(item.price) : 'Unavailable'}
                  </Txt>
                </View>
                {inList ? <Chip label={`${inList}×`} tone="primary" size={12} /> : <Icon name="plus-circle-outline" color="primary" />}
              </Pressable>
            );
          })
        )}
      </View>

      <ItemSheet item={sheetItem} onClose={() => setSheetItem(null)} onDone={(message) => toast(message)} />
      <ItemSheet item={editing ? items.find((m) => m.id === editing.itemId) ?? null : null} line={editing} onClose={() => setEditing(null)} onDone={(message) => toast(message)} />
    </Screen>
  );
}
