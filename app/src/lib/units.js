// The floor as people see it: one unit per physical table, however it is being used.
//   single  an ordinary table
//   split   a table divided by seats into parts (T4.1, T4.2), each with its own party or free
//   joined  tables pushed together for one party (T3 + T4), served as one
// The server stores parts and joined tables as rows of their own; this groups them back.
import { TABLE_STATUS, FLOOR_FILTERS } from './orders';

const partNumber = (label) => Number(String(label).slice(String(label).lastIndexOf('.') + 1)) || 0;

export function floorUnits(tables) {
  const parts = new Map(); // parent id -> its parts
  const followers = new Map(); // lead id -> the tables joined to it
  const add = (map, key, table) => map.set(key, [...(map.get(key) || []), table]);
  for (const t of tables) {
    if (!t.active) continue;
    if (t.parent_table_id) add(parts, t.parent_table_id, t);
    else if (t.joined_to_id) add(followers, t.joined_to_id, t);
  }
  const units = [];
  for (const t of tables) {
    if (!t.active || t.parent_table_id || t.joined_to_id) continue;
    if (t.status === 'split') {
      const mine = (parts.get(t.id) || []).slice().sort((a, b) => partNumber(a.label) - partNumber(b.label));
      if (mine.length) units.push({ key: `split-${t.id}`, kind: 'split', table: t, parts: mine });
      continue;
    }
    const joined = followers.get(t.id) || [];
    units.push(joined.length ? { key: `joined-${t.id}`, kind: 'joined', table: t, members: [t, ...joined] } : { key: `table-${t.id}`, kind: 'single', table: t });
  }
  return units;
}

// The tables of a unit that carry a state of their own (what filters and counts look at).
export const unitTables = (unit) => (unit.kind === 'split' ? unit.parts : [unit.table]);
export const unitSeats = (unit) => (unit.kind === 'joined' ? unit.members.reduce((n, m) => n + m.seats, 0) : unit.table.seats);
export const unitLabel = (unit) => (unit.kind === 'joined' ? unit.members.map((m) => m.label).join(' + ') : unit.table.label);
// "T3 + T4" for a joined lead, else the table's own name.
export const groupLabel = (table) => [table.label, ...(table.joined || []).map((j) => j.label)].join(' + ');

export const statusIn = (filterKey) => FLOOR_FILTERS.find((f) => f.key === filterKey)?.statuses ?? [];
export const unitMatches = (unit, statuses) => unitTables(unit).some((t) => statuses.includes(t.status));

// What a drawing of the unit needs: one piece per part (or per joined table), with its seats and state.
export function unitPieces(unit) {
  if (unit.kind === 'split') return unit.parts.map((p) => ({ key: p.id, seats: p.seats, status: p.status, label: p.label, short: `.${partNumber(p.label)}` }));
  if (unit.kind === 'joined') return unit.members.map((m) => ({ key: m.id, seats: m.seats, status: unit.table.status, label: m.label, short: m.label }));
  return [{ key: unit.table.id, seats: unit.table.seats, status: unit.table.status, label: unit.table.label, short: unit.table.label }];
}

export const statusOf = (table) => TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
