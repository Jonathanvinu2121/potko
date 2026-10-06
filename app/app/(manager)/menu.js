import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { useMenu } from '../../src/store/menu';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/toast';
import { money } from '../../src/lib/format';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { Segmented } from '../../src/components/Segmented';
import { BottomSheet } from '../../src/components/BottomSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';
import { VegMark } from '../../src/components/VegMark';
import { Toggle } from '../../src/components/Bits';

const BLANK = { name: '', veg: true, price: '', sizes: [], customisations: '', addons: '', code: '' };

// Menu management: add and edit dishes, sizes and prices, and switch a dish Available / Out of stock.
// Every change reaches all waiter menus at once.
export default function MenuAdmin() {
  const t = useTheme();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const { categories, items, status, error, load } = useMenu();
  const [categoryId, setCategoryId] = useState(null);
  const [editing, setEditing] = useState(null); // a menu item, or { category_id } for a new one
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(null);
  const [newCategory, setNewCategory] = useState(null); // { name, prefix } while the sheet is open

  useEffect(() => {
    load();
  }, [load]);

  const visible = items.filter((i) => categoryId === null || i.category_id === categoryId);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });

  const open = (item) => {
    setEditing(item);
    setForm(
      item.id
        ? {
            name: item.name,
            veg: item.veg,
            price: String(item.price),
            sizes: item.sizes.map((s) => ({ label: s.label, price: String(s.price) })),
            customisations: item.customisations.join(', '),
            addons: item.addon_ids.map((id) => items.find((m) => m.id === id)?.code).filter(Boolean).join(', '),
            code: item.code,
          }
        : BLANK
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      // "Goes well with" is typed as codes (BRD01, BRD02) and matched to dishes here.
      const codes = form.addons.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
      const unknown = codes.filter((c) => !items.some((m) => m.code.toUpperCase() === c));
      if (unknown.length) throw new Error(`No dish has the code ${unknown.join(', ')}`);
      const body = {
        category_id: editing.category_id,
        name: form.name,
        veg: form.veg,
        price: Number(form.price),
        sizes: form.sizes.map((s) => ({ label: s.label, price: Number(s.price) })),
        customisations: form.customisations.split(',').map((c) => c.trim()).filter(Boolean),
        addonIds: codes.map((c) => items.find((m) => m.code.toUpperCase() === c).id),
      };
      if (editing.id && isAdmin && form.code.trim().toUpperCase() !== editing.code) body.code = form.code;
      const { item } = editing.id
        ? await api(`/menu/items/${editing.id}`, { method: 'PATCH', body })
        : await api('/menu/items', { method: 'POST', body });
      toast(editing.id ? `${item.name} saved` : `${item.name} added as ${item.code}`, { tone: 'success' });
      setEditing(null);
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const setAvailable = async (item, available) => {
    setToggling(item.id);
    try {
      await api(`/menu/items/${item.id}/availability`, { method: 'PATCH', body: { available } });
      toast(`${item.name} is ${available ? 'available' : 'out of stock'} on every menu`, { icon: available ? 'check-circle-outline' : 'close-circle-outline' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setToggling(null);
    }
  };

  const saveCategory = async () => {
    setBusy(true);
    try {
      const { category } = await api('/menu/categories', { method: 'POST', body: newCategory });
      toast(`${category.name} added (codes start with ${category.prefix})`, { tone: 'success' });
      setNewCategory(null);
      await load();
      setCategoryId(category.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const category = categories.find((c) => c.id === (editing?.category_id ?? categoryId));

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Menu" />}>
      <View style={{ gap: 12 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
          <Chip label={`All ${items.length}`} selected={categoryId === null} onPress={() => setCategoryId(null)} />
          {categories.map((c) => (
            <Chip key={c.id} label={`${c.name} · ${c.prefix}`} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
          ))}
          <Chip label="Add category" icon="plus" onPress={() => setNewCategory({ name: '', prefix: '' })} />
        </ScrollView>

        <Button
          title={categoryId === null ? 'Choose a category to add a dish' : `Add a dish to ${categories.find((c) => c.id === categoryId)?.name}`}
          icon="plus"
          variant="secondary"
          disabled={categoryId === null}
          onPress={() => open({ category_id: categoryId })}
        />

        {status === 'loading' ? (
          [0, 1, 2, 3].map((n) => <Skeleton key={n} height={60} radius={t.radius.control} />)
        ) : status === 'error' ? (
          <View style={{ gap: 12 }}>
            <EmptyState icon="wifi-off" title="Couldn’t load the menu" text={error} />
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : visible.length === 0 ? (
          <EmptyState icon="silverware-fork-knife" title="No dishes here yet" text="Add the first dish to this category." />
        ) : (
          visible.map((item) => (
            <View
              key={item.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 60,
                paddingLeft: 12,
                paddingRight: 8,
                borderRadius: t.radius.control,
                borderWidth: t.borderWidth,
                borderColor: t.c.border,
                backgroundColor: t.c.card,
              }}
            >
              <Pressable
                onPress={() => open(item)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, opacity: pressed ? 0.6 : item.available ? 1 : 0.55 })}
              >
                <VegMark veg={item.veg} />
                <View style={{ flex: 1 }}>
                  <Txt size={15} weight={600}>
                    {item.name}
                  </Txt>
                  <Txt size={13} color="textSecondary" tabular>
                    {item.code} · {item.sizes.length ? item.sizes.map((s) => `${s.label} ${money(s.price)}`).join(' / ') : money(item.price)}
                  </Txt>
                </View>
                <Icon name="pencil-outline" size={18} color="textSecondary" />
              </Pressable>
              <Toggle label={item.available ? 'Available' : 'Out of stock'} value={item.available} disabled={toggling === item.id} onChange={(v) => setAvailable(item, v)} />
            </View>
          ))
        )}
      </View>

      <BottomSheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.code}` : `New dish in ${category?.name ?? ''}`}
        footer={<Button title={editing?.id ? 'Save' : 'Add dish'} loading={busy} disabled={!form.name.trim() || (form.sizes.length === 0 && !(Number(form.price) >= 0 && form.price !== ''))} onPress={save} />}
      >
        {!editing?.id ? (
          <Txt size={13} color="textSecondary">
            The code is made for you: {category?.prefix} plus the next number.
          </Txt>
        ) : null}
        <TextField label="Name" required value={form.name} onChangeText={(name) => set({ name })} autoCapitalize="words" maxLength={80} />
        <Segmented label="Type" options={[{ value: true, label: 'Veg' }, { value: false, label: 'Non-veg' }]} value={form.veg} onChange={(veg) => set({ veg })} />
        {editing?.id && isAdmin ? <TextField label="Code (admin only)" value={form.code} onChangeText={(code) => set({ code })} autoCapitalize="characters" maxLength={12} /> : null}

        <View style={{ gap: 8 }}>
          <Txt size={13} weight={600}>
            Price
          </Txt>
          {form.sizes.length === 0 ? (
            <TextField value={form.price} onChangeText={(v) => set({ price: v.replace(/[^0-9.]/g, '') })} placeholder="One price, e.g. 120" keyboardType="decimal-pad" maxLength={8} />
          ) : (
            form.sizes.map((size, index) => (
              <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextField value={size.label} onChangeText={(label) => set({ sizes: form.sizes.map((s, i) => (i === index ? { ...s, label } : s)) })} placeholder="Size, e.g. Half" autoCapitalize="words" maxLength={20} style={{ flex: 1.2 }} />
                <TextField value={size.price} onChangeText={(v) => set({ sizes: form.sizes.map((s, i) => (i === index ? { ...s, price: v.replace(/[^0-9.]/g, '') } : s)) })} placeholder="Price" keyboardType="decimal-pad" maxLength={8} style={{ flex: 1 }} />
                <Button title="" label="Remove this size" icon="trash-can-outline" variant="secondary" onPress={() => set({ sizes: form.sizes.filter((_, i) => i !== index) })} />
              </View>
            ))
          )}
          <Button title={form.sizes.length ? 'Add another size' : 'Use sizes instead (Half / Full)'} icon="plus" variant="link" onPress={() => set({ sizes: [...form.sizes, { label: form.sizes.length ? '' : 'Half', price: '' }] })} />
        </View>

        <TextField label="Customisation chips (comma separated)" value={form.customisations} onChangeText={(customisations) => set({ customisations })} placeholder="More spicy, Less salt, No onion" autoCapitalize="sentences" maxLength={300} />
        <TextField label="Goes well with (dish codes, comma separated)" value={form.addons} onChangeText={(addons) => set({ addons })} placeholder="BRD01, BRD02" autoCapitalize="characters" maxLength={120} />
      </BottomSheet>

      <BottomSheet
        visible={!!newCategory}
        onClose={() => setNewCategory(null)}
        title="Add a category"
        footer={<Button title="Add category" loading={busy} disabled={!newCategory?.name.trim() || !/^[A-Za-z]{2,5}$/.test(newCategory?.prefix || '')} onPress={saveCategory} />}
      >
        <TextField label="Name" required value={newCategory?.name ?? ''} onChangeText={(name) => setNewCategory((c) => ({ ...c, name }))} placeholder="e.g. Chinese" autoCapitalize="words" maxLength={40} />
        <TextField label="Code prefix (2 to 5 letters)" required value={newCategory?.prefix ?? ''} onChangeText={(prefix) => setNewCategory((c) => ({ ...c, prefix: prefix.replace(/[^A-Za-z]/g, '').toUpperCase() }))} placeholder="e.g. CHN" autoCapitalize="characters" maxLength={5} />
      </BottomSheet>
    </Screen>
  );
}
