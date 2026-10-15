import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useMenuAdmin, priceRange } from '../../../../src/store/menu';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { money, plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Button } from '../../../../src/components/Button';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { useSwitchConfirm } from '../../../../src/components/SwitchConfirm';
import { EmptyState } from '../../../../src/components/EmptyState';
import { VegMark } from '../../../../src/components/VegMark';
import { Toggle } from '../../../../src/components/Bits';
import { SearchField } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';
import { Picture } from '../../../../src/components/Picture';
import { ActionSheet, MoreButton } from '../../../../src/components/Forms';
import { DragList } from '../../../../src/components/DragList';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

// One category: its items. Search; "+ Add" asks Add Manually or Import from File; switch an item
// on and off; drag into order; tap an item to see it (view only); ⋮ edits, duplicates or removes.
export default function CategoryItems() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const { categories, items, status, error, load } = useMenuAdmin();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [toggling, setToggling] = useState(null);
  const switcher = useSwitchConfirm();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  const category = categories.find((c) => c.id === id);
  const mine = items.filter((i) => i.category_id === id);
  const shown = mine.filter((i) => `${i.name} ${i.code}`.toLowerCase().includes(query.trim().toLowerCase()));
  const at = (item) => mine.findIndex((i) => i.id === item.id);

  if (status === 'ready' && !category) {
    return (
      <Screen scroll={false} header={<AppHeader title="Category" back />}>
        <EmptyState icon="silverware-fork-knife" title="This category is no longer there" text="It may have been deleted from another screen." />
      </Screen>
    );
  }

  const setAvailable = async (item, available) => {
    setToggling(item.id);
    try {
      await api(`/menu/items/${item.id}/availability`, { method: 'PATCH', body: { available } });
      toast(`${item.name} is ${available ? 'on every menu again' : 'switched off on every menu'}`, { icon: available ? 'check-circle-outline' : 'close-circle-outline' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setToggling(null);
    }
  };
  const reorder = (rows) => api(`/menu/categories/${id}/order`, { method: 'PUT', body: { ids: rows.map((i) => i.id) } }).then(load).catch((err) => { fail(err); load(); });
  const duplicate = async (item) => {
    try {
      const { item: copy } = await api(`/menu/items/${item.id}/duplicate`, { method: 'POST', body: {} });
      toast(`${copy.name} added, switched off until you check it`, { tone: 'success', icon: 'content-copy' });
      await load();
    } catch (err) {
      fail(err);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/menu/items/${removing.id}`, { method: 'DELETE' });
      toast(`${removing.name} deleted`, { tone: 'success' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <Screen header={<AppHeader title={category?.name ?? 'Category'} subtitle={category ? `${plural(mine.length, 'item')} · ${category.active ? 'Active' : 'Inactive'}` : undefined} back />}>
      <View style={{ gap: 12 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search items" />
        <Button title="Add" icon="plus" onPress={() => setAdding(true)} />

        {status === 'error' ? (
          <ListState error={error} onRetry={load} />
        ) : status !== 'ready' ? (
          <ListState loading rowHeight={68} rows={5} />
        ) : shown.length === 0 ? (
          <ListState empty icon="food-outline" title={mine.length ? 'No item matches' : 'No items here yet'} text={mine.length ? 'Try another name.' : 'Add the first item to this category, or import items from a file.'} />
        ) : (
          <DragList
            data={shown}
            keyOf={(i) => i.id}
            disabled={!!query.trim()}
            onReorder={reorder}
            renderRow={(item, handle) => {
            const [low, high] = priceRange(item);
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 2, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
                {handle}
                <Pressable
                  onPress={() => router.push(`/more/menu/preview?id=${item.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}. Open.`}
                  style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : item.available ? 1 : 0.55 })}
                >
                  <Picture imageId={item.image_id} icon="food-outline" size={48} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <VegMark veg={item.veg} size={14} />
                      <Txt size={15} weight={700} numberOfLines={1} style={{ flex: 1 }}>
                        {item.name}
                      </Txt>
                    </View>
                    <Txt size={13} color="textSecondary" tabular numberOfLines={1}>
                      {item.open_price ? 'Open price' : low === high ? money(low) : `${money(low)} – ${money(high)}`} · {item.code}
                    </Txt>
                  </View>
                </Pressable>
                <Toggle quiet label={item.available ? `${item.name} is on. Switch off` : `${item.name} is off. Switch on`} value={item.available} disabled={toggling === item.id} onChange={(on) => switcher.ask({ name: item.name, on, text: on ? 'Waiters can order it again.' : 'Waiters cannot order it until it is switched on again.', apply: () => setAvailable(item, on) })} />
                <MoreButton label={`Actions for ${item.name}`} onPress={() => setMenu(item)} />
              </View>
            );
            }}
          />
        )}
      </View>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { icon: 'pencil-outline', title: 'Edit Item', onPress: () => router.push(`/more/menu/item?id=${menu.id}`) },
          { icon: 'content-copy', title: 'Duplicate Item', onPress: () => duplicate(menu) },
          { icon: 'trash-can-outline', title: 'Remove Item', destructive: true, onPress: () => setRemoving(menu) },
        ] : []}
      />
      <ActionSheet
        visible={adding}
        title="Add to Menu"
        onClose={() => setAdding(false)}
        actions={[
          { icon: 'silverware-fork-knife', title: 'Add Manually', subtitle: 'Create an item, one at a time', onPress: () => router.push(`/more/menu/item?category=${id}`) },
          { icon: 'tray-arrow-up', title: 'Import from File', subtitle: 'Many items at once, from Excel or CSV', onPress: () => router.push('/more/menu/import?kind=items') },
        ]}
      />
      <ConfirmSheet
        visible={!!removing}
        title={`Delete ${removing?.name ?? ''}?`}
        text="It leaves the menu for good. Past orders and bills keep it as it was sold. To stop selling it for a while, switch it off instead."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      {switcher.sheet}
    </Screen>
  );
}
