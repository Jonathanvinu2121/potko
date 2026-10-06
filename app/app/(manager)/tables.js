import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme, breakpoints } from '../../src/theme';
import { useLive } from '../../src/store/live';
import { api } from '../../src/lib/api';
import { useNow } from '../../src/lib/useNow';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { BottomSheet } from '../../src/components/BottomSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { TableCard } from '../../src/components/TableCard';

// Tables: the floor, live. A table with an order opens that order; any other opens its name and seats.
export default function Tables() {
  const t = useTheme();
  const router = useRouter();
  const tables = useLive((s) => s.tables);
  const now = useNow();
  const [width, setWidth] = useState(0);
  const [editing, setEditing] = useState(null); // a table, or {} for a new one
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState('4');
  const [busy, setBusy] = useState(false);

  const open = (table) => {
    setEditing(table);
    setLabel(table.label || '');
    setSeats(String(table.seats || 4));
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { label: label.trim(), seats: Number(seats) };
      if (editing.id) await api(`/tables/${editing.id}`, { method: 'PATCH', body });
      else await api('/tables', { method: 'POST', body });
      toast(editing.id ? `${body.label} saved` : `${body.label} added`, { tone: 'success' });
      setEditing(null);
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };

  const gap = t.d.gap;
  const columns = width >= breakpoints.tablet ? Math.max(t.d.columns, Math.floor(width / 170)) : t.d.columns;
  const cardWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;
  const free = tables.filter((x) => x.status === 'free').length;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Tables" />}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Chip label={`${free} Free`} tone="success" />
          <Chip label={`${tables.length - free} Occupied`} tone="primary" />
          <Chip label={`${tables.filter((x) => x.status === 'needs_payment').length} Need payment`} tone="warning" />
          <View style={{ flex: 1 }} />
          <Button title="Add table" icon="plus" variant="secondary" onPress={() => open({})} />
        </View>

        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {tables.map((table) => (
            <View key={table.id} style={{ width: cardWidth }}>
              {/* For a manager no table is "taken": the waiter's name is shown under the status instead. */}
              <TableCard table={{ ...table, locked_by: null }} now={now} onPress={() => (table.order_id ? router.push(`/orders/${table.order_id}`) : open(table))} />
              {table.locked_by_name ? (
                <Txt size={12} color="textSecondary" center numberOfLines={1} style={{ marginTop: 4 }}>
                  {table.locked_by_name}
                </Txt>
              ) : null}
            </View>
          ))}
        </View>
        {tables.length === 0 ? <EmptyState icon="table-furniture" title="No tables yet" text="Add the first table to start taking dine-in orders." /> : null}
      </View>

      <BottomSheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.label}` : 'Add a table'}
        footer={<Button title="Save" loading={busy} disabled={!label.trim() || !(Number(seats) >= 1)} onPress={save} />}
      >
        <TextField label="Table name" required value={label} onChangeText={setLabel} placeholder="e.g. T7" autoCapitalize="characters" maxLength={12} />
        <TextField label="Seats" value={seats} onChangeText={(v) => setSeats(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={2} />
      </BottomSheet>
    </Screen>
  );
}
