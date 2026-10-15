import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme, breakpoints } from '../../../src/theme';
import { useLive } from '../../../src/store/live';
import { useCan } from '../../../src/store/auth';
import { useNow, minutesSince } from '../../../src/lib/useNow';
import { money, orderLabel, plural, duration, tableName } from '../../../src/lib/format';
import { onFloor, itemCount, TABLE_STATUS, TYPE_ICON, TYPE_LABEL } from '../../../src/lib/orders';
import { floorUnits, unitTables, groupLabel } from '../../../src/lib/units';
import { tableKind } from '../../../src/lib/floor';
import { MANAGER_PATHS } from '../../../src/lib/paths';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { Tabs, SearchField } from '../../../src/components/Lists';
import { ListState } from '../../../src/components/Feedback';
import { BottomSheet } from '../../../src/components/BottomSheet';
import { TableCard, TableGroupCard } from '../../../src/components/TableCard';
import { TableSheet } from '../../../src/components/TableSheet';
import { FloorPlan } from '../../../src/components/FloorPlan';
import { AreaSelect, AreaMultiSelect, useAreaChoice, useAreasChoice, useManyFloors } from '../../../src/components/AreaPicker';
import { toast } from '../../../src/store/toast';

const VIEWS = [
  { value: 'floor', label: 'Floor View' },
  { value: 'list', label: 'List View' },
];

// The status chips of the design. A table belongs to one state; VIP is a kind of table.
const CHIPS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'free', label: 'Available', test: (x) => x.status === 'free' },
  { key: 'occupied', label: 'Occupied', test: (x) => !['free', 'needs_payment', 'split'].includes(x.status) },
  { key: 'vip', label: 'VIP', test: (x) => x.kind === 'vip' },
  { key: 'bill', label: 'Bill Requested', test: (x) => x.status === 'needs_payment' },
];

// "Occupied · 12 min", "Bill Requested · ₹1,850", "Available".
function statusText(table, now) {
  const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  if (table.status === 'free') return status.label;
  if (table.status === 'needs_payment') return `${status.label} · ${money(table.order_total)}`;
  return table.order_created_at ? `${status.label} · ${duration(minutesSince(table.order_created_at, now))}` : status.label;
}

// M2 Tables (the manager's floor), as in the "finals" design:
//   Floor View  one dining area at a time (the dropdown), its room plan with coloured tables
//   List View   the tables of any mix of dining areas (ticked in the dropdown), searchable, each
//               with its state ("Occupied · 12 min")
// Both are narrowed by the same chips. Tapping a busy table opens its order; holding a table opens
// what can be done with it (Split, Merge, Transfer), as on the waiter's Tables screen. Takeaway and
// delivery orders have no table: they are listed under the tables.
export default function TablesScreen() {
  const t = useTheme();
  const router = useRouter();
  const allAreas = useLive((s) => s.areas);
  const allTables = useLive((s) => s.tables);
  const liveOrders = useLive((s) => s.orders);
  const synced = useLive((s) => s.synced);
  const mayManage = useCan('orders.manage');
  const manyFloors = useManyFloors();
  const now = useNow();
  const [view, setView] = useState('floor');
  const [chip, setChip] = useState('all');
  const [query, setQuery] = useState('');
  const [sheetId, setSheetId] = useState(null); // the table whose actions are open
  const [splitId, setSplitId] = useState(null); // the split table whose parts are open
  const [width, setWidth] = useState(0);

  const areas = allAreas.filter((a) => a.active);
  const floorChoice = useAreaChoice(areas);
  const listChoice = useAreasChoice(areas);
  const units = floorUnits(allTables);
  const test = CHIPS.find((c) => c.key === chip)?.test ?? (() => true);

  const sheetTable = sheetId ? allTables.find((x) => x.id === sheetId) : null;
  const splitUnit = splitId ? units.find((u) => u.kind === 'split' && u.table.id === splitId) : null;
  // A tap opens what is at the table: a split table its parts, a busy table its order. A joined
  // table stands for its whole group.
  const tapTable = (table) => {
    if (table.status === 'split') return setSplitId(table.id);
    setSplitId(null);
    const lead = (table.joined_to_id && allTables.find((x) => x.id === table.joined_to_id)) || table;
    if (lead.order_id) return router.push(MANAGER_PATHS.order(lead.order_id));
    return toast(`${tableName(groupLabel(lead))} is free. Hold it to split or merge it.`, { icon: 'information-outline' });
  };
  // A long press opens what can be done with the table.
  const holdTable = (table) => {
    setSplitId(null);
    setSheetId(table.joined_to_id || table.id);
  };
  const hint = (
    <Txt size={12} color="textSecondary">
      Tap a busy table to open its order. Hold a table to split, merge or transfer it.
    </Txt>
  );

  const header = <AppHeader title="Tables" />;
  const chips = (list) => (
    <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {CHIPS.map((c) => (
        <Chip key={c.key} label={c.key === 'all' ? `All ${list.length}` : c.label} selected={chip === c.key} onPress={() => setChip(c.key)} />
      ))}
    </ScrollView>
  );
  const sheets = (
    <>
      <TableSheet table={sheetTable} onClose={() => setSheetId(null)} paths={MANAGER_PATHS} />
      <BottomSheet visible={!!splitUnit} onClose={() => setSplitId(null)} footer={<Button title="Close" variant="secondary" onPress={() => setSplitId(null)} />}>
        {splitUnit ? (
          <TableGroupCard
            unit={splitUnit}
            now={now}
            showAmount
            freeText="Available"
            onPressTable={tapTable}
            onLongPressTable={holdTable}
            onChange={mayManage ? () => { setSplitId(null); router.push(MANAGER_PATHS.split(splitUnit.table.id)); } : undefined}
          />
        ) : null}
      </BottomSheet>
    </>
  );

  // ---------- Floor View ----------
  if (view === 'floor') {
    const area = floorChoice.area;
    const inArea = area ? units.filter((u) => u.table.area_id === area.id) : [];
    const visible = inArea.filter((u) => unitTables(u).some(test));
    const areaTables = area ? allTables.filter((x) => x.active && x.area_id === area.id) : [];
    const asPlan = areaTables.some((x) => x.pos_x != null) && chip === 'all';
    const columns = width >= breakpoints.tablet ? Math.floor(width / 170) : 3;
    const cardWidth = width ? Math.floor((width - 12 * (columns - 1)) / columns) - 1 : 0;
    const groupWidth = width >= breakpoints.tablet ? Math.floor((width - 12) / 2) - 1 : width;
    return (
      <Screen edges={['top', 'left', 'right']} header={header}>
        <View style={{ gap: 12 }}>
          <Tabs options={VIEWS} value={view} onChange={setView} />
          <AreaSelect {...floorChoice.picker} count={(a) => plural(units.filter((u) => u.table.area_id === a.id).length, 'table')} />
          {chips(inArea.flatMap(unitTables))}
          {hint}

          {!synced ? (
            <ListState loading rows={2} rowHeight={150} />
          ) : !area ? (
            <ListState empty icon="floor-plan" title="No dining areas yet" text="Add your first dining area and its tables under More, Tables." />
          ) : inArea.length === 0 ? (
            <ListState empty icon="table-furniture" title={`No tables in ${area.name}`} text="Add tables to this area under More, Tables." />
          ) : asPlan ? (
            <FloorPlan tables={areaTables} now={now} onPress={tapTable} onLongPress={holdTable} />
          ) : visible.length === 0 ? (
            <ListState empty icon="table-furniture" title="No tables in this state" text="Choose another chip to see the rest." />
          ) : (
            <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {visible.map((unit) =>
                unit.kind === 'single' ? (
                  <View key={unit.key} style={{ width: cardWidth || '31%' }}>
                    <TableCard table={unit.table} now={now} showAmount freeText="Available" onPress={() => tapTable(unit.table)} onLongPress={() => holdTable(unit.table)} />
                  </View>
                ) : (
                  <View key={unit.key} style={{ width: groupWidth || '100%' }}>
                    <TableGroupCard unit={unit} now={now} showAmount freeText="Available" onPressTable={tapTable} onLongPressTable={holdTable} onChange={mayManage && unit.kind === 'split' ? () => router.push(MANAGER_PATHS.split(unit.table.id)) : undefined} />
                  </View>
                )
              )}
            </View>
          )}
        </View>
        {sheets}
      </Screen>
    );
  }

  // ---------- List View ----------
  const areaIds = listChoice.areaIds;
  const narrowed = !listChoice.all;
  const words = query.trim().toLowerCase();
  const listed = allTables
    .filter((x) => x.active && x.status !== 'split' && !x.joined_to_id && (!narrowed || areaIds.includes(x.area_id)))
    .filter((x) => !words || groupLabel(x).toLowerCase().includes(words));
  const rows = listed.filter(test);
  const tableless = narrowed ? [] : liveOrders.filter((o) => onFloor(o) && o.type !== 'dine_in');

  return (
    <Screen edges={['top', 'left', 'right']} header={header}>
      <View style={{ gap: 12 }}>
        <Tabs options={VIEWS} value={view} onChange={setView} />
        <AreaMultiSelect {...listChoice.picker} />
        {chips(listed)}
        <SearchField value={query} onChangeText={setQuery} placeholder="Search table number..." />
        {hint}

        {!synced ? (
          <ListState loading rowHeight={64} />
        ) : rows.length === 0 ? (
          <ListState empty icon="table-furniture" title="No tables here" text={words ? 'Try another table number.' : 'Choose another chip or dining area.'} />
        ) : (
          rows.map((table) => {
            const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
            const seats = table.seats + (table.joined || []).reduce((n, j) => n + j.seats, 0);
            return (
              <Pressable
                key={table.id}
                onPress={() => tapTable(table)}
                onLongPress={() => holdTable(table)}
                accessibilityRole="button"
                accessibilityLabel={`${groupLabel(table)}, ${statusText(table, now)}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 12,
                  minHeight: 64,
                  borderRadius: t.radius.card,
                  borderWidth: t.borderWidth,
                  borderColor: t.c.border,
                  backgroundColor: pressed ? t.c.pressed : t.c.card,
                })}
              >
                <Icon name={tableKind(table.kind).icon} size={22} color="textSecondary" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={16} weight={700} numberOfLines={1}>
                    {groupLabel(table)}
                  </Txt>
                  <Txt size={13} color="textSecondary" numberOfLines={1}>
                    {plural(seats, 'seat')} · {manyFloors && table.floor_name ? `${table.floor_name} · ` : ''}
                    {table.area_name}
                  </Txt>
                </View>
                <Chip label={statusText(table, now)} tone={table.status === 'free' ? 'success' : status.tone} size={12} />
                <Icon name="chevron-right" color="textSecondary" />
              </Pressable>
            );
          })
        )}

        {tableless.length > 0 ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Txt size={15} weight={700}>
              Takeaway and Delivery
            </Txt>
            {tableless.map((order) => (
              <Pressable
                key={order.id}
                onPress={() => router.push(`/orders/${order.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${orderLabel(order)}, order ${order.number}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 12,
                  minHeight: 64,
                  borderRadius: t.radius.card,
                  borderWidth: t.borderWidth,
                  borderColor: t.c.border,
                  backgroundColor: pressed ? t.c.pressed : t.c.card,
                })}
              >
                <Icon name={TYPE_ICON[order.type]} size={22} color="textSecondary" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={16} weight={700} numberOfLines={1}>
                    {orderLabel(order)}
                  </Txt>
                  <Txt size={13} color="textSecondary" numberOfLines={1}>
                    {TYPE_LABEL[order.type]} · #{order.number} · {plural(itemCount(order), 'item')} · {duration(minutesSince(order.created_at, now))}
                  </Txt>
                </View>
                <Txt size={15} weight={700} tabular>
                  {money(order.total)}
                </Txt>
                <Icon name="chevron-right" color="textSecondary" />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {sheets}
    </Screen>
  );
}
