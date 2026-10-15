import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { useLive } from '../store/live';
import { Chip } from './Chip';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { ActionSheet } from './Forms';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Check } from './Lists';

// Which floor and dining area a screen is looking at. A restaurant has floors (Ground Floor,
// First Floor) and each floor has dining areas (Main Hall, Garden).
//   areas     the areas this person may see (already filtered)
//   allowAll  list screens: "All floors" and "All areas" are choices too, and the default
// Returns the choice, the areas it covers, and the props for <AreaPicker />.
export function useAreaChoice(areas, { allowAll = false } = {}) {
  const allFloors = useLive((s) => s.floors);
  const [choice, setChoice] = useState({ floorId: null, areaId: null });
  const floors = allFloors.filter((f) => f.active !== false && areas.some((a) => a.floor_id === f.id));
  const picked = floors.find((f) => f.id === choice.floorId) ?? null;
  const floor = picked ?? (allowAll ? null : floors[0] ?? null);
  const inFloor = floor ? areas.filter((a) => a.floor_id === floor.id) : areas;
  const area = inFloor.find((a) => a.id === choice.areaId) ?? (allowAll ? null : inFloor[0] ?? null);
  return {
    floor,
    area,
    // Every area the choice covers: one area, a whole floor, or everything.
    areaIds: area ? [area.id] : inFloor.map((a) => a.id),
    picker: { floors, areas: inFloor, floor, area, allowAll, onChange: setChoice },
  };
}

// List screens: any mix of dining areas, ticked in a list (AreaMultiSelect). Every area is ticked
// at first, and at least one always stays ticked.
//   areas  the areas this person may see (already filtered)
// Returns whether every area is in view, the ids in view, and the props for <AreaMultiSelect />.
export function useAreasChoice(areas) {
  const [ticked, setTicked] = useState(null); // area ids; null = every area
  const ids = areas.map((a) => a.id);
  const kept = ticked ? ticked.filter((id) => ids.includes(id)) : [];
  const areaIds = kept.length ? kept : ids;
  const all = areaIds.length === ids.length;
  return { all, areaIds, picker: { areas, areaIds, onChange: setTicked } };
}

// True when the restaurant has more than one floor. With one floor, screens name only the dining area.
export const useManyFloors = () => useLive((s) => s.floors.filter((f) => f.active !== false).length > 1);

// The dropdown row both pickers open from: what is in view, and a chevron.
function SelectRow({ name, onPress }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Dining area: ${name}. Change`}
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
      <Icon name="floor-plan" size={20} color="textSecondary" />
      <Txt size={15} weight={600} numberOfLines={1} style={{ flex: 1 }}>
        {name}
      </Txt>
      <Icon name="chevron-down" size={20} color="textSecondary" />
    </Pressable>
  );
}

// "Ground Floor · Main Hall" when there are several floors, else "Main Hall".
const areaName = (a, floors) => (floors.length > 1 ? `${floors.find((f) => f.id === a.floor_id)?.name ?? ''} · ${a.name}` : a.name);

// The design's dropdown for a floor view: one dining area at a time, chosen from a list.
// Takes the same props as AreaPicker.
export function AreaSelect({ floors, areas, floor, area, onChange, count }) {
  const [open, setOpen] = useState(false);
  const everyArea = floors.length > 1 ? useLive.getState().areas.filter((a) => floors.some((f) => f.id === a.floor_id)) : areas;
  const name = area ? (floors.length > 1 && floor ? `${floor.name} · ${area.name}` : area.name) : 'All Dining Areas';
  return (
    <>
      <SelectRow name={name} onPress={() => setOpen(true)} />
      <ActionSheet
        visible={open}
        title="Dining Area"
        onClose={() => setOpen(false)}
        actions={[
          ...everyArea.map((a) => ({
            icon: area?.id === a.id ? 'check' : 'floor-plan',
            title: areaName(a, floors),
            subtitle: count?.(a) ?? undefined,
            onPress: () => onChange({ floorId: a.floor_id, areaId: a.id }),
          })),
        ]}
      />
    </>
  );
}

// The same dropdown for a list: any mix of dining areas, ticked ("All Dining Areas" ticks every
// one). Ticks apply at once; at least one area always stays ticked. Props from useAreasChoice.
export function AreaMultiSelect({ areas, areaIds, onChange }) {
  const [open, setOpen] = useState(false);
  const floors = useLive((s) => s.floors).filter((f) => f.active !== false && areas.some((a) => a.floor_id === f.id));
  const all = areaIds.length === areas.length;
  const ticked = areas.filter((a) => areaIds.includes(a.id));
  const name = all ? 'All Dining Areas' : ticked.length <= 2 ? ticked.map((a) => a.name).join(' + ') : `${ticked.length} dining areas`;
  const tick = (id, on) => onChange(on ? [...areaIds, id] : areaIds.filter((x) => x !== id));
  return (
    <>
      <SelectRow name={name} onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Dining Area" footer={<Button title="Done" onPress={() => setOpen(false)} />}>
        <View>
          <Check label="All Dining Areas" checked={all} onChange={() => onChange(areas.map((a) => a.id))} />
          {areas.map((a) => {
            const on = areaIds.includes(a.id);
            return <Check key={a.id} label={areaName(a, floors)} checked={on} disabled={on && areaIds.length === 1} onChange={(v) => tick(a.id, v)} />;
          })}
        </View>
      </BottomSheet>
    </>
  );
}

// Two rows of chips: floors, then the dining areas of the chosen floor. A row with nothing to
// choose (one floor, one area) is left out.
//   count(area)  a short note on each area chip, e.g. "7 free"
//   floorCount(floor)  the same for a floor
export function AreaPicker({ floors, areas, floor, area, allowAll, onChange, count, floorCount }) {
  const showFloors = floors.length > 1;
  const showAreas = areas.length > 1 || (allowAll && areas.length > 0 && (floor || floors.length <= 1));
  if (!showFloors && !showAreas) return null;
  const label = (name, note) => (note === undefined || note === null ? name : `${name} · ${note}`);
  return (
    <View style={{ gap: 8 }}>
      {showFloors ? (
        <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} accessibilityLabel="Floor" contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {allowAll ? <Chip label="All floors" icon="layers-outline" selected={!floor} onPress={() => onChange({ floorId: null, areaId: null })} /> : null}
          {floors.map((f) => (
            <Chip key={f.id} label={label(f.name, floorCount?.(f))} icon="layers-outline" selected={floor?.id === f.id} onPress={() => onChange({ floorId: f.id, areaId: null })} />
          ))}
        </ScrollView>
      ) : null}
      {showAreas ? (
        <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} accessibilityLabel="Dining area" contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {allowAll ? <Chip label="All areas" icon="floor-plan" selected={!area} onPress={() => onChange({ floorId: floor?.id ?? null, areaId: null })} /> : null}
          {areas.map((a) => (
            <Chip key={a.id} label={label(a.name, count?.(a))} icon="floor-plan" selected={area?.id === a.id} onPress={() => onChange({ floorId: floor?.id ?? a.floor_id, areaId: a.id })} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
