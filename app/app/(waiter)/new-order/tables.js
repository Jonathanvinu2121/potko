import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme, breakpoints } from '../../../src/theme';
import { useAuth } from '../../../src/store/auth';
import { useLive } from '../../../src/store/live';
import { useDraft } from '../../../src/store/draft';
import { send } from '../../../src/lib/ws';
import { useNow } from '../../../src/lib/useNow';
import { toast } from '../../../src/store/toast';
import { plural, tableName } from '../../../src/lib/format';
import { areaAllowed, tableAllowed } from '../../../src/lib/access';
import { floorUnits, unitTables } from '../../../src/lib/units';
import { seatAt } from '../../../src/lib/seating';
import { TABLES_PATHS } from '../../../src/lib/paths';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Chip } from '../../../src/components/Chip';
import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { Notice } from '../../../src/components/Feedback';
import { TableCard, TableGroupCard } from '../../../src/components/TableCard';
import { TableSheet } from '../../../src/components/TableSheet';
import { AreaPicker, useAreaChoice } from '../../../src/components/AreaPicker';
import { BottomSheet } from '../../../src/components/BottomSheet';
import { Stepper } from '../../../src/components/Stepper';

// The status chips of the design: "8 Free · 6 Occupied · 2 Ready", plus All.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'free', label: 'Free' },
  { key: 'occupied', label: 'Occupied' },
  { key: 'ready', label: 'Ready' },
];
const occupied = (table) => table.status !== 'free';

// W2 Tables: the tables this waiter serves, live, one dining area at a time, each drawn as a
// table with its chairs. Only the waiter's own tables reach this screen (the server sends no others).
//   Tap a table    straight to the menu: a free table asks how many guests, becomes yours and its
//                  order starts; one of your tables with an order gets more dishes added to it.
//   Hold a table   View Order, Split Table, Merge Table, Transfer Table.
// A table that is split shows its parts side by side; each part is tapped and held like a table.
export default function Tables() {
  const t = useTheme();
  const router = useRouter();
  const userId = useAuth((s) => s.user?.id);
  const access = useAuth((s) => s.user?.access);
  const allTables = useLive((s) => s.tables);
  const allAreas = useLive((s) => s.areas);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null); // the table being taken right now
  const [shakes, setShakes] = useState({}); // table id -> counter, bumped to shake that card
  const [sheetId, setSheetId] = useState(null); // the table whose actions are open
  const [joining, setJoining] = useState(null); // ids chosen in "Join tables"; null when not joining
  const [joinBusy, setJoinBusy] = useState(false);
  const [width, setWidth] = useState(0);
  const [seating, setSeating] = useState(null); // { table, guests } while "How many guests?" is open

  // Coming back here with an empty order means the waiter changed their mind: give the table back.
  useFocusEffect(
    useCallback(() => {
      const draft = useDraft.getState();
      if (draft.type === 'dine_in' && draft.table && !draft.addTo && draft.lines.length === 0) {
        draft.releaseTable();
        draft.clear();
      }
    }, [])
  );

  // Only the areas and tables this waiter is assigned (the server refuses the others anyway).
  const areas = allAreas.filter((a) => a.active && areaAllowed(access, a.id));
  const choice = useAreaChoice(areas);
  const area = choice.area;
  const units = floorUnits(allTables).filter((u) => tableAllowed(access, u.table));
  const here = units.filter((u) => !area || u.table.area_id === area.id);
  const tablesHere = here.flatMap(unitTables);

  // Mine: I hold the table, or its order is mine.
  const isMine = (table) => table.locked_by === userId || (!!table.order_id && table.order_waiter_id === userId);
  const isTaken = (table) => (table.order_id ? table.order_waiter_id !== userId : !!table.locked_by && table.locked_by !== userId);
  const counts = {
    all: tablesHere.length,
    free: tablesHere.filter((x) => x.status === 'free').length,
    occupied: tablesHere.filter(occupied).length,
    ready: tablesHere.filter((x) => x.status === 'ready').length,
  };
  const shows = (table) => (filter === 'free' ? table.status === 'free' : filter === 'occupied' ? occupied(table) : filter === 'ready' ? table.status === 'ready' : true);
  const visible = here.filter((u) => unitTables(u).some(shows));
  const sheetTable = sheetId ? allTables.find((x) => x.id === sheetId) : null;
  const freeIn = (list) => list.flatMap(unitTables).filter((x) => x.status === 'free').length;

  const refuse = (table, message) => {
    setShakes((s) => ({ ...s, [table.id]: (s[table.id] || 0) + 1 }));
    toast(message, { icon: 'lock-outline', tone: 'error' });
  };

  // A free table first asks how many guests sit down.
  const askGuests = (table) => setSeating({ table, guests: Math.min(2, table.seats || 2) });
  const seat = async (table, guests = null) => {
    setBusyId(table.id);
    try {
      await seatAt(table, router, guests);
    } catch (err) {
      if (err.code === 'taken') refuse(table, err.message); // someone else got there first
      else toast(err.message, { icon: 'alert-circle-outline', tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  // Why this waiter cannot use a table, or null when they can.
  const blocked = (table) => {
    if (table.order_id) return table.order_waiter_id !== userId ? `Served by ${table.order_waiter_name ?? 'another waiter'}` : null;
    return table.locked_by && table.locked_by !== userId ? `Taken by ${table.locked_by_name}` : null;
  };

  // A tap opens what is at the table: a free table asks how many guests sit down, a busy table
  // opens its order (where more items are added).
  const tap = (table) => {
    const why = blocked(table);
    if (why) return refuse(table, why);
    if (!table.order_id) return askGuests(table);
    return router.push(TABLES_PATHS.order(table.order_id));
  };
  // A long press opens what can be done with the table: split, merge, transfer.
  const hold = (table) => {
    const why = blocked(table);
    if (why) return refuse(table, why);
    return setSheetId(table.id);
  };

  // Join tables: free whole tables of this area are ticked; the party is then seated at all of them.
  const canJoin = (unit) => unit.kind === 'single' && unit.table.status === 'free' && !unit.table.locked_by;
  const toggleJoin = (table) => setJoining((ids) => (ids.includes(table.id) ? ids.filter((id) => id !== table.id) : [...ids, table.id]));
  const seatJoined = async () => {
    setJoinBusy(true);
    try {
      const result = await send('table.merge', { tableIds: joining, seat: true });
      setJoining(null);
      await seatAt(result.table, router);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setJoinBusy(false);
    }
  };
  const joinNames = joining ? joining.map((id) => allTables.find((x) => x.id === id)?.label).filter(Boolean) : [];
  const joinSeats = joining ? joining.reduce((n, id) => n + (allTables.find((x) => x.id === id)?.seats ?? 0), 0) : 0;

  // Columns follow the layout density on a phone and grow with the screen on tablets and desktops.
  const gap = t.d.gap;
  const columns = width >= breakpoints.tablet ? Math.max(t.d.columns, Math.floor(width / 170)) : t.d.columns;
  const cardWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) - 1 : 0;
  const groupWidth = width >= breakpoints.tablet ? Math.floor((width - gap) / 2) - 1 : width;

  const footer = joining ? (
    <View style={{ gap: 8 }}>
      <Txt size={13} color="textSecondary" center>
        {joining.length < 2 ? 'Tap two or more free tables to join them.' : `${joinNames.join(' + ')} · ${plural(joinSeats, 'seat')}`}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Cancel" variant="secondary" disabled={joinBusy} onPress={() => setJoining(null)} style={{ flex: 1 }} />
        <Button title={joining.length < 2 ? 'Seat party' : `Seat at ${joinNames.join(' + ')}`} icon="link-variant" disabled={joining.length < 2} loading={joinBusy} onPress={seatJoined} style={{ flex: 2 }} />
      </View>
    </View>
  ) : null;

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={<AppHeader title={joining ? 'Join tables' : 'Tables'} subtitle={area ? [choice.picker.floors.length > 1 ? choice.floor?.name : null, area.name].filter(Boolean).join(' · ') : undefined} back onBack={joining ? () => setJoining(null) : undefined} />}
      footer={footer}
    >
      <View style={{ gap: 12 }}>
        <AreaPicker {...choice.picker} count={(a) => `${freeIn(units.filter((u) => u.table.area_id === a.id))} free`} />

        {joining ? (
          <Notice tone="primary" icon="link-variant" text="Tap the free tables to push together for one party. They become one table with one order and one bill." />
        ) : (
          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {FILTERS.map((f) => (
              <Chip key={f.key} label={f.key === 'all' ? `All ${counts.all}` : `${f.label} ${counts[f.key]}`} tone={f.key === 'free' ? 'success' : f.key === 'ready' ? 'warning' : f.key === 'occupied' ? 'error' : 'neutral'} selected={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </ScrollView>
        )}
        {joining ? null : (
          <Txt size={12} color="textSecondary">
            Tap a free table to seat guests, or a busy one to open its order. Hold a table to split, merge or transfer it.
          </Txt>
        )}

        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {!synced
            ? [0, 1, 2, 3, 4, 5].map((n) => <Skeleton key={n} height={132} width={cardWidth || '30%'} radius={t.radius.card} />)
            : visible.map((unit) =>
                unit.kind === 'single' ? (
                  <View key={unit.key} style={{ width: cardWidth, opacity: joining && !canJoin(unit) ? 0.4 : 1 }}>
                    <TableCard
                      table={unit.table}
                      mine={isMine(unit.table)}
                      taken={isTaken(unit.table)}
                      busy={busyId === unit.table.id}
                      now={now}
                      shakeKey={shakes[unit.table.id]}
                      selected={joining ? joining.includes(unit.table.id) : undefined}
                      freeText={joining ? 'Tap to choose' : 'Tap to seat'}
                      onPress={() => (joining ? (canJoin(unit) ? toggleJoin(unit.table) : toast('Only free tables can be joined here', { icon: 'information-outline' })) : tap(unit.table))}
                      onLongPress={joining ? undefined : () => hold(unit.table)}
                    />
                  </View>
                ) : (
                  <View key={unit.key} style={{ width: groupWidth || '100%', opacity: joining ? 0.4 : 1 }}>
                    <TableGroupCard
                      unit={unit}
                      now={now}
                      isMine={isMine}
                      isTaken={isTaken}
                      busyId={busyId}
                      shakes={shakes}
                      onPressTable={joining ? undefined : tap}
                      onLongPressTable={joining ? undefined : hold}
                      onChange={joining || unit.kind !== 'split' ? undefined : () => router.push(TABLES_PATHS.split(unit.table.id))}
                    />
                  </View>
                )
              )}
        </View>

        {synced && visible.length === 0 ? (
          <EmptyState
            icon="table-furniture"
            title={filter !== 'all' ? `No ${FILTERS.find((f) => f.key === filter).label.toLowerCase()} tables here` : areas.length === 0 ? 'No tables assigned to you' : 'No tables in this area'}
            text={filter === 'all' ? 'Ask your manager to assign you tables.' : 'Choose another filter to see the rest.'}
          />
        ) : null}
      </View>

      <TableSheet table={sheetTable} onClose={() => setSheetId(null)} paths={TABLES_PATHS} />
      <BottomSheet
        visible={!!seating}
        onClose={() => setSeating(null)}
        title={seating ? `Seat guests at ${tableName(seating.table.label)}` : ''}
        footer={<Button title={seating ? `Seat ${plural(seating.guests, 'guest')}` : 'Seat'} icon="account-group-outline" onPress={() => { const { table, guests } = seating; setSeating(null); seat(table, guests); }} />}
      >
        {seating ? (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Txt size={15} color="textSecondary">
              How many guests are sitting down? {plural(seating.table.seats, 'seat')} at this table.
            </Txt>
            <Stepper value={seating.guests} min={1} max={99} onChange={(guests) => setSeating((s) => ({ ...s, guests }))} />
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
