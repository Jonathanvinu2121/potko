import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
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

// What a new order line looks like for a menu item with nothing chosen yet.
export const lineFor = (item, { size = defaultSize(item), qty = 1 } = {}) => ({
  itemId: item.id,
  name: item.name,
  code: item.code,
  veg: item.veg,
  size,
  qty,
  unitPrice: priceFor(item, size),
  customisations: [],
  note: '',
  allergyNote: '',
});

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
  const menuItems = useMenu((s) => s.items);
  const [size, setSize] = useState(null);
  const [qty, setQty] = useState(1);
  const [customisations, setCustomisations] = useState([]);
  const [note, setNote] = useState('');
  const [allergyNote, setAllergyNote] = useState('');
  const [addedAddons, setAddedAddons] = useState([]);

  // Fill the sheet each time it opens: from the line when editing, else the item's defaults.
  useEffect(() => {
    if (!item) return;
    setSize(line?.size ?? defaultSize(item));
    setQty(line?.qty ?? 1);
    setCustomisations(line?.customisations ?? []);
    setNote(line?.note ?? '');
    setAllergyNote(line?.allergyNote ?? '');
    setAddedAddons([]);
  }, [item, line]);

  if (!item) return null;

  const unitPrice = priceFor(item, size);
  const chips = [...item.customisations, ...EXTRA_CHIPS];
  // Add-ons go into the unsent draft, so they are not offered while editing a dish already sent.
  const addons = onSubmit ? [] : item.addon_ids.map((id) => menuItems.find((m) => m.id === id)).filter((m) => m?.available);

  const toggle = (chip) =>
    setCustomisations((list) => (list.includes(chip) ? list.filter((c) => c !== chip) : [...list, chip]));

  const submit = () => {
    const chosen = {
      ...lineFor(item, { size, qty }),
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
      footer={<Button title={`${line ? 'Update' : 'Add to order'} · ${money(unitPrice * qty)}`} onPress={submit} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <VegMark veg={item.veg} />
          <Txt size={13} weight={600} color="textSecondary" tabular>
            {item.code} · {money(unitPrice)}
          </Txt>
        </View>
        <Stepper value={qty} onChange={setQty} />
      </View>

      {item.sizes.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Txt size={13} weight={600}>
            Size
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {item.sizes.map((s) => (
              <Chip key={s.label} label={`${s.label} · ${money(s.price)}`} selected={s.label === size} onPress={() => setSize(s.label)} />
            ))}
          </View>
        </View>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
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
                    {money(addon.price)}
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
