import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import { useLive } from '../store/live';
import { toast } from '../store/toast';
import { plural } from '../lib/format';
import { AREA_KINDS, TABLE_KINDS } from '../lib/floor';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Button } from './Button';
import { TextField } from './TextField';
import { Choices, SwitchRow, NumberRow } from './Forms';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

const BLANK_AREA = { name: '', description: '', kind: 'indoor', tables: 0, active: true };

// The form for a dining area, used to add one (area = null) and to edit one.
//   floorId  the floor a new area starts on
export function AreaSheet({ area, floorId, visible, onClose, onSaved }) {
  const floors = useLive((s) => s.floors);
  const [form, setForm] = useState(BLANK_AREA);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(null);
  // Fill the form each time the sheet opens for a different area.
  const key = visible ? (area?.id ?? 'new') : null;
  if (key !== seen) {
    setSeen(key);
    if (visible) setForm(area ? { name: area.name, description: area.description ?? '', kind: area.kind, tables: 0, active: area.active, floor_id: area.floor_id } : { ...BLANK_AREA, floor_id: floorId ?? floors[0]?.id });
  }
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, description: form.description, kind: form.kind, active: form.active, floor_id: form.floor_id };
      const result = area ? await api(`/areas/${area.id}`, { method: 'PATCH', body }) : await api('/areas', { method: 'POST', body: { ...body, tables: form.tables } });
      toast(area ? `${result.area.name} saved` : `${result.area.name} added${form.tables ? ` with ${plural(form.tables, 'table')}` : ''}`, { tone: 'success' });
      onSaved?.(result.area);
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={area ? 'Edit Dining Area' : 'Add Dining Area'}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title={area ? 'Save Changes' : 'Create Area'} disabled={!form.name.trim()} loading={busy} onPress={save} style={{ flex: 1.5 }} />
        </View>
      }
    >
      {floors.length > 1 ? <Choices label="Floor" required options={floors.map((f) => ({ value: f.id, label: f.name, icon: 'layers-outline' }))} value={form.floor_id} onChange={(floor_id) => set({ floor_id })} /> : null}
      <TextField label="Area Name" required value={form.name} onChangeText={(name) => set({ name })} placeholder="e.g. Main Hall, Garden, Private Dining" autoCapitalize="words" maxLength={40} />
      <TextField label="Description (optional)" value={form.description} onChangeText={(description) => set({ description })} placeholder="e.g. Main dining hall" autoCapitalize="sentences" maxLength={120} />
      <Choices label="Area Type" required options={AREA_KINDS} value={form.kind} onChange={(kind) => set({ kind })} />
      {area ? null : <NumberRow label="Number of tables (optional)" value={form.tables} min={0} max={60} onChange={(tables) => set({ tables })} unit="You can add or edit tables later" />}
      <SwitchRow title={form.active ? 'Active' : 'Inactive'} text="Inactive areas do not appear on the floor or for waiters" value={form.active} onChange={(active) => set({ active })} />
    </BottomSheet>
  );
}

const blankTable = (areaId) => ({ label: '', seats: 4, area_id: areaId, kind: 'normal', shape: 'square', size: 'medium', active: true });

// The form for a table: its details, and how it is drawn on the area's layout.
// What is happening at a table (free, occupied, ready) is never set here: it follows from orders.
//   table = null adds one to `areaId`
export function TableFormSheet({ table, areaId, areas, visible, onClose }) {
  const [form, setForm] = useState(blankTable(areaId));
  const [busy, setBusy] = useState(false);
  const areaName = areas.find((a) => a.id === areaId)?.name;
  const [seen, setSeen] = useState(null);
  const key = visible ? (table?.id ?? `new-${areaId}`) : null;
  if (key !== seen) {
    setSeen(key);
    if (visible) {
      setForm(table ? { label: table.label, seats: table.seats, area_id: table.area_id, kind: table.kind, shape: table.shape, size: table.size, active: table.active } : blankTable(areaId));
    }
  }
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  const save = async () => {
    setBusy(true);
    try {
      const result = table ? await api(`/tables/${table.id}`, { method: 'PATCH', body: form }) : await api('/tables', { method: 'POST', body: form });
      toast(table ? `${result.table.label} saved` : `${result.table.label} added`, { tone: 'success' });
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={busy ? () => {} : onClose}
      title={table ? `Edit ${table.label}` : areaName ? `Add Table to ${areaName}` : 'Add Table'}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title={table ? 'Save Changes' : 'Add Table'} disabled={!form.label.trim()} loading={busy} onPress={save} style={{ flex: 1.5 }} />
        </View>
      }
    >
      <>
          <View style={{ gap: 4 }}>
            <TextField label="Table Name" required value={form.label} onChangeText={(label) => set({ label })} autoCapitalize="characters" maxLength={12} />
            <Txt size={12} color="textSecondary">
              e.g. T1, T2, VIP1, Booth A
            </Txt>
          </View>
          <NumberRow label="Capacity" required value={form.seats} min={1} max={50} onChange={(seats) => set({ seats })} unit="seats" />
          {/* Added from inside a dining area, the table belongs there: the area is asked only when editing (to move it). */}
          {table ? <Choices label="Dining Area" required options={areas.map((a) => ({ value: a.id, label: a.name }))} value={form.area_id} onChange={(area_id) => set({ area_id })} /> : null}
          <Choices label="Table Type" options={TABLE_KINDS} value={form.kind} onChange={(kind) => set({ kind })} />
          <SwitchRow title={form.active ? 'Active' : 'Inactive'} text="Inactive tables won't appear in floor view" value={form.active} onChange={(active) => set({ active })} />
      </>
    </BottomSheet>
  );
}
