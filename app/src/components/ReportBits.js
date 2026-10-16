// Pieces of the report screens: the date choices, a headline number, a titled card.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { RANGES, dayString, isDay } from '../lib/reports';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { TextField } from './TextField';
import { Txt } from './Txt';

const QUICK = [
  { label: 'Yesterday', from: () => dayString(-1), to: () => dayString(-1) },
  { label: 'This month', from: () => `${dayString().slice(0, 8)}01`, to: () => dayString() },
  {
    label: 'Last month',
    from: () => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; },
    to: () => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  },
];

// Today | 7 Days | 30 Days | 3 Months | 1 Year | Custom. Custom asks for the first and last day.
export function RangeBar({ period, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.from ?? dayString(-6));
  const [to, setTo] = useState(period.to ?? dayString());
  const valid = isDay(from) && isDay(to) && from <= to;

  return (
    <>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
        {RANGES.map((range) => (
          <Chip
            key={range.key}
            label={range.key === 'custom' && period.range === 'custom' ? `${period.from} to ${period.to}` : range.label}
            icon={range.key === 'custom' ? 'calendar-range' : undefined}
            selected={period.range === range.key}
            onPress={() => (range.key === 'custom' ? setOpen(true) : onChange({ range: range.key }))}
          />
        ))}
      </ScrollView>
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Custom dates"
        footer={<Button title="Show Report" disabled={!valid} onPress={() => { setOpen(false); onChange({ range: 'custom', from, to }); }} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {QUICK.map((q) => (
            <Chip key={q.label} label={q.label} onPress={() => { setFrom(q.from()); setTo(q.to()); }} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextField label="First day" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={!!from && !isDay(from)} style={{ flex: 1 }} />
          <TextField label="Last day" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} error={!!to && !isDay(to)} style={{ flex: 1 }} />
        </View>
        <Txt size={13} color={valid || !from || !to ? 'textSecondary' : 'error'}>
          {valid || !from || !to ? 'Write each day as year-month-day, for example 2026-10-09. Up to 13 months.' : isDay(from) && isDay(to) ? 'The last day is before the first day.' : 'Write each day as year-month-day, for example 2026-10-09.'}
        </Txt>
      </BottomSheet>
    </>
  );
}

// A headline number. `move` is the change against the period before (from lib/reports change()),
// or null when there was nothing to compare with.
export function Kpi({ label, value, icon, move, compared, hint }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexGrow: 1, flexBasis: 150, gap: 4, padding: t.d.pad, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <Icon name={icon} size={16} color="textSecondary" /> : null}
        <Txt size={12} weight={600} color="textSecondary" numberOfLines={2} style={{ flex: 1 }}>
          {label}
        </Txt>
      </View>
      <Txt size={22} weight={700} tabular numberOfLines={1}>
        {value}
      </Txt>
      {compared ? (
        move ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name={move.flat ? 'minus' : move.up ? 'arrow-up' : 'arrow-down'} size={13} color={move.flat ? 'textSecondary' : move.up ? 'successText' : 'error'} />
            <Txt size={12} weight={600} color={move.flat ? 'textSecondary' : move.up ? 'successText' : 'error'}>
              {move.flat ? 'Same as before' : `${move.pct}% vs before`}
            </Txt>
          </View>
        ) : (
          <Txt size={12} color="textSecondary">
            Not enough data
          </Txt>
        )
      ) : hint ? (
        <Txt size={12} color="textSecondary" numberOfLines={2}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// A titled card. `note` explains what the numbers mean, in small print under the content.
export function Panel({ title, right, note, children }) {
  const t = useTheme();
  return (
    <View style={{ gap: 12, padding: t.d.pad, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Txt size={15} weight={700} style={{ flex: 1 }}>
          {title}
        </Txt>
        {right}
      </View>
      {children}
      {note ? (
        <Txt size={12} color="textSecondary">
          {note}
        </Txt>
      ) : null}
    </View>
  );
}

export function Empty({ text = 'Nothing in this period yet.' }) {
  return (
    <Txt size={14} color="textSecondary">
      {text}
    </Txt>
  );
}
