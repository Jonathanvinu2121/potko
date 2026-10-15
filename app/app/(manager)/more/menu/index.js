import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useMenuAdmin } from '../../../../src/store/menu';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { BottomSheet } from '../../../../src/components/BottomSheet';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { Toggle } from '../../../../src/components/Bits';
import { SearchField } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';
import { Picture } from '../../../../src/components/Picture';
import { PictureField } from '../../../../src/components/PictureField';
import { ActionSheet, MoreButton, SwitchRow, NumberRow } from '../../../../src/components/Forms';
import { DragList } from '../../../../src/components/DragList';
import { useSwitchConfirm } from '../../../../src/components/SwitchConfirm';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

// Add or edit a category, typed in. (Importing many from a file is chosen before this opens.)
function CategorySheet({ category, count, visible, onClose }) {
  const [form, setForm] = useState({ name: '', description: '', position: 1, active: true, image_id: null });
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(null);
  const key = visible ? (category?.id ?? 'new') : null;
  if (key !== seen) {
    setSeen(key);
    if (visible) {
      setForm(category ? { name: category.name, description: category.description ?? '', position: category.position, active: category.active, image_id: category.image_id } : { name: '', description: '', position: count + 1, active: true, image_id: null });
    }
  }
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, description: form.description, active: form.active, image_id: form.image_id, position: form.position };
      const result = category ? await api(`/menu/categories/${category.id}`, { method: 'PATCH', body }) : await api('/menu/categories', { method: 'POST', body });
      toast(category ? `${result.category.name} saved` : `${result.category.name} added`, { tone: 'success' });
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
      title={category ? 'Edit Category' : 'Add Category'}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save Category" disabled={!form.name.trim()} loading={busy} onPress={save} style={{ flex: 1.5 }} />
        </View>
      }
    >
      <PictureField imageId={form.image_id} onChange={(image_id) => set({ image_id })} icon="shape-outline" hint="JPG or PNG. Shown next to the category." />
      <TextField label="Category Name" required value={form.name} onChangeText={(name) => set({ name })} placeholder="e.g. Burgers" autoCapitalize="words" maxLength={40} />
      <TextField label="Description (optional)" value={form.description} onChangeText={(description) => set({ description })} placeholder="e.g. Delicious burgers, sandwiches" autoCapitalize="sentences" maxLength={120} />
      <NumberRow label="Display Order" value={form.position} min={1} max={Math.max(1, count + (category ? 0 : 1))} onChange={(position) => set({ position })} unit="1 is shown first" />
      <SwitchRow title={form.active ? 'Active' : 'Inactive'} text="Inactive categories do not appear for waiters" value={form.active} onChange={(active) => set({ active })} />
    </BottomSheet>
  );
}

// More > Menu: the categories. Search, add (Add Category asks Add Manually or Import from File,
// as "+ Add" does for dishes), switch on and off, drag into order, and open one to manage its
// items. There is no separate import button here.
export default function MenuCategories() {
  const t = useTheme();
  const router = useRouter();
  const { categories, status, error, load } = useMenuAdmin();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(undefined); // undefined = closed, null = new, object = edit
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false); // the Add Manually / Import from File question
  const [removing, setRemoving] = useState(null);
  const [toggling, setToggling] = useState(null);
  const [busy, setBusy] = useState(false);
  const switcher = useSwitchConfirm();

  useEffect(() => {
    load();
  }, [load]);

  const shown = categories.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const at = (category) => categories.findIndex((c) => c.id === category.id);

  const setActive = async (category, active) => {
    setToggling(category.id);
    try {
      await api(`/menu/categories/${category.id}`, { method: 'PATCH', body: { active } });
      toast(`${category.name} is ${active ? 'on every menu again' : 'hidden from waiters'}`, { icon: active ? 'check-circle-outline' : 'eye-off-outline' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setToggling(null);
    }
  };
  // Dragged into a new order: saved at once; the list reloads from the server either way.
  const reorder = (rows) => api('/menu/categories/order', { method: 'PUT', body: { ids: rows.map((c) => c.id) } }).then(load).catch((err) => { fail(err); load(); });
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/menu/categories/${removing.id}`, { method: 'DELETE' });
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
    <Screen header={<AppHeader title="Menu Management" subtitle="Manage categories and items" back />}>
      <View style={{ gap: 12 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search categories" />
        <Button title="Add Category" icon="plus" onPress={() => setAdding(true)} />

        {status === 'error' ? (
          <ListState error={error} onRetry={load} />
        ) : status !== 'ready' ? (
          <ListState loading rowHeight={72} rows={5} />
        ) : shown.length === 0 ? (
          <ListState empty icon="silverware-fork-knife" title={categories.length ? 'No category matches' : 'No categories yet'} text={categories.length ? 'Try another name.' : 'Add the first category, or import your menu from a file.'} />
        ) : (
          <DragList
            data={shown}
            keyOf={(c) => c.id}
            disabled={!!query.trim()}
            onReorder={reorder}
            renderRow={(category, handle) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 2, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
              {handle}
              <Pressable
                onPress={() => router.push(`/more/menu/${category.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${category.name}, ${plural(category.item_count, 'item')}. Open.`}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : category.active ? 1 : 0.55 })}
              >
                <Picture imageId={category.image_id} icon="silverware-fork-knife" size={52} />
                <View style={{ flex: 1 }}>
                  <Txt size={16} weight={700} numberOfLines={1}>
                    {category.name}
                  </Txt>
                  <Txt size={13} color="textSecondary">
                    {plural(category.item_count, 'item')}
                  </Txt>
                </View>
              </Pressable>
              <Toggle quiet label={category.active ? `${category.name} is on. Switch off` : `${category.name} is off. Switch on`} value={category.active} disabled={toggling === category.id} onChange={(on) => switcher.ask({ name: category.name, on, text: on ? 'Its dishes show for the waiters again.' : 'Its dishes are hidden from the waiters until you switch it on again.', apply: () => setActive(category, on) })} />
              <MoreButton label={`Actions for ${category.name}`} onPress={() => setMenu(category)} />
            </View>
            )}
          />
        )}
      </View>

      <CategorySheet
        visible={form !== undefined}
        category={form ? { ...form, position: at(form) + 1 } : null}
        count={categories.length}
        onClose={() => { setForm(undefined); load(); }}
      />
      <ActionSheet
        visible={adding}
        title="Add Category"
        onClose={() => setAdding(false)}
        actions={[
          { icon: 'shape-outline', title: 'Add Manually', subtitle: 'Create a category, one at a time', onPress: () => setForm(null) },
          { icon: 'tray-arrow-up', title: 'Import from File', subtitle: 'Many categories at once, from Excel or CSV', onPress: () => router.push('/more/menu/import?kind=categories') },
        ]}
      />
      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { icon: 'pencil-outline', title: 'Edit Category', onPress: () => setForm(menu) },
          { icon: 'trash-can-outline', title: 'Remove Category', destructive: true, onPress: () => setRemoving(menu) },
        ] : []}
      />
      <ConfirmSheet
        visible={!!removing}
        title={`Delete ${removing?.name ?? ''}?`}
        text={removing?.item_count ? `This also takes its ${plural(removing.item_count, 'item')} off the menu. Past orders and bills keep every dish as it was sold. To hide the category for a while, switch it off instead.` : 'The category is removed from the menu.'}
        confirmLabel={removing?.item_count ? `Delete with ${plural(removing.item_count, 'item')}` : 'Delete'}
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      {switcher.sheet}
    </Screen>
  );
}
