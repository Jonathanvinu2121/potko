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
import { tableName } from '../../../src/lib/format';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Chip } from '../../../src/components/Chip';
import { EmptyState } from '../../../src/components/EmptyState';
import { Skeleton } from '../../../src/components/Skeleton';
import { TableCard } from '../../../src/components/TableCard';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'free', label: 'Free' },
];

// W2 Tables: every table in the restaurant, live. Tap a free one to make it yours.
export default function Tables() {
  const t = useTheme();
  const router = useRouter();
  const userId = useAuth((s) => s.user?.id);
  const tables = useLive((s) => s.tables);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null); // the table being locked right now
  const [shakes, setShakes] = useState({}); // table id -> counter, bumped to shake that card
  const [width, setWidth] = useState(0);

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

  const isMine = (table) => table.locked_by === userId;
  const counts = {
    all: tables.length,
    mine: tables.filter(isMine).length,
    free: tables.filter((x) => x.status === 'free').length,
    occupied: tables.filter((x) => x.status !== 'free').length,
    ready: tables.filter((x) => x.status === 'ready').length,
  };
  const visible = tables.filter((x) => (filter === 'mine' ? isMine(x) : filter === 'free' ? x.status === 'free' : true));

  const refuse = (table, message) => {
    setShakes((s) => ({ ...s, [table.id]: (s[table.id] || 0) + 1 }));
    toast(message, { icon: 'lock-outline', tone: 'error' });
  };

  const tap = async (table) => {
    const name = tableName(table.label);
    if (table.locked_by && !isMine(table)) return refuse(table, `Taken by ${table.locked_by_name}`);
    // My table with an order already in the kitchen: open that order.
    if (table.order_id) return router.push(`/given-orders/${table.order_id}`);

    setBusyId(table.id);
    try {
      const locked = await send('table.lock', { tableId: table.id });
      const draft = useDraft.getState();
      const resuming = draft.type === 'dine_in' && draft.table?.id === locked.id && draft.lines.length > 0;
      if (!resuming) draft.start('dine_in', { table: { id: locked.id, label: locked.label } });
      toast(resuming ? `Back to ${name}` : `${name} is yours`, { tone: 'success' });
      router.push('/new-order/menu');
    } catch (err) {
      if (err.code === 'taken') refuse(table, err.message); // someone else got there first
      else toast(err.message, { icon: 'alert-circle-outline', tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  // Columns follow the layout density on a phone and grow with the screen on tablets and desktops.
  const gap = t.d.gap;
  const columns = width >= breakpoints.tablet ? Math.max(t.d.columns, Math.floor(width / 170)) : t.d.columns;
  const cardWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Tables" back />}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={`${counts.free} Free`} tone="success" />
          <Chip label={`${counts.occupied} Occupied`} tone="primary" />
          <Chip label={`${counts.ready} Ready`} tone="warning" />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={`${f.label} ${counts[f.key]}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>

        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {!synced
            ? [0, 1, 2, 3, 4, 5].map((n) => <Skeleton key={n} height={112} width={cardWidth || '30%'} radius={t.radius.card} />)
            : visible.map((table) => (
                <View key={table.id} style={{ width: cardWidth }}>
                  <TableCard
                    table={table}
                    mine={isMine(table)}
                    busy={busyId === table.id}
                    now={now}
                    shakeKey={shakes[table.id]}
                    onPress={() => tap(table)}
                  />
                </View>
              ))}
        </View>

        {synced && visible.length === 0 ? (
          <EmptyState
            icon="table-furniture"
            title={filter === 'mine' ? 'No tables are yours yet' : filter === 'free' ? 'No free tables' : 'No tables set up'}
            text={filter === 'all' ? 'Ask your manager to add tables.' : 'Choose another filter to see the rest.'}
          />
        ) : null}
      </View>
    </Screen>
  );
}
