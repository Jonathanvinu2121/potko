import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useLive } from '../../../../src/store/live';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { useNow } from '../../../../src/lib/useNow';
import { plural } from '../../../../src/lib/format';
import { areaKind, tableKind } from '../../../../src/lib/floor';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { EmptyState } from '../../../../src/components/EmptyState';
import { SearchField, Tabs } from '../../../../src/components/Lists';
import { Toggle } from '../../../../src/components/Bits';
import { DragList } from '../../../../src/components/DragList';
import { useSwitchConfirm } from '../../../../src/components/SwitchConfirm';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { IconTile } from '../../../../src/components/Picture';
import { ActionSheet, MoreButton } from '../../../../src/components/Forms';
import { FloorPlan, FloorLegend, autoPlace } from '../../../../src/components/FloorPlan';
import { TableFormSheet } from '../../../../src/components/AreaSheet';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

// One dining area: its layout (where the tables stand) and its list of tables, built like a
// category's dishes: search, switch on and off (asked first), drag into order.
// The layout only arranges tables. What is happening at a table is shown, never set, here.
// The area itself is edited from the Dining Areas list (its ⋮), as a category is.
export default function AreaDetail() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const areas = useLive((s) => s.areas);
  const allTables = useLive((s) => s.tables);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [tab, setTab] = useState('layout');
  const [editingLayout, setEditingLayout] = useState(false);
  const [moves, setMoves] = useState([]); // every move made while editing: [{ id, x, y }]
  const [undone, setUndone] = useState([]);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(undefined); // undefined = closed, null = new table, object = edit
  const [menu, setMenu] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const switcher = useSwitchConfirm();

  const area = areas.find((a) => a.id === id);
  // Parts of a split table (T4.1) belong to service, not to the set-up.
  const tables = allTables.filter((x) => x.area_id === id && !x.parent_table_id);
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

  if (!area) {
    return (
      <Screen scroll={false} header={<AppHeader title="Dining Area" back />}>
        {synced ? <EmptyState icon="floor-plan" title="This area is no longer there" text="It may have been deleted from another screen." /> : <ListState loading />}
      </Screen>
    );
  }

  // While editing, the tables are shown where the moves so far have put them.
  const placed = autoPlace(tables).map((table) => {
    const last = [...moves].reverse().find((m) => m.id === table.id);
    return last ? { ...table, pos_x: last.x, pos_y: last.y, unplaced: false } : table;
  });

  const startEdit = () => {
    setMoves([]);
    setUndone([]);
    setEditingLayout(true);
  };
  const tidy = () => {
    // Puts every table back on an even grid, three across.
    const rows = Math.max(3, Math.ceil(tables.length / 3));
    setMoves((list) => [...list, ...tables.map((table, i) => ({ id: table.id, x: 0.18 + (i % 3) * 0.32, y: Math.min(0.94, 0.1 + Math.floor(i / 3) * (0.84 / rows)), batch: list.length }))]);
    setUndone([]);
  };
  const undo = () => {
    if (moves.length === 0) return;
    // A tidy is undone as one step.
    const last = moves[moves.length - 1];
    const group = last.batch === undefined ? [last] : moves.filter((m) => m.batch === last.batch);
    setMoves(moves.slice(0, moves.length - group.length));
    setUndone((u) => [...u, group]);
  };
  const redo = () => {
    if (undone.length === 0) return;
    setMoves((list) => [...list, ...undone[undone.length - 1]]);
    setUndone((u) => u.slice(0, -1));
  };
  const saveLayout = async () => {
    setSaving(true);
    try {
      await api(`/areas/${id}/layout`, { method: 'PUT', body: { positions: placed.map((p) => ({ id: p.id, x: p.pos_x, y: p.pos_y })) } });
      toast('Layout saved', { tone: 'success' });
      setEditingLayout(false);
      setMoves([]);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (table) =>
    api(`/tables/${table.id}`, { method: 'PATCH', body: { active: !table.active } })
      .then(() => toast(`${table.label} is ${table.active ? 'switched off' : 'active again'}`, { tone: 'success' }))
      .catch(fail);
  // Asked first, like every switch in a list. A table in use cannot be switched off.
  const askToggle = (table) => {
    if (table.active && table.status !== 'free') return toast(`${table.label} is in use. Close it first.`, { icon: 'lock-outline', tone: 'error' });
    return switcher.ask({
      name: table.label,
      on: !table.active,
      text: table.active ? `Waiters won't see ${table.label} until it is switched on again.` : `${table.label} shows for the waiters again.`,
      apply: () => toggle(table),
    });
  };
  // Dragged into a new order: saved at once; the floor reloads from the server either way.
  const reorder = (rows) =>
    api(`/areas/${id}/tables/order`, { method: 'PUT', body: { ids: rows.map((x) => x.id) } })
      .catch(fail)
      .finally(() => useLive.getState().syncFloor());
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/tables/${removing.id}`, { method: 'DELETE' });
      toast(`${removing.label} deleted`, { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const kind = areaKind(area.kind);
  const shown = tables
    .filter((x) => (filter === 'active' ? x.active : filter === 'inactive' ? !x.active : true))
    .filter((x) => x.label.toLowerCase().includes(query.trim().toLowerCase()) || tableKind(x.kind).label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Screen
      header={
        <AppHeader
          title={area.name}
          subtitle={[plural(tables.length, 'Table'), area.description, kind.label].filter(Boolean).join(' · ')}
          back
        />
      }
      footer={
        tab === 'layout' && editingLayout ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Cancel" variant="secondary" disabled={saving} onPress={() => { setEditingLayout(false); setMoves([]); }} style={{ flex: 1 }} />
            <Button title="Save Layout" icon="check" loading={saving} onPress={saveLayout} style={{ flex: 1.5 }} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {tab === 'layout' ? <Button title="Edit Layout" icon="pencil-outline" variant="secondary" disabled={tables.length === 0} onPress={startEdit} style={{ flex: 1 }} /> : null}
            <Button title="Add Table" icon="plus" onPress={() => setForm(null)} style={{ flex: 1 }} />
          </View>
        )
      }
    >
      <View style={{ gap: 12 }}>
        {editingLayout ? null : <Tabs underline options={[{ value: 'layout', label: 'Layout' }, { value: 'list', label: 'Table List' }]} value={tab} onChange={setTab} />}

        {tab === 'layout' ? (
          tables.length === 0 ? (
            <EmptyState icon="table-furniture" title="No tables here yet" text={`Add the first table to ${area.name}.`} />
          ) : editingLayout ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Undo" icon="undo" variant="secondary" disabled={moves.length === 0} onPress={undo} style={{ flex: 1 }} />
                <Button title="Redo" icon="redo" variant="secondary" disabled={undone.length === 0} onPress={redo} style={{ flex: 1 }} />
                <Button title="Tidy" icon="view-grid-outline" variant="secondary" onPress={tidy} style={{ flex: 1 }} />
              </View>
              <FloorPlan tables={placed} editable onMove={(tableId, x, y) => { setMoves((list) => [...list, { id: tableId, x, y }]); setUndone([]); }} />
              <Notice icon="gesture-swipe" text="Drag a table to where it stands in the room. Nothing changes for the waiters until you save." />
            </>
          ) : (
            <>
              <FloorPlan tables={tables} now={now} onPress={(table) => setMenu(table)} showAmount={false} />
              <FloorLegend />
              {tables.some((x) => x.pos_x == null) ? <Notice text="Some tables have no place on the layout yet and were lined up for you. Tap Edit Layout to arrange them." /> : null}
            </>
          )
        ) : (
          <>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search table (e.g. T1, VIP, Booth)" />
            <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {FILTERS.map((f) => (
                <Chip key={f.key} label={`${f.label} ${f.key === 'all' ? tables.length : tables.filter((x) => (f.key === 'active' ? x.active : !x.active)).length}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </ScrollView>
            {shown.length === 0 ? (
              <ListState empty icon="table-furniture" title={tables.length ? 'No table matches' : 'No tables here yet'} text={tables.length ? 'Try another name or filter.' : `Add the first table to ${area.name}.`} />
            ) : (
              <DragList
                data={shown}
                keyOf={(x) => x.id}
                disabled={!!query.trim() || filter !== 'all'}
                onReorder={reorder}
                renderRow={(table, handle) => {
                  const tk = tableKind(table.kind);
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 2, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
                      {handle}
                      <Pressable
                        onPress={() => setForm(table)}
                        accessibilityRole="button"
                        accessibilityLabel={`${table.label}, ${plural(table.seats, 'seat')}, ${tk.label}, ${table.active ? 'active' : 'switched off'}. Edit.`}
                        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : table.active ? 1 : 0.55 })}
                      >
                        <IconTile icon={tk.icon} tone={table.kind === 'vip' ? 'warning' : table.kind === 'outdoor' ? 'success' : 'primary'} size={40} />
                        <View style={{ flex: 1 }}>
                          <Txt size={16} weight={700} tabular>
                            {table.label}
                          </Txt>
                          <Txt size={13} color="textSecondary">
                            {plural(table.seats, 'seat')} · {tk.label}
                          </Txt>
                        </View>
                      </Pressable>
                      <Toggle quiet label={table.active ? `${table.label} is on. Switch off` : `${table.label} is off. Switch on`} value={table.active} disabled={switcher.busy} onChange={() => askToggle(table)} />
                      <MoreButton label={`Actions for ${table.label}`} onPress={() => setMenu(table)} />
                    </View>
                  );
                }}
              />
            )}
          </>
        )}
      </View>

      <TableFormSheet visible={form !== undefined} table={form} areaId={id} areas={areas} onClose={() => setForm(undefined)} />
      <ActionSheet
        visible={!!menu}
        title={menu ? `${menu.label} · ${plural(menu.seats, 'seat')}` : ''}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { icon: 'pencil-outline', title: 'Edit Table', subtitle: 'Name, capacity, type, area and shape', onPress: () => setForm(menu) },
          menu.order_id ? { icon: 'receipt-text-outline', title: 'View Order', subtitle: `Order #${menu.order_number}`, onPress: () => router.push(`/orders/${menu.order_id}`) } : null,
          { icon: 'trash-can-outline', title: 'Remove Table', subtitle: menu.status !== 'free' ? 'In use now: close it first' : undefined, disabled: menu.status !== 'free', destructive: true, onPress: () => setRemoving(menu) },
        ] : []}
      />
      <ConfirmSheet
        visible={!!removing}
        title={`Delete ${removing?.label ?? ''}?`}
        text="The table is removed from the floor. Old orders still show that they were served here."
        confirmLabel="Delete Table"
        destructive
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
      {switcher.sheet}
    </Screen>
  );
}
