import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { usePrices } from '../lib/prices';
import { useMenu, defaultSize, priceFor } from '../store/menu';
import { useDraft } from '../store/draft';
import { money } from '../lib/format';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Chip } from './Chip';
import { Button } from './Button';
import { Stepper } from './Stepper';
import { TextField } from './TextField';
import { VegMark } from './VegMark';

// What a new order line looks like for a menu item. `addons` are the paid extras picked from the
// dish's add-on groups: [{ group, name, price }]; their prices are part of the unit price.
// An open-price dish has no menu price: openPrice is the price typed in for it.
export const lineFor = (item, { size = defaultSize(item), qty = 1, addons = [], openPrice } = {}) => ({
  itemId: item.id,
  name: item.name,
  code: item.code,
  veg: item.veg,
  size,
  qty,
  unitPrice: (item.open_price ? Number(openPrice) || 0 : priceFor(item, size)) + addons.reduce((sum, a) => sum + (Number(a.price) || 0), 0),
  openPrice: item.open_price ? Number(openPrice) || 0 : undefined,
  customisations: [],
  addons,
  note: '',
  allergyNote: '',
});

// How many options a group needs at least, and allows at most.
const groupMin = (group) => Math.max(Number(group.min) || 0, group.required ? 1 : 0);
const groupMax = (group) => (Number(group.max) > 0 ? Number(group.max) : (group.options || []).length);
// True when the dish can be added with one tap: no add-on group insists on a choice.
export const quickAddable = (item) => !item.open_price && (item.modifier_groups || []).every((g) => groupMin(g) === 0);

// Offered on every dish on top of its own chips: pack this one to take away.
const EXTRA_CHIPS = ['Parcel'];

// W5 Item sheet: size, quantity, customisation chips, note, allergy and "goes well with" add-ons.
//   item      the menu item to show (null keeps the sheet closed)
//   line      the order line being edited; leave out when adding a new dish
//   onSubmit  given when editing a dish already sent to the kitchen: receives the choices and
//             saves them on the server. Without it the sheet works on the unsent draft.
// Closing by scrim or swipe changes nothing. onDone(message) runs after Add / Update.
export function ItemSheet({ item, line, onClose, onDone, onSubmit }) {
  const t = useTheme();
  const prices = usePrices();
  const menuItems = useMenu((s) => s.items);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [customisations, setCustomisations] = useState([]);
  const [note, setNote] = useState('');
  const [allergyNote, setAllergyNote] = useState('');
  const [addedAddons, setAddedAddons] = useState([]);
  const [picked, setPicked] = useState([]); // paid add-ons: [{ group, name, price }]
  const [typed, setTyped] = useState(''); // the price of an open-price dish

  // Fill the sheet each time it opens: from the line when editing, else the item's defaults.
  useEffect(() => {
    if (!item) return;
    setSize(line?.size ?? defaultSize(item));
    setQty(line?.qty ?? 1);
    setCustomisations(line?.customisations ?? []);
    setNote(line?.note ?? '');
    setAllergyNote(line?.allergyNote ?? '');
    setAddedAddons([]);
    setPicked(line?.addons ?? []);
    setTyped(line?.openPrice ? String(line.openPrice) : '');
  }, [item, line]);

  if (!item) return null;

  // A dish already sent keeps the add-ons it was sent with: they are shown, not changed, here.
  const groups = onSubmit ? [] : item.modifier_groups || [];
  const extras = picked.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
  const base = item.open_price ? Number(typed) || 0 : priceFor(item, size);
  const unitPrice = base + (onSubmit ? (line?.addonsTotal ?? 0) : extras);
  const needsPrice = item.open_price && !onSubmit && !(Number(typed) > 0);
  const chips = [...item.customisations, ...EXTRA_CHIPS];
  const pickedIn = (group) => picked.filter((a) => a.group === group.name);
  const missing = groups.find((g) => pickedIn(g).length < groupMin(g));
  const pick = (group, option) =>
    setPicked((list) => {
      const mine = list.filter((a) => a.group === group.name);
      if (mine.some((a) => a.name === option.name)) return list.filter((a) => !(a.group === group.name && a.name === option.name));
      const entry = { group: group.name, name: option.name, price: Number(option.price) || 0 };
      const max = groupMax(group);
      // One allowed: tapping another swaps it. More allowed: the choice is simply refused past the limit.
      if (max === 1) return [...list.filter((a) => a.group !== group.name), entry];
      return mine.length >= max ? list : [...list, entry];
    });
  // Add-ons go into the unsent draft, so they are not offered while editing a dish already sent.
  // (A dish that insists on a paid choice of its own cannot be added with one tap, so it is not offered.)
  const addons = onSubmit ? [] : item.addon_ids.map((id) => menuItems.find((m) => m.id === id)).filter((m) => m?.available && quickAddable(m));

  const toggle = (chip) =>
    setCustomisations((list) => (list.includes(chip) ? list.filter((c) => c !== chip) : [...list, chip]));

  const submit = () => {
    // Add-ons are kept in the order the dish lists them, so the same choice always reads the same.
    const addons = groups.flatMap((g) => (g.options || []).filter((o) => pickedIn(g).some((a) => a.name === o.name)).map((o) => ({ group: g.name, name: o.name, price: Number(o.price) || 0 })));
    const chosen = {
      ...lineFor(item, { size, qty, addons, openPrice: typed }),
      // keep the item's own chip order so the kitchen always reads them the same way
      customisations: chips.filter((c) => customisations.includes(c)),
      note: note.trim(),
      allergyNote: allergyNote.trim(),
    };
    if (onSubmit) {
      onSubmit(chosen);
      return onClose();
    }
    if (line) useDraft.getState().updateLine(line.key, chosen);
    else useDraft.getState().addLine(chosen);
    onDone?.(line ? 'Updated' : 'Added');
    onClose();
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={item.name}
      footer={<Button title={needsPrice ? 'Enter the price' : missing ? `Choose ${missing.name}` : prices.withPrice(line ? 'Update' : 'Add to order', unitPrice * qty)} disabled={!!missing || needsPrice} onPress={submit} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <VegMark veg={item.veg} />
          <Txt size={13} weight={600} color="textSecondary" tabular>
            {prices.show ? `${item.code} · ${money(unitPrice)}` : item.code}
          </Txt>
        </View>
        <Stepper value={qty} onChange={setQty} />
      </View>

      {item.open_price && !onSubmit ? (
        <TextField label="Price (₹)" required value={typed} onChangeText={(v) => setTyped(v.replace(/[^0-9.]/g, ''))} placeholder="Open price: type it in" keyboardType="decimal-pad" maxLength={8} />
      ) : null}

      {!item.open_price && item.sizes.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Txt size={13} weight={600}>
            Size
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {item.sizes.map((s) => (
              <Chip key={s.label} label={prices.withPrice(s.label, s.price)} selected={s.label === size} onPress={() => setSize(s.label)} />
            ))}
          </View>
        </View>
      ) : null}

      {groups.map((group) => {
        const min = groupMin(group);
        const max = groupMax(group);
        const mine = pickedIn(group);
        return (
          <View key={group.name} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <Txt size={13} weight={600}>
                {group.name}
                {min > 0 ? ' *' : ''}
              </Txt>
              <Txt size={12} color={mine.length < min ? 'error' : 'textSecondary'}>
                {min > 0 && max === 1 ? 'Choose one' : min > 0 ? `Choose ${min === max ? min : `${min} to ${max}`}` : max === 1 ? 'Optional, one' : `Optional, up to ${max}`}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(group.options || []).map((option) => (
                <Chip key={option.name} label={Number(option.price) > 0 && prices.show ? `${option.name} · +${money(option.price)}` : option.name} selected={mine.some((a) => a.name === option.name)} onPress={() => pick(group, option)} />
              ))}
            </View>
          </View>
        );
      })}
      {onSubmit && line?.addons?.length ? (
        <Txt size={13} color="textSecondary">
          Add-ons sent with this dish: {line.addons.map((a) => a.name).join(', ')}. To change them, remove the dish and add it again.
        </Txt>
      ) : null}

      <View style={{ gap: 8 }}>
        <Txt size={13} weight={600}>
          Customisation
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((c) => (
            <Chip key={c} label={c} icon={c === 'Parcel' ? 'package-variant-closed' : undefined} selected={customisations.includes(c)} onPress={() => toggle(c)} />
          ))}
        </View>
      </View>

      <TextField value={note} onChangeText={setNote} placeholder="Add a note for the kitchen" autoCapitalize="sentences" maxLength={200} />
      <TextField
        value={allergyNote}
        onChangeText={setAllergyNote}
        placeholder="Allergy, if any (shown in red to the chef)"
        autoCapitalize="sentences"
        maxLength={120}
      />

      {addons.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Txt size={15} weight={700}>
            Goes well with
          </Txt>
          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {addons.map((addon) => {
              const added = addedAddons.includes(addon.id);
              return (
                <View
                  key={addon.id}
                  style={{ width: 150, gap: 6, padding: 10, borderRadius: t.radius.control, backgroundColor: t.c.background }}
                >
                  <Txt size={13} weight={600} numberOfLines={1}>
                    {addon.name}
                  </Txt>
                  <Txt size={12} color="textSecondary" tabular>
                    {prices.show ? money(addon.price) : ''}
                  </Txt>
                  <Button
                    title={added ? 'Added' : '+ Add'}
                    icon={added ? 'check' : undefined}
                    variant="secondary"
                    disabled={added}
                    onPress={() => {
                      useDraft.getState().addLine(lineFor(addon));
                      setAddedAddons((ids) => [...ids, addon.id]);
                    }}
                  />
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </BottomSheet>
  );
}
