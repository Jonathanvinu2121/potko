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

// A part as it will be: one dot per seat, filled where a guest of the party sits.
function Seats({ seats, guests }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
      {Array.from({ length: seats }, (_, i) => (
        <View key={i} style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: i < guests ? t.c.primary : t.c.textSecondary, backgroundColor: i < guests ? t.c.primary : 'transparent' }} />
      ))}
    </View>
  );
}

// What can be split, from who sits where (the server checks the same):
//   nobody seated     every part gets at least one seat: 2 parts up to the table's seats
//   a party seated    the party stays together on the first part with exactly its seats, and
//                     only the free seats make further parts: 4 seats with 2 guests can be
//                     2 + 2 or 2 + 1 + 1, never four parts; a full table cannot be split
//   already split     a part with guests keeps at least their seats; the free seats are shared again
function seatingOf(parent, existing, party) {
  if (existing.length > 0) {
    const need = existing.map((p) => (p.order_id ? Math.max(1, p.order_guests || 1) : 1));
    const lastHeld = existing.reduce((last, p, i) => (p.order_id || p.locked_by ? i : last), -1);
    const least = Math.max(2, lastHeld + 1);
    const most = Math.min(MAX_PARTS, existing.length + parent.seats - need.reduce((a, b) => a + b, 0));
    return { least, most, minOf: (i) => need[i] ?? 1 };
  }
  if (party > 0) return { least: 2, most: Math.min(MAX_PARTS, 1 + parent.seats - party), minOf: (i) => (i === 0 ? party : 1) };
  return { least: 2, most: Math.min(MAX_PARTS, parent.seats), minOf: () => 1 };
}

// Split Table, in the three steps of the "finals" design:
//   1 Choose count   "How many tables do you want to split into?", each choice with its seats
//                    (2 + 1 + 1), and the chosen one drawn seat by seat
//   2 Seats          the seats of each new table: the party's table is fixed, the free seats
//                    can be moved between the others; "Free seats assigned: 2 of 2"
//   3 Success        "Table Split Successfully!", each new table with View Order or Take Order
// The dishes already ordered stay with the party on the first part (T2.1).
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
  // The party at the table now. An order without a guest count asks for it here.
  const seated = !again && !!parent?.order_id;
  const counted = seated && parent.order_guests > 0;
  const [told, setTold] = useState(1);
  const party = !seated ? 0 : counted ? parent.order_guests : told;
  const plan = parent ? seatingOf(parent, existing, party) : null;
  const options = plan ? Array.from({ length: Math.max(0, plan.most - plan.least + 1) }, (_, i) => plan.least + i) : [];

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

  const chosen = options.includes(count) ? count : options[0] ?? 2;
  const names = namesFor(parent, Array.from({ length: chosen }, (_, i) => (again && existing[i] ? { label: existing[i].label } : {})));
  const guestsAt = (i) => (again ? (existing[i]?.order_id ? existing[i].order_guests || 0 : 0) : i === 0 ? party : 0);

  // The seats each part starts with: the party's exactly, the free seats shared evenly; on a split
  // table the parts keep their seats, and seats are taken from or given to the free parts.
  const startFor = (n) => {
    if (!again) return party > 0 ? [party, ...even(parent.seats - party, n - 1)] : even(parent.seats, n);
    const list = Array.from({ length: n }, (_, i) => existing[i]?.seats ?? 1);
    let diff = parent.seats - list.reduce((a, b) => a + b, 0);
    for (let i = n - 1; i >= 0 && diff !== 0; i -= 1) {
      if (diff > 0) {
        if (!existing[i]?.order_id || i === 0) { list[i] += diff; diff = 0; }
      } else {
        const take = Math.min(-diff, list[i] - plan.minOf(i));
        list[i] -= take;
        diff += take;
      }
    }
    if (diff > 0) list[n - 1] += diff;
    return list;
  };
  const arrangement = (n) => startFor(n).join('+');

  const assigned = shares.reduce((a, b) => a + b, 0);
  const ok = assigned === parent.seats && shares.length === chosen && shares.every((n, i) => n >= plan.minOf(i)) && (again || party === 0 || shares[0] === party);

  const toAssign = () => {
    setShares(startFor(chosen));
    setStep('assign');
  };

  const create = async () => {
    setBusy(true);
    try {
      const parts = shares.map((n, i) => ({ ...(again && existing[i] ? { id: existing[i].id } : {}), seats: n }));
      if (seated && !counted) parts[0].guests = party;
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
    // The answer names each part by table_id; the live table (with its guests) is used when it is there.
    const made = (result.parts || []).map((p) => tables.find((x) => x.id === p.table_id) ?? { id: p.table_id, label: p.table_label, seats: p.seats, order_id: p.order_id ?? null });
    return (
      <Screen header={<AppHeader title="Split Table" />} footer={<Button title="Done" onPress={() => router.back()} />}>
        <Success title="Table Split Successfully!" text={`Table ${parent.label} has been split into ${plural(made.length, 'table')}.`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignSelf: 'stretch' }}>
            {made.map((part) => (
              <Box key={part.id} style={{ flex: 1, minWidth: 130, alignItems: 'center' }}>
                <Txt size={20} weight={700} tabular>
                  {part.label}
                </Txt>
                <Txt size={13} color="textSecondary">
                  {part.order_id && part.order_guests ? `${plural(part.order_guests, 'guest')} · ${plural(part.seats, 'seat')}` : part.order_id ? plural(part.seats, 'seat') : plural(part.seats, 'free seat')}
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

  // ---------- 2 Seats ----------
  if (step === 'assign') {
    const free = parent.seats - (party > 0 && !again ? party : 0);
    const shared = party > 0 && !again ? assigned - shares[0] : assigned;
    return (
      <Screen
        header={<AppHeader title="Split Table" back onBack={() => setStep('count')} />}
        footer={<Button title="Create Split Tables" icon="call-split" disabled={!ok} loading={busy} onPress={create} />}
      >
        <View style={{ gap: 14 }}>
          <Txt size={13} color="textSecondary">
            {party > 0 && !again ? 'The guests keep their table. Share the free seats between the new tables.' : 'Assign number of seats to each new table.'}
          </Txt>
          <Box>
            <Txt size={13} color="textSecondary">
              Original Table
            </Txt>
            <Txt size={16} weight={700}>
              {parent.label} · {party ? `${plural(party, 'guest')} · ` : ''}
              {plural(parent.seats, 'seat')}
            </Txt>
          </Box>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {names.map((name, i) => {
              const guests = guestsAt(i);
              const fixed = !again && party > 0 && i === 0;
              return (
                <Box key={name} style={{ flex: 1, minWidth: 140, alignItems: 'center' }}>
                  <Txt size={18} weight={700} tabular>
                    {name}
                  </Txt>
                  <Seats seats={shares[i] ?? 0} guests={guests} />
                  {fixed ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 }}>
                      <Icon name="account-group-outline" size={18} color="primary" />
                      <Txt size={15} weight={700} color="primary" tabular>
                        {plural(party, 'guest')}
                      </Txt>
                    </View>
                  ) : (
                    <Stepper compact value={shares[i] ?? 1} min={plan.minOf(i)} max={parent.seats} onChange={(n) => setShares((list) => list.map((v, x) => (x === i ? n : v)))} />
                  )}
                  <Txt size={13} color="textSecondary" center>
                    {fixed ? 'seated together' : guests ? `seats · ${plural(guests, 'guest')} here` : 'seats'}
                  </Txt>
                </Box>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={ok ? 'check-circle' : 'alert-circle-outline'} size={20} color={ok ? 'success' : 'warning'} />
            <Txt size={15} weight={600} style={{ flex: 1 }}>
              {party > 0 && !again ? `Free seats assigned: ${shared} of ${free}` : `Seats assigned: ${assigned} of ${parent.seats}`}
            </Txt>
          </View>
          <Notice
            icon="information-outline"
            text={
              party > 0 && !again
                ? `The ${plural(party, 'guest')} stay together on ${names[0]} with their order. The free seats become new tables for other guests.`
                : again
                  ? 'A table with guests keeps at least as many seats as its guests. Every part needs at least one seat.'
                  : 'Every part needs at least one seat.'
            }
          />
        </View>
      </Screen>
    );
  }

  // ---------- 1 Choose count ----------
  const full = options.length === 0;
  const start = full ? [] : startFor(chosen);
  return (
    <Screen header={<AppHeader title="Split Table" back />} footer={<Button title="Next" disabled={full} onPress={toAssign} />}>
      <View style={{ gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Txt size={20} weight={700}>
            Table {parent.label}
          </Txt>
          <Txt size={14} color="textSecondary">
            Capacity: {plural(parent.seats, 'seat')}
          </Txt>
          <Txt size={14} color="textSecondary">
            Current guests: {party ? `${plural(party, 'guest')}, seated together` : again ? `split into ${plural(existing.length, 'part')}` : 'none yet'}
          </Txt>
        </View>
        {seated && !counted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Txt size={15} weight={600} style={{ flex: 1 }}>
              How many guests are seated?
            </Txt>
            <Stepper compact value={told} min={1} max={parent.seats} onChange={setTold} />
          </View>
        ) : null}
        {full ? (
          <Notice tone="warning" icon="account-group-outline" title="No free seats to split off" text={`The ${plural(party, 'guest')} at ${parent.label} fill all ${plural(parent.seats, 'seat')}. A table can be split only when some of its seats are free.`} />
        ) : (
          <>
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
                    accessibilityLabel={`${n} tables, ${arrangement(n).split('+').join(' plus ')} seats`}
                    style={({ pressed }) => ({
                      width: 84,
                      minHeight: 84,
                      paddingVertical: 8,
                      paddingHorizontal: 4,
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
                    <Txt size={11} weight={600} color={selected ? 'primary' : 'textSecondary'} tabular center numberOfLines={2}>
                      {arrangement(n)}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ gap: 8 }}>
              <Txt size={13} color="textSecondary">
                {plural(chosen, 'table')}: {start.join(' + ')}
              </Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {names.map((name, i) => (
                  <Box key={name} style={{ flex: 1, minWidth: 96, alignItems: 'center', padding: 10 }}>
                    <Txt size={15} weight={700} tabular>
                      {name}
                    </Txt>
                    <Seats seats={start[i] ?? 0} guests={guestsAt(i)} />
                    <Txt size={12} color="textSecondary" center>
                      {guestsAt(i) ? plural(guestsAt(i), 'guest') : plural(start[i] ?? 0, 'free seat')}
                    </Txt>
                  </Box>
                ))}
              </View>
            </View>
          </>
        )}
        <Notice
          icon="information-outline"
          text={
            full
              ? 'Move the party to a bigger table, or free a seat first.'
              : party > 0
                ? `The ${plural(party, 'guest')} stay together on ${parent.label}.1. The ${plural(parent.seats - party, 'free seat')} can make ${plan.most === 2 ? 'one more table' : `up to ${plan.most - 1} more tables`}.`
                : again
                  ? 'Tables with guests keep at least their seats; the free seats can be shared out again.'
                  : `You can split up to ${plural(plan.most, 'table')} based on the table capacity (${parent.seats}).`
          }
        />
      </View>
    </Screen>
  );
}
