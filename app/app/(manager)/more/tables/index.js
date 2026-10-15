import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useLive } from '../../../../src/store/live';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { areaKind } from '../../../../src/lib/floor';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { BottomSheet } from '../../../../src/components/BottomSheet';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { SearchField } from '../../../../src/components/Lists';
import { Toggle } from '../../../../src/components/Bits';
import { DragList } from '../../../../src/components/DragList';
import { useSwitchConfirm } from '../../../../src/components/SwitchConfirm';
import { ListState } from '../../../../src/components/Feedback';
import { Picture } from '../../../../src/components/Picture';
import { ActionSheet, MoreButton } from '../../../../src/components/Forms';
import { AreaSheet } from '../../../../src/components/AreaSheet';

// More > Tables: the restaurant's dining areas (Main Hall, Garden, Rooftop), built like the menu's
// categories: search, switch on and off (asked first), drag into order, and open one for its
// layout and its tables. Add an area here; its tables, and where they stand, are inside the area.
// A restaurant that already has several floors sees its areas grouped floor by floor; with one
// floor there is nothing about floors on this screen.
export default function DiningAreas() {
  const t = useTheme();
  const router = useRouter();
  const floors = useLive((s) => s.floors);
  const areas = useLive((s) => s.areas);
  const synced = useLive((s) => s.synced);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(undefined); // area form: undefined = closed, { floorId } = new, area = edit
  const [floorForm, setFloorForm] = useState(null); // { id?, name } while the floor sheet is open
  const [menu, setMenu] = useState(null); // { area } or { floor }
  const [removing, setRemoving] = useState(null); // { area } or { floor }
  const [busy, setBusy] = useState(false);
  const switcher = useSwitchConfirm();
  const manyFloors = floors.length > 1;

  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
  const refresh = () => useLive.getState().syncFloor();
  const words = query.trim().toLowerCase();
  const matches = (area) => !words || area.name.toLowerCase().includes(words);

  const moveFloor = (floor, direction) => api(`/floors/${floor.id}/move`, { method: 'POST', body: { direction } }).then(refresh).catch(fail);
  const toggle = (kind, row) =>
    api(`/${kind}s/${row.id}`, { method: 'PATCH', body: { active: !row.active } })
      .then(() => { toast(`${row.name} is ${row.active ? 'switched off' : 'active again'}`, { tone: 'success' }); return refresh(); })
      .catch(fail);
  // Switching an area or a floor off or on is asked first, like every switch in a list.
  const askToggle = (kind, row) =>
    switcher.ask({
      name: row.name,
      on: !row.active,
      text: row.active ? `Waiters won't see ${row.name} and no new orders can be taken there.` : `${row.name} shows for the waiters again.`,
      apply: () => toggle(kind, row),
    });
  // Dragged into a new order: saved at once; the list reloads from the server either way.
  const reorder = (rows) => api('/areas/order', { method: 'PUT', body: { ids: rows.map((a) => a.id) } }).then(refresh).catch((err) => { fail(err); refresh(); });
  const saveFloor = async () => {
    setBusy(true);
    try {
      if (floorForm.id) await api(`/floors/${floorForm.id}`, { method: 'PATCH', body: { name: floorForm.name } });
      else await api('/floors', { method: 'POST', body: { name: floorForm.name } });
      toast(floorForm.id ? 'Floor renamed' : `${floorForm.name.trim()} added. Add its dining areas next.`, { tone: 'success', duration: 4000 });
      setFloorForm(null);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    const row = removing.area ?? removing.floor;
    try {
      await api(`/${removing.area ? 'areas' : 'floors'}/${row.id}`, { method: 'DELETE' });
      toast(`${row.name} deleted`, { tone: 'success' });
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const areaRow = (area, handle) => {
    const kind = areaKind(area.kind);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 2, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
      {handle}
      <Pressable
        onPress={() => router.push(`/more/tables/${area.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${area.name}, ${plural(area.table_count, 'table')}, ${kind.label}${area.active ? '' : ', switched off'}. Open.`}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : area.active ? 1 : 0.55 })}
      >
        <Picture imageId={area.image_id} icon={kind.icon} size={52} tone={area.kind === 'outdoor' ? 'success' : area.kind === 'private' ? 'warning' : 'primary'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={17} weight={700} numberOfLines={1}>
            {area.name}
          </Txt>
          {area.description ? (
            <Txt size={13} color="textSecondary" numberOfLines={1}>
              {area.description}
            </Txt>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="table-furniture" size={14} color="textSecondary" />
              <Txt size={13} color="textSecondary" tabular>
                {plural(area.table_count, 'table')}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={kind.icon} size={14} color="textSecondary" />
              <Txt size={13} color="textSecondary">
                {kind.label}
              </Txt>
            </View>
          </View>
        </View>
      </Pressable>
        <Toggle quiet label={area.active ? `${area.name} is on. Switch off` : `${area.name} is off. Switch on`} value={area.active} disabled={switcher.busy} onChange={() => askToggle('area', area)} />
        <MoreButton label={`Actions for ${area.name}`} onPress={() => setMenu({ area })} />
      </View>
    );
  };

  const removingRow = removing?.area ?? removing?.floor;
  const floorMenu = menu?.floor;
  const areaMenu = menu?.area;

  return (
    <Screen
      header={<AppHeader title="Tables" subtitle="Dining areas and their tables" back />}
      footer={<Button title="Add Dining Area" icon="plus" disabled={floors.length === 0} onPress={() => setEditing({ floorId: floors[0]?.id })} />}
    >
      <View style={{ gap: manyFloors ? 24 : 12 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search dining area" />

        {!synced ? (
          <ListState loading rowHeight={84} />
        ) : floors.length === 0 ? (
          <ListState loading rowHeight={84} />
        ) : (
          floors.map((floor, index) => {
            const here = areas.filter((a) => a.floor_id === floor.id);
            const shown = here.filter(matches);
            if (words && shown.length === 0) return null;
            return (
              <View key={floor.id} style={{ gap: 12 }}>
                {manyFloors ? (
                <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: floor.active ? 1 : 0.7 }}>
                  <Icon name="layers-outline" size={20} color="textSecondary" />
                  <View style={{ flex: 1 }}>
                    <Txt size={18} weight={700} numberOfLines={1}>
                      {floor.name}
                    </Txt>
                    <Txt size={12} color="textSecondary" tabular>
                      {plural(here.length, 'dining area')} · {plural(here.reduce((n, a) => n + a.table_count, 0), 'table')}
                      {floor.active ? '' : ' · switched off'}
                    </Txt>
                  </View>
                  <MoreButton label={`Actions for ${floor.name}`} onPress={() => setMenu({ floor, index })} />
                </View>
                ) : null}
                {shown.length ? <DragList data={shown} keyOf={(a) => a.id} disabled={!!words} onReorder={reorder} renderRow={areaRow} /> : null}
                {here.length === 0 ? (
                  <Pressable
                    onPress={() => setEditing({ floorId: floor.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a dining area on ${floor.name}`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderStyle: 'dashed', borderColor: t.c.disabled, backgroundColor: pressed ? t.c.pressed : 'transparent' })}
                  >
                    <Icon name="plus" size={18} color="primary" />
                    <Txt size={14} weight={600} color="primary">
                      {manyFloors ? `Add a dining area on ${floor.name}` : 'Add your first dining area'}
                    </Txt>
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}
        {synced && words && !areas.some(matches) ? <ListState empty icon="floor-plan" title="No area matches" text="Try another name." /> : null}
      </View>

      <AreaSheet visible={editing !== undefined} area={editing?.id ? editing : null} floorId={editing?.floorId} onClose={() => setEditing(undefined)} onSaved={refresh} />

      <BottomSheet visible={!!floorForm} onClose={busy ? () => {} : () => setFloorForm(null)} title={floorForm?.id ? 'Rename Floor' : 'Add Floor'} footer={<Button title={floorForm?.id ? 'Save' : 'Add Floor'} disabled={!floorForm?.name?.trim()} loading={busy} onPress={saveFloor} />}>
        <TextField label="Floor Name" required value={floorForm?.name ?? ''} onChangeText={(name) => setFloorForm((f) => ({ ...f, name }))} placeholder="e.g. Ground Floor, First Floor, Rooftop" autoCapitalize="words" maxLength={40} />
      </BottomSheet>

      <ActionSheet
        visible={!!areaMenu}
        title={areaMenu?.name}
        onClose={() => setMenu(null)}
        actions={areaMenu ? [
          { icon: 'pencil-outline', title: 'Edit Dining Area', subtitle: 'Name, type, and which floor it is on', onPress: () => setEditing(areaMenu) },
          { icon: 'trash-can-outline', title: 'Remove Dining Area', destructive: true, onPress: () => setRemoving({ area: areaMenu }) },
        ] : []}
      />
      <ActionSheet
        visible={!!floorMenu}
        title={floorMenu?.name}
        onClose={() => setMenu(null)}
        actions={floorMenu ? [
          { icon: 'plus', title: 'Add Dining Area Here', onPress: () => setEditing({ floorId: floorMenu.id }) },
          { icon: 'pencil-outline', title: 'Rename Floor', onPress: () => setFloorForm({ id: floorMenu.id, name: floorMenu.name }) },
          { icon: 'arrow-up', title: 'Move Up', disabled: menu.index === 0, onPress: () => moveFloor(floorMenu, 'up') },
          { icon: 'arrow-down', title: 'Move Down', disabled: menu.index === floors.length - 1, onPress: () => moveFloor(floorMenu, 'down') },
          { icon: floorMenu.active ? 'eye-off-outline' : 'eye-outline', title: floorMenu.active ? 'Switch Off' : 'Switch On', subtitle: floorMenu.active ? 'Hides the floor from the waiters and the Tables screen' : undefined, onPress: () => askToggle('floor', floorMenu) },
          { icon: 'trash-can-outline', title: 'Delete Floor', destructive: true, onPress: () => setRemoving({ floor: floorMenu }) },
        ] : []}
      />
      <ConfirmSheet
        visible={!!removing}
        title={`Delete ${removingRow?.name ?? ''}?`}
        text={
          removing?.floor
            ? removing.floor.area_count
              ? `It still has ${plural(removing.floor.area_count, 'dining area')}. Move them to another floor or delete them first.`
              : 'The floor is removed. Old orders still show where they were served.'
            : removingRow?.table_count
              ? `It still has ${plural(removingRow.table_count, 'table')}. Move them to another area or delete them first.`
              : 'The area is removed from the floor. Old orders still show where they were served.'
        }
        confirmLabel={removing?.floor ? 'Delete Floor' : 'Delete Area'}
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      {switcher.sheet}
    </Screen>
  );
}
