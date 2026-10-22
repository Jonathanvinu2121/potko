import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { useMenuAdmin } from '../../../../src/store/menu';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Button } from '../../../../src/components/Button';
import { StepChips } from '../../../../src/components/StepChips';
import { TextField } from '../../../../src/components/TextField';
import { Check, RadioCard, SearchField } from '../../../../src/components/Lists';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { PictureField } from '../../../../src/components/PictureField';
import { Choices, SwitchRow, NumberRow } from '../../../../src/components/Forms';
import { DragList } from '../../../../src/components/DragList';

const onlyNumber = (text) => text.replace(/[^0-9.]/g, '');
const STEPS = [
  { value: 'price', label: 'Pricing & Tax' },
  { value: 'portions', label: 'Portions' },
  { value: 'addons', label: 'Add-ons' },
  { value: 'pairs', label: 'Goes Well With' },
  { value: 'terminals', label: 'Terminals' },
];
// The same rule as the server and the menu file.
const CODE = /^[A-Z0-9_-]{1,12}$/;
const ADDONS = 'Add-ons';

// The add-ons are one simple list (the design). Older dishes may have had several groups: the
// first is edited here, the others are kept as they were.
const splitGroups = (groups = []) => ({ main: groups[0] ?? null, rest: groups.slice(1) });

// Rows of name + price that can be dragged into order and removed: portions and add-ons.
function PricedList({ rows, onChange, addLabel, namePlaceholder, max }) {
  const t = useTheme();
  const set = (key, changes) => onChange(rows.map((r) => (r.key === key ? { ...r, ...changes } : r)));
  return (
    <View style={{ gap: 8 }}>
      <DragList
        data={rows}
        keyOf={(r) => r.key}
        onReorder={onChange}
        renderRow={(row, handle) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 4, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
            {handle}
            <TextField value={row.name} onChangeText={(name) => set(row.key, { name })} placeholder={namePlaceholder} autoCapitalize="words" maxLength={30} style={{ flex: 1.4 }} />
            <TextField value={row.price} onChangeText={(price) => set(row.key, { price: onlyNumber(price) })} placeholder="₹ 0" keyboardType="decimal-pad" maxLength={8} style={{ flex: 1 }} />
            <Pressable onPress={() => onChange(rows.filter((r) => r.key !== row.key))} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${row.name || 'this row'}`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash-can-outline" color="error" />
            </Pressable>
          </View>
        )}
      />
      <Button title={addLabel} icon="plus" variant="secondary" disabled={rows.length >= max} onPress={() => onChange([...rows, { key: `n${Date.now()}`, name: '', price: '' }])} />
    </View>
  );
}

// Add or edit a dish, in the steps of the "finals" design:
//   Details        picture, name, Item ID, description, category, display order, on/off
//   Pricing & Tax  base price, open price, the restaurant's tax or the dish's own
//   Portions       Regular / Large / XL with their prices (dragged into order)
//   Add-ons        one list of extras with their prices
//   Goes Well With other dishes the waiter is offered with this one (as in the menu file)
//   Terminals      the kitchens that show the dish; usually one, several is allowed
// Importing dishes from a file is chosen before this form opens ("+ Add" in a category asks).
// Opened with ?id= to edit a dish, or ?category= to add one to that category (the category is then
// not asked again). The row of step names is on every step, as in the staff form: when editing any
// step can be opened, when adding the steps already done.
export default function ItemForm() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const itemId = params.id ? Number(params.id) : null;
  const tax = useAuth((s) => s.restaurant?.settings?.tax) ?? { rate: 5, mode: 'exclusive' };
  const terminals = useLive((s) => s.terminals).filter((k) => k.active !== false);
  const { categories, items, status, error, load } = useMenuAdmin();
  const isAdmin = useCan('staff.admin');
  const [pairQuery, setPairQuery] = useState('');
  const [step, setStep] = useState('details');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  const item = itemId ? items.find((i) => i.id === itemId) : null;
  useEffect(() => {
    if (form || status !== 'ready') return;
    if (itemId && !item) return;
    const category = item?.category_id ?? (Number(params.category) || categories[0]?.id);
    const inCategory = items.filter((i) => i.category_id === category);
    const { main, rest } = splitGroups(item?.modifier_groups);
    let n = 0;
    const keyed = (list) => list.map((r) => ({ key: `k${(n += 1)}`, name: r.name ?? r.label, price: r.price === undefined || r.price === null ? '' : String(r.price) }));
    setForm({
      name: item?.name ?? '',
      code: item?.code ?? '',
      addonIds: item?.addon_ids ?? [],
      description: item?.description ?? '',
      category_id: category,
      position: item ? inCategory.findIndex((i) => i.id === item.id) + 1 : inCategory.length + 1,
      available: item?.available ?? true,
      veg: item?.veg ?? true,
      image_id: item?.image_id ?? null,
      price: item && !item.open_price ? String(item.price) : '',
      open_price: item?.open_price ?? false,
      ownTax: item ? item.tax_rate !== null || item.tax_mode !== null : false,
      tax_rate: String(item?.tax_rate ?? tax.rate),
      inclusive: (item?.tax_mode ?? tax.mode) === 'inclusive',
      portions: keyed(item?.sizes ?? []),
      addonName: main?.name ?? ADDONS,
      addons: keyed(main?.options ?? []),
      otherGroups: rest,
      terminal_ids: item?.terminal_ids ?? [],
    });
  }, [status, item]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) {
    return (
      <Screen header={<AppHeader title={itemId ? 'Edit Item' : 'Add Item'} back />}>
        <ListState loading={status !== 'error' && !(status === 'ready' && itemId && !item)} error={status === 'error' ? error : null} onRetry={load} empty={status === 'ready' && itemId && !item} icon="food-outline" title="This item is no longer on the menu" />
      </Screen>
    );
  }

  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  const portions = form.portions.filter((p) => p.name.trim() || p.price);
  const addons = form.addons.filter((a) => a.name.trim() || a.price);
  const portionsOk = portions.every((p) => p.name.trim() && p.price !== '' && Number(p.price) >= 0);
  const priceOk = form.open_price || portions.length > 0 || (form.price !== '' && Number(form.price) >= 0);
  const rateOk = !form.ownTax || (form.tax_rate !== '' && Number(form.tax_rate) >= 0 && Number(form.tax_rate) <= 100);
  const addonsOk = addons.every((a) => a.name.trim());
  const inCategory = items.filter((i) => i.category_id === form.category_id && i.id !== itemId).length + 1;

  // What still needs doing, and on which step.
  // A new dish may be given its Item ID; afterwards only an admin changes it (other files point at it).
  const code = form.code.trim().toUpperCase();
  const codeEditable = !item || isAdmin;
  const problem = !form.name.trim()
    ? ['details', 'Enter the item name.']
    : code && codeEditable && !CODE.test(code)
      ? ['details', 'An Item ID is 1 to 12 letters, digits, hyphens or underscores.']
    : !form.category_id
      ? ['details', 'Choose a category.']
      : !priceOk
        ? ['price', 'Enter the base price, or tick Open Price.']
        : !rateOk
          ? ['price', 'Enter a tax rate from 0 to 100.']
          : !portionsOk
            ? ['portions', 'Every portion needs a name and a price.']
            : !addonsOk
              ? ['addons', 'Every add-on needs a name.']
              : null;

  const save = async () => {
    if (problem) {
      setStep(problem[0]);
      return toast(problem[1], { icon: 'alert-circle-outline', tone: 'error' });
    }
    setBusy(true);
    try {
      const groups = addons.length ? [{ name: form.addonName || ADDONS, required: false, min: 0, max: 0, options: addons.map((a) => ({ name: a.name.trim(), price: Number(a.price) || 0 })) }] : [];
      const body = {
        name: form.name,
        description: form.description,
        category_id: form.category_id,
        position: form.position,
        veg: form.veg,
        available: form.available,
        image_id: form.image_id,
        open_price: form.open_price,
        sizes: form.open_price ? [] : portions.map((p) => ({ label: p.name.trim(), price: Number(p.price) })),
        price: form.open_price ? 0 : Number(form.price) || (portions.length ? Number(portions[portions.length - 1].price) : 0),
        tax_rate: form.ownTax ? Number(form.tax_rate) : null,
        tax_mode: form.ownTax ? (form.inclusive ? 'inclusive' : 'exclusive') : null,
        modifier_groups: [...groups, ...form.otherGroups],
        terminal_ids: form.terminal_ids,
        addonIds: form.addonIds,
        ...(code && codeEditable && code !== item?.code ? { code } : {}),
      };
      if (!item) body.customisations = [];
      const result = item ? await api(`/menu/items/${item.id}`, { method: 'PATCH', body }) : await api('/menu/items', { method: 'POST', body });
      toast(item ? `${result.item.name} saved` : `${result.item.name} added`, { tone: 'success' });
      await load();
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const order = ['details', ...STEPS.map((s) => s.value)];
  const at = order.indexOf(step);
  const last = at === order.length - 1;
  const back = () => (at === 0 ? router.back() : setStep(order[at - 1]));
  const next = () => (last ? save() : setStep(order[at + 1]));
  const allTicked = terminals.length > 0 && terminals.every((k) => form.terminal_ids.includes(k.id));
  const tick = (id, on) => set({ terminal_ids: on ? [...form.terminal_ids, id] : form.terminal_ids.filter((x) => x !== id) });
  const defaultTerminal = terminals.find((k) => k.is_default);
  // Adding from inside a category: that category is the dish's, so it is not asked.
  const fromCategory = !item && params.category ? categories.find((c) => c.id === Number(params.category)) : null;

  return (
    <Screen
      header={<AppHeader title={item ? 'Edit Item' : 'Add Item'} subtitle={item ? item.name : fromCategory ? `Adding to ${fromCategory.name}` : undefined} back />}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title={at === 0 ? 'Cancel' : 'Back'} variant="secondary" disabled={busy} onPress={back} style={{ flex: 1 }} />
          <Button title={last ? 'Save Item' : 'Next'} loading={busy && last} onPress={next} style={{ flex: 1.5 }} />
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        <StepChips steps={[{ value: 'details', label: 'Details' }, ...STEPS]} value={step} onChange={setStep} canOpen={(value, n) => !!item || n < at} />

        {step === 'details' ? (
          <>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Icon name="food-variant" size={36} color="primary" />
              <Txt size={17} weight={700}>
                {item ? 'Item Details' : 'Add Item Manually'}
              </Txt>
              <Txt size={13} color="textSecondary">
                Enter item details one by one
              </Txt>
            </View>
            <PictureField imageId={form.image_id} onChange={(image_id) => set({ image_id })} icon="food-outline" label="Add Image (Optional)" hint="Tap to upload or select image. JPG or PNG." />
            <TextField label="Item Name" required value={form.name} onChangeText={(name) => set({ name })} placeholder="e.g. Classic Burger" autoCapitalize="words" maxLength={80} />
            <View style={{ gap: 4 }}>
              <TextField label="Item ID" value={form.code} onChangeText={(value) => set({ code: value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="e.g. ITM-001 (made for you if empty)" autoCapitalize="characters" maxLength={12} editable={codeEditable} />
              <Txt size={12} color="textSecondary">
                {codeEditable ? 'Used in the menu file and in Goes Well With. 1 to 12 letters, digits, hyphens or underscores.' : 'Only an admin can change an Item ID.'}
              </Txt>
            </View>
            <TextField label="Description (Optional)" value={form.description} onChangeText={(description) => set({ description })} placeholder="e.g. Juicy grilled patty with fresh veggies" autoCapitalize="sentences" maxLength={200} />
            {fromCategory ? null : <Choices label="Category" required options={categories.map((c) => ({ value: c.id, label: c.name }))} value={form.category_id} onChange={(category_id) => set({ category_id, position: items.filter((i) => i.category_id === category_id && i.id !== itemId).length + 1 })} />}
            <Choices label="Type" options={[{ value: true, label: 'Veg' }, { value: false, label: 'Non-veg' }]} value={form.veg} onChange={(veg) => set({ veg })} />
            <NumberRow label="Display Order" value={Math.min(form.position, inCategory)} min={1} max={inCategory} onChange={(position) => set({ position })} unit="1 is shown first" />
            <SwitchRow title={form.available ? 'Active' : 'Inactive'} text="Inactive items cannot be ordered" value={form.available} onChange={(available) => set({ available })} />
          </>
        ) : (
          <>
            {step === 'price' ? (
              <>
                <TextField label="Base Price" required={!form.open_price} value={form.price} onChangeText={(price) => set({ price: onlyNumber(price) })} placeholder="₹ 180" keyboardType="decimal-pad" maxLength={8} editable={!form.open_price} />
                {portions.length ? (
                  <Txt size={12} color="textSecondary">
                    This item has portions; their prices are used (see Portions).
                  </Txt>
                ) : null}
                <Check label="Open Price" sub="Price can be entered at the time of ordering" checked={form.open_price} onChange={(open_price) => set({ open_price })} />
                <Txt size={15} weight={700}>
                  Tax Configuration
                </Txt>
                <RadioCard title="Use Restaurant Tax" text={`GST (${tax.rate}%)`} selected={!form.ownTax} onPress={() => set({ ownTax: false })} />
                <RadioCard title="Custom Tax for this Item" text="Set specific tax for this item" selected={form.ownTax} onPress={() => set({ ownTax: true })}>
                  <TextField label="Tax rate (%)" value={form.tax_rate} onChangeText={(tax_rate) => set({ tax_rate: onlyNumber(tax_rate) })} keyboardType="decimal-pad" maxLength={5} error={!rateOk} />
                  <SwitchRow title="Price includes tax" text={form.inclusive ? 'The guest pays the price shown' : 'Tax is added on top of the price'} value={form.inclusive} onChange={(inclusive) => set({ inclusive })} />
                </RadioCard>
              </>
            ) : null}

            {step === 'portions' ? (
              <>
                <Txt size={13} color="textSecondary">
                  Manage different portion sizes and prices.
                </Txt>
                {form.open_price ? <Notice icon="information-outline" text="An open-price item has no portions: the price is entered when it is ordered." /> : null}
                {form.open_price ? null : <PricedList rows={form.portions} onChange={(rows) => set({ portions: rows })} addLabel="Add Portion" namePlaceholder="e.g. Regular" max={6} />}
              </>
            ) : null}

            {step === 'addons' ? (
              <>
                <Txt size={13} color="textSecondary">
                  Optional items that can be added with this item.
                </Txt>
                <PricedList rows={form.addons} onChange={(rows) => set({ addons: rows })} addLabel="Add Add-on" namePlaceholder="e.g. Extra Cheese" max={20} />
                {form.otherGroups.length ? <Notice icon="information-outline" text={`This item also has ${form.otherGroups.length} older add-on group${form.otherGroups.length === 1 ? '' : 's'}. They stay as they are.`} /> : null}
              </>
            ) : null}

            {step === 'pairs' ? (
              <>
                <Txt size={13} color="textSecondary">
                  Dishes the waiter is offered with this one when it is ordered.
                </Txt>
                <SearchField value={pairQuery} onChangeText={setPairQuery} placeholder="Search dishes" />
                <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, paddingHorizontal: 12 }}>
                  {(() => {
                    const words = pairQuery.trim().toLowerCase();
                    const others = items.filter((i) => i.id !== itemId);
                    // The ticked ones first, then the rest in menu order.
                    const list = [...others.filter((i) => form.addonIds.includes(i.id)), ...others.filter((i) => !form.addonIds.includes(i.id))]
                      .filter((i) => !words || i.name.toLowerCase().includes(words) || i.code.toLowerCase().includes(words));
                    if (list.length === 0) {
                      return (
                        <Txt size={13} color="textSecondary" style={{ paddingVertical: 14 }}>
                          {others.length ? 'No dish matches.' : 'Add more dishes to the menu first.'}
                        </Txt>
                      );
                    }
                    return list.map((i) => (
                      <Check
                        key={i.id}
                        label={i.name}
                        sub={[categories.find((c) => c.id === i.category_id)?.name, i.code].filter(Boolean).join(' · ')}
                        checked={form.addonIds.includes(i.id)}
                        onChange={(on) => set({ addonIds: on ? [...form.addonIds, i.id] : form.addonIds.filter((x) => x !== i.id) })}
                      />
                    ));
                  })()}
                </View>
                <Txt size={12} color="textSecondary">
                  {form.addonIds.length ? `${form.addonIds.length} selected.` : 'None selected: nothing is suggested with this dish.'}
                </Txt>
              </>
            ) : null}

            {step === 'terminals' ? (
              <>
                <Txt size={13} color="textSecondary">
                  Select terminals where this item will be visible. Usually one; a ticket for this item shows at every terminal ticked.
                </Txt>
                <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, paddingHorizontal: 12 }}>
                  <Check label="All Terminals" checked={allTicked} onChange={(on) => set({ terminal_ids: on ? terminals.map((k) => k.id) : [] })} />
                  {terminals.map((k) => (
                    <Check key={k.id} label={k.name} checked={form.terminal_ids.includes(k.id)} onChange={(on) => tick(k.id, on)} />
                  ))}
                </View>
                {form.terminal_ids.length === 0 ? (
                  <Txt size={12} color="textSecondary">
                    None ticked: the item is cooked at {defaultTerminal?.name ?? 'the main kitchen'}.
                  </Txt>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
