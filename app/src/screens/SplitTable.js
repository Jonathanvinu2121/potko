import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { useLive } from '../store/live';
import { send } from '../lib/ws';
import { toast } from '../store/toast';
import { plural } from '../lib/format';
import { Screen } from '../components/Screen';
import { AppHeader } from '../components/AppHeader';
import { Txt } from '../components/Txt';
import { Icon } from '../components/Icon';
import { Button } from '../components/Button';
import { Stepper } from '../components/Stepper';
import { EmptyState } from '../components/EmptyState';
import { Notice, Success } from '../components/Feedback';

const MAX_PARTS = 12;
const numberOf = (label) => Number(String(label).slice(String(label).lastIndexOf('.') + 1)) || 0;

// Shares `total` out over `count` parts as evenly as possible: 5 over 2 = [3, 2].
const even = (total, count) => Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));

// The names the parts will have: kept parts keep theirs, new ones take the lowest free number.
function namesFor(parent, parts) {
  const used = new Set(parts.filter((p) => p.label).map((p) => numberOf(p.label)));
  return parts.map((p) => {
    if (p.label) return p.label;
    let n = 1;
    while (used.has(n)) n += 1;
    used.add(n);
    return `${parent.label}.${n}`;
  });
}

// One white box, as on the design's split screens.
function Box({ children, style }) {
  const t = useTheme();
  return <View style={[{ gap: 6, padding: 14, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }, style]}>{children}</View>;
}

// Split Table, in the three steps of the "finals" design:
//   1 Choose count   "How many tables do you want to split into?" (2 up to the table's seats)
//   2 Assign people  how many of the party sit at each new table (T2.1, T2.2); with nobody seated
//                    yet, how many seats each part gets. "Total assigned: 4 of 4 people".
//   3 Success        "Table Split Successfully!", each new table with View Order
// The dishes already ordered stay on the first part (T2.1). Seats always add up to the table's
// seats: when fewer people sit than there are seats, the spare seats go to the last part.
// Opened on a table that is already split, it re-cuts the parts by seats.
//   orderPath(id)   where "View Order" leads for this role
//   onSeat(table)   waiter screens: take the order for a new party at a free part
export function SplitTable({ tableId, orderPath, onSeat }) {
  const t = useTheme();
  const router = useRouter();
  const tables = useLive((s) => s.tables);
  const synced = useLive((s) => s.synced);
  const asked = tables.find((x) => x.id === tableId);
  const parent = asked?.parent_table_id ? tables.find((x) => x.id === asked.parent_table_id) : asked;
  const existing = useMemo(
    () => (parent?.status === 'split' ? tables.filter((x) => x.parent_table_id === parent.id).sort((a, b) => numberOf(a.label) - numberOf(b.label)) : []),
    [tables, parent]
  );
  const again = existing.length > 0;
  const guests = !again && parent?.order_guests ? parent.order_guests : 0;
  const byPeople = guests >= 2 && guests <= (parent?.seats ?? 0);
  const unit = byPeople ? ['person', 'people'] : ['seat', 'seats'];
  const total = byPeople ? guests : parent?.seats ?? 0;
  const most = Math.min(total, MAX_PARTS);

  const [step, setStep] = useState('count');
  const [count, setCount] = useState(null);
  const [shares, setShares] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (count !== null || !parent) return;
    setCount(again ? existing.length : 2);
  }, [count, parent, again, existing]);

  if (!parent || parent.seats < 2) {
    return (
      <Screen header={<AppHeader title="Split Table" back />}>
        {synced ? <EmptyState icon="call-split" title={parent ? 'This table has one seat' : 'This table is no longer there'} text="Go back to the tables." /> : null}
      </Screen>
    );
  }

  const chosen = count ?? 2;
  const assigned = shares.reduce((a, b) => a + b, 0);
  const names = namesFor(parent, Array.from({ length: chosen }, (_, i) => (again && existing[i] ? { label: existing[i].label } : {})));
  const toAssign = () => {
    setShares(again ? Array.from({ length: chosen }, (_, i) => existing[i]?.seats ?? 1) : even(total, chosen));
    setStep('assign');
  };

  const create = async () => {
    // People become seats; the spare seats of the table go to the last part.
    const seats = byPeople ? shares.map((n, i) => n + (i === shares.length - 1 ? parent.seats - guests : 0)) : shares;
    if (again) {
      const fit = seats.reduce((a, b) => a + b, 0);
      if (fit !== parent.seats) return toast(`The parts must add up to ${plural(parent.seats, 'seat')}`, { tone: 'error', icon: 'alert-circle-outline' });
    }
    setBusy(true);
    try {
      const parts = seats.map((n, i) => ({ ...(again && existing[i] ? { id: existing[i].id } : {}), seats: n, ...(byPeople ? { guests: shares[i] } : {}) }));
      const answer = await send('table.split', { tableId: parent.id, parts });
      setResult(answer);
      setStep('done');
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };

  // ---------- 3 Success ----------
  if (step === 'done' && result) {
    const made = (result.parts || []).map((p) => tables.find((x) => x.id === p.id) ?? p);
    return (
      <Screen header={<AppHeader title="Split Table" />} footer={<Button title="Done" onPress={() => router.back()} />}>
        <Success title="Table Split Successfully!" text={`Table ${parent.label} has been split into ${plural(made.length, 'table')}.`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignSelf: 'stretch' }}>
            {made.map((part, i) => (
              <Box key={part.id} style={{ flex: 1, minWidth: 130, alignItems: 'center' }}>
                <Txt size={20} weight={700} tabular>
                  {part.label}
                </Txt>
                <Txt size={13} color="textSecondary">
                  {byPeople ? plural(shares[i] ?? 0, 'person', 'people') : plural(part.seats, 'seat')}
                </Txt>
                {part.order_id ? (
                  <Button title="View Order" variant="link" onPress={() => router.push(orderPath(part.order_id))} />
                ) : onSeat ? (
                  <Button title="Take Order" variant="link" onPress={() => onSeat(part)} />
                ) : null}
              </Box>
            ))}
          </View>
        </Success>
      </Screen>
    );
  }

  // ---------- 2 Assign people ----------
  if (step === 'assign') {
    const ok = again ? true : assigned === total && shares.every((n) => n >= 1);
    return (
      <Screen
        header={<AppHeader title="Split Table" back onBack={() => setStep('count')} />}
        footer={<Button title="Create Split Tables" icon="call-split" disabled={!ok} loading={busy} onPress={create} />}
      >
        <View style={{ gap: 14 }}>
          <Txt size={13} color="textSecondary">
            Assign number of {unit[1]} to each new table.
          </Txt>
          <Box>
            <Txt size={13} color="textSecondary">
              Original Table
            </Txt>
            <Txt size={16} weight={700}>
              {parent.label} · {guests ? `${plural(guests, 'person', 'people')} · ` : ''}
              {plural(parent.seats, 'seat')}
            </Txt>
          </Box>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {names.map((name, i) => (
              <Box key={name} style={{ flex: 1, minWidth: 140, alignItems: 'center' }}>
                <Txt size={18} weight={700} tabular>
                  {name}
                </Txt>
                <Stepper compact value={shares[i] ?? 1} min={1} max={total} onChange={(n) => setShares((list) => list.map((v, x) => (x === i ? n : v)))} />
                <Txt size={13} color="textSecondary">
                  {unit[1]}
                </Txt>
              </Box>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={assigned === total ? 'check-circle' : 'alert-circle-outline'} size={20} color={assigned === total ? 'success' : 'warning'} />
            <Txt size={15} weight={600}>
              Total assigned: {assigned} of {plural(total, unit[0], unit[1])}
            </Txt>
          </View>
          <Notice icon="information-outline" text={byPeople ? 'The dishes already ordered stay on the first table. You can adjust this later from the order if needed.' : 'Every part needs at least one seat.'} />
        </View>
      </Screen>
    );
  }

  // ---------- 1 Choose count ----------
  const options = Array.from({ length: Math.max(0, most - 1) }, (_, i) => i + 2);
  return (
    <Screen header={<AppHeader title="Split Table" back />} footer={<Button title="Next" disabled={options.length === 0} onPress={toAssign} />}>
      <View style={{ gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Txt size={20} weight={700}>
            Table {parent.label}
          </Txt>
          <Txt size={14} color="textSecondary">
            Capacity: {plural(parent.seats, 'seat')}
          </Txt>
          <Txt size={14} color="textSecondary">
            Current guests: {guests ? plural(guests, 'person', 'people') : again ? `split into ${plural(existing.length, 'part')}` : 'none yet'}
          </Txt>
        </View>
        <Txt size={15} weight={600}>
          How many tables do you want to split into?
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {options.map((n) => {
            const selected = n === chosen;
            return (
              <Pressable
                key={n}
                onPress={() => setCount(n)}
                accessibilityRole="radio"
                aria-checked={selected}
                accessibilityLabel={`${n} tables`}
                style={({ pressed }) => ({
                  width: 84,
                  height: 84,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: t.radius.card,
                  borderWidth: selected ? 2 : t.borderWidth,
                  borderColor: selected ? t.c.primary : t.c.border,
                  backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                })}
              >
                <Txt size={26} weight={700} color={selected ? 'primary' : 'text'} tabular>
                  {n}
                </Txt>
                <Txt size={12} color={selected ? 'primary' : 'textSecondary'}>
                  tables
                </Txt>
              </Pressable>
            );
          })}
        </View>
        <Notice icon="information-outline" text={`You can split up to ${plural(most, 'table')} based on the table capacity (${parent.seats})${byPeople ? ` and current guest count (${guests})` : ''}.`} />
      </View>
    </Screen>
  );
}
