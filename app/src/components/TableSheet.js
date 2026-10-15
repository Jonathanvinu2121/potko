import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useCan } from '../store/auth';
import { useLive } from '../store/live';
import { send } from '../lib/ws';
import { toast } from '../store/toast';
import { useNow, minutesSince } from '../lib/useNow';
import { TABLE_STATUS } from '../lib/orders';
import { groupLabel } from '../lib/units';
import { plural, tableName, elapsed } from '../lib/format';
import { BottomSheet } from './BottomSheet';
import { useManyFloors } from './AreaPicker';
import { Txt } from './Txt';
import { Chip } from './Chip';
import { Button } from './Button';
import { ActionRow } from './Lists';

// What can be done with a table (the "finals" Table Actions sheet, opened by holding a table):
// Split Table, Merge Table, Transfer Table, Cancel. Only table operations: the order itself opens
// with a tap on the table. Only what the table's state allows is offered. Two rows appear only
// when they are the one way forward: Close Table once the bill is paid, and Separate Tables for
// tables merged for one party.
//   paths    where each action leads for this role: { split(tableId), merge(tableId), transfer(orderId) }
export function TableSheet({ table, onClose, paths }) {
  const router = useRouter();
  const userId = useAuth((s) => s.user?.id);
  const manageAll = useCan('orders.manage');
  const mayClose = useCan('tables.close');
  // (A store selector must hand back the same thing when nothing changed, so the list is filtered here.)
  const tables = useLive((s) => s.tables);
  const now = useNow();
  const manyFloors = useManyFloors();
  const [busy, setBusy] = useState(false);

  if (!table) return <BottomSheet visible={false} onClose={onClose} />;

  const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  const hasOrder = !!table.order_id;
  const mayAct = manageAll || (hasOrder ? table.order_waiter_id === userId : !table.locked_by || table.locked_by === userId);
  const paid = table.order_status === 'paid';
  const isPart = !!table.parent_table_id;
  const siblings = isPart ? tables.filter((x) => x.parent_table_id === table.parent_table_id) : [];
  const joined = table.joined || [];
  const seats = table.seats + joined.reduce((n, j) => n + j.seats, 0);
  const name = groupLabel(table);
  const go = (path) => {
    onClose();
    router.push(path);
  };

  const run = async (type, payload, done) => {
    setBusy(true);
    try {
      await send(type, payload);
      toast(done, { tone: 'success' });
      onClose();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };
  const closeTable = () => run('order.close', { orderId: table.order_id }, `${tableName(name)} closed and free again`);
  const separate = () => run('table.unjoin', { tableId: table.id }, `${joined.map((j) => j.label).join(', ')} ${joined.length === 1 ? 'is' : 'are'} free again`);

  const minutes = table.order_created_at ? minutesSince(table.order_created_at, now) : null;
  const where = [manyFloors ? table.floor_name : null, table.area_name].filter(Boolean).join(' · ');

  return (
    <BottomSheet visible onClose={busy ? () => {} : onClose} footer={<Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Txt size={joined.length ? 24 : 30} weight={700} tabular>
          {name}
        </Txt>
        <View style={{ flex: 1, gap: 4 }}>
          <Chip label={status.label} icon={status.icon} tone={status.tone} />
          <Txt size={13} color="textSecondary" tabular>
            {[table.order_guests ? plural(table.order_guests, 'person', 'people') : plural(seats, 'seat'), minutes === null ? null : elapsed(minutes), where].filter(Boolean).join(' · ')}
          </Txt>
        </View>
      </View>

      <View>
        {mayAct ? null : (
          <Txt size={14} color="textSecondary">
            {hasOrder ? `Only ${table.order_waiter_name ?? 'the waiter serving it'} or a manager can change this table.` : `${table.locked_by_name ?? 'Another waiter'} is seating guests here.`}
          </Txt>
        )}
        {mayAct && joined.length === 0 ? (
          <ActionRow
            icon="call-split"
            tone="primary"
            title="Split Table"
            subtitle={isPart ? `${table.parent_label} is in ${plural(siblings.length, 'part')}: change the split` : table.seats < 2 ? 'This table has one seat' : 'Split this table into multiple tables'}
            disabled={!isPart && table.seats < 2}
            onPress={() => go(paths.split(table.id))}
          />
        ) : null}
        {mayAct ? (
          <ActionRow
            icon="call-merge"
            tone="primary"
            title="Merge Table"
            subtitle={paid ? 'A paid bill cannot be merged' : isPart ? `Make ${table.parent_label} one table again` : 'Merge with adjacent tables'}
            disabled={paid || (isPart && siblings.length < 2)}
            onPress={() => go(paths.merge(table.id))}
          />
        ) : null}
        {mayAct && hasOrder ? <ActionRow icon="swap-horizontal" tone="primary" title="Transfer Table" subtitle="Move to another table" onPress={() => go(paths.transfer(table.order_id))} /> : null}
        {mayAct && joined.length > 0 ? (
          <ActionRow icon="link-variant-off" title="Separate Tables" subtitle={`Free ${joined.map((j) => j.label).join(', ')}; the order stays on ${table.label}`} chevron={false} disabled={busy} onPress={separate} />
        ) : null}
        {mayAct && paid && mayClose ? <ActionRow icon="check-circle-outline" tone="success" title="Close Table" subtitle="The guests have left: free the table" chevron={false} disabled={busy} onPress={closeTable} /> : null}
      </View>
    </BottomSheet>
  );
}
