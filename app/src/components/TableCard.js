import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { minutesSince } from '../lib/useNow';
import { TABLE_STATUS } from '../lib/orders';
import { unitPieces, unitSeats, unitLabel } from '../lib/units';
import { money, elapsed, plural } from '../lib/format';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';
import { TableGraphic } from './TableGraphic';

const TEXT = { neutral: 'textSecondary', primary: 'primary', warning: 'warningText', success: 'successText', error: 'error' };

// "12m · ₹560" for a table with an order, "4 seats" for a free one. withSeats: the seats always.
function factsOf(table, now, showAmount, withSeats, mine) {
  const minutes = table.order_created_at ? minutesSince(table.order_created_at, now) : null;
  const facts = minutes === null ? [plural(table.seats, 'seat')] : withSeats ? [plural(table.seats, 'seat'), elapsed(minutes)] : [elapsed(minutes)];
  if (showAmount && table.order_total > 0) facts.push(money(table.order_total));
  if (mine) facts.push('Mine');
  return facts.join(' · ');
}

// The words under a table: what is happening there, or who has it.
function StateLine({ table, taken, freeText }) {
  const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  const free = table.status === 'free';
  if (taken) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name="lock-outline" size={14} color="textSecondary" />
        <Txt size={12} weight={600} color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
          {table.order_waiter_name ?? table.locked_by_name ?? 'Taken'}
        </Txt>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
      {!free ? <Icon name={status.icon} size={14} color={TEXT[status.tone]} /> : null}
      <Txt size={12} weight={600} color={free ? 'text' : TEXT[status.tone]} numberOfLines={2} style={{ flexShrink: 1 }}>
        {free ? freeText : status.short}
      </Txt>
    </View>
  );
}

// One whole table on a grid of tables: a small drawing of the table with its chairs, coloured by
// what is happening there, and the state written out under it.
//   mine        this waiter holds the table
//   taken       another waiter holds it: dimmed, lock icon, their name (waiter screens only)
//   showAmount  the bill so far (manager screens)
//   selected    ticked while choosing tables to join
//   shakeKey    change this number to make the card shake once (tap on a taken table)
export function TableCard({ table, mine, taken, busy, now, shakeKey, showAmount, selected, freeText = 'Tap to seat', onPress, onLongPress }) {
  const t = useTheme();
  const shake = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
  const free = table.status === 'free';

  useEffect(() => {
    if (!shakeKey) return;
    const step = (toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: Platform.OS !== 'web' });
    Animated.sequence([step(6), step(-6), step(4), step(-4), step(0)]).start();
  }, [shakeKey, shake]);

  const label = taken
    ? `${table.label}, taken by ${table.order_waiter_name ?? table.locked_by_name}`
    : `${table.label}, ${plural(table.seats, 'seat')}, ${free ? 'free' : status.short}${mine ? ', mine' : ''}${selected ? ', selected' : ''}`;

  return (
    <Animated.View style={{ transform: [{ translateX: shake }] }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={onLongPress ? 'Hold for more options' : undefined}
        aria-pressed={selected === undefined ? undefined : !!selected}
        style={({ pressed }) => ({
          minHeight: 132,
          padding: 12,
          gap: 8,
          borderRadius: t.radius.card,
          borderWidth: selected || !free ? 2 : t.borderWidth,
          borderColor: selected ? t.c.primary : t.c[status.line],
          backgroundColor: selected ? t.c.primaryTint : pressed && !taken ? t.c.pressed : t.c.card,
          opacity: taken ? 0.5 : 1, // held by another waiter
        })}
      >
        <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ height: 60 }}>
          <TableGraphic width={width} height={60} shape={table.shape} pieces={unitPieces({ kind: 'single', table })} />
          {busy ? (
            <View style={{ position: 'absolute', right: 0, top: 0 }}>
              <ActivityIndicator size="small" color={t.c.primary} />
            </View>
          ) : selected ? (
            <View style={{ position: 'absolute', right: -4, top: -4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.primary }}>
              <Icon name="check" size={14} color="onPrimary" />
            </View>
          ) : null}
        </View>
        <View style={{ gap: 2 }}>
          <Txt size={12} color="textSecondary" tabular numberOfLines={1}>
            {factsOf(table, now, showAmount, false, mine && !taken)}
          </Txt>
          <StateLine table={table} taken={taken} freeText={freeText} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// A table that is split into parts, or tables joined for one party, shown across the full width:
// the drawing on the left shows how the table is divided, and each part has a row of its own on
// the right that can be tapped like a table.
//   isMine(table), isTaken(table)   how each part stands for the person looking (waiter screens)
//   onPressTable(table)             a part, or the lead of joined tables, was tapped
//   onLongPressTable(table)         ... or held
//   onChange                        "Change split" (split tables, when given)
export function TableGroupCard({ unit, now, showAmount, isMine = () => false, isTaken = () => false, busyId, shakes = {}, freeText = 'Tap to seat', onPressTable, onLongPressTable, onChange }) {
  const t = useTheme();
  const split = unit.kind === 'split';
  const rows = split ? unit.parts : [unit.table];
  const title = split ? `${unit.table.label} · split in ${unit.parts.length}` : `${unitLabel(unit)} · joined`;

  return (
    <View style={[{ padding: 12, gap: 12, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }, t.shadow]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <Icon name={split ? 'call-split' : 'link-variant'} size={18} color="textSecondary" />
        <Txt size={15} weight={700} numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </Txt>
        <Txt size={12} color="textSecondary" tabular>
          {plural(unitSeats(unit), 'seat')}
        </Txt>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TableGraphic width={split ? Math.min(168, 84 + unit.parts.length * 28) : 148} height={72} shape="rectangle" pieces={unitPieces(unit)} linked={!split} labelSize={13} />
        <View style={{ flex: 1, gap: 8 }}>
          {rows.map((table) => {
            const mine = isMine(table);
            const taken = isTaken(table);
            const status = TABLE_STATUS[table.status] ?? TABLE_STATUS.free;
            const free = table.status === 'free';
            return (
              <GroupRow key={table.id} shakeKey={shakes[table.id]}>
                <Pressable
                  onPress={() => onPressTable?.(table)}
                  onLongPress={onLongPressTable ? () => onLongPressTable(table) : undefined}
                  delayLongPress={350}
                  disabled={busyId === table.id || !onPressTable}
                  accessibilityRole="button"
                  accessibilityLabel={`${split ? table.label : unitLabel(unit)}, ${plural(split ? table.seats : unitSeats(unit), 'seat')}, ${taken ? `taken by ${table.order_waiter_name ?? table.locked_by_name}` : free ? 'free' : status.short}${mine ? ', mine' : ''}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    minHeight: 56,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: t.radius.control,
                    borderWidth: free ? t.borderWidth : 2,
                    borderColor: free ? t.c.border : t.c[status.line],
                    backgroundColor: pressed && !taken ? t.c.pressed : free ? t.c.card : t.c[status.tint],
                    opacity: taken ? 0.5 : 1,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={15} weight={700} tabular numberOfLines={1}>
                      {split ? table.label : unitLabel(unit)}
                    </Txt>
                    <StateLine table={table} taken={taken} freeText={freeText} />
                    <Txt size={12} color="textSecondary" tabular numberOfLines={1}>
                      {split ? factsOf(table, now, showAmount, true, mine && !taken) : factsOf({ ...table, seats: unitSeats(unit) }, now, showAmount, true, mine && !taken)}
                    </Txt>
                  </View>
                  {busyId === table.id ? <ActivityIndicator size="small" color={t.c.primary} /> : onPressTable ? <Icon name="chevron-right" color="textSecondary" /> : null}
                </Pressable>
              </GroupRow>
            );
          })}
        </View>
      </View>

      {split && onChange ? (
        <Pressable
          onPress={onChange}
          accessibilityRole="button"
          accessibilityLabel={`Change how ${unit.table.label} is split`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: t.radius.control, backgroundColor: pressed ? t.c.pressed : 'transparent' })}
        >
          <Icon name="tune-variant" size={18} color="primary" />
          <Txt size={14} weight={600} color="primary">
            Change split
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// Shakes its row once when shakeKey changes (a tap on a part someone else holds).
function GroupRow({ shakeKey, children }) {
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shakeKey) return;
    const step = (toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: Platform.OS !== 'web' });
    Animated.sequence([step(6), step(-6), step(4), step(-4), step(0)]).start();
  }, [shakeKey, shake]);
  return <Animated.View style={{ transform: [{ translateX: shake }] }}>{children}</Animated.View>;
}
