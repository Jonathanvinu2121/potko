// Phone-sized charts drawn with plain views: vertical bars for a trend, horizontal bars for a ranking.
import { ScrollView, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';

// Vertical bars. data: [{ label, value, hint? }]. Tall enough to read, and it scrolls sideways
// when there are more bars than fit. The largest value is written above its bar.
export function Bars({ data, format = (v) => String(v), height = 130, tone = 'primary' }) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const wide = data.length > 12;
  const barWidth = wide ? 22 : undefined;
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: wide ? 6 : 8, height: height + 38, minWidth: '100%' }}>
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(4, Math.round((d.value / max) * height)) : 2;
        // The peak's value may be wider than its bar: it spills over the neighbours (whose labels are
        // blank), and at either end of the chart it grows inwards so nothing is cut off.
        const edge = i === 0 ? 'flex-start' : i === data.length - 1 ? 'flex-end' : 'center';
        return (
          <View key={`${d.label}-${i}`} accessibilityLabel={`${d.hint ?? d.label}: ${format(d.value)}`} style={{ flex: wide ? undefined : 1, width: barWidth, alignItems: 'center', gap: 4 }}>
            <View style={{ width: 84, alignSelf: edge, alignItems: edge }}>
              <Txt size={10} weight={700} color={i === peak && d.value > 0 ? 'text' : 'card'} numberOfLines={1} tabular>
                {i === peak && d.value > 0 ? format(d.value) : ' '}
              </Txt>
            </View>
            <View style={{ width: '100%', maxWidth: 34, height: h, borderRadius: 5, backgroundColor: d.value > 0 ? t.c[i === peak ? tone : `${tone}Tint`] ?? t.c.primaryTint : t.c.border }} />
            <Txt size={10} color="textSecondary" numberOfLines={1} tabular>
              {d.label}
            </Txt>
          </View>
        );
      })}
    </View>
  );
  if (!wide) return body;
  return (
    <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}

// A ranked list with a bar behind each line. data: [{ label, sub?, value }]
export function RankBars({ data, format = (v) => String(v), tone = 'primaryTint', numbered = true }) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 6 }}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={{ borderRadius: 8, overflow: 'hidden', backgroundColor: t.c.background }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, (d.value / max) * 100)}%`, backgroundColor: t.c[tone] }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10 }}>
            {numbered ? (
              <Txt size={13} weight={700} color="textSecondary" tabular style={{ minWidth: 18 }}>
                {i + 1}
              </Txt>
            ) : null}
            <View style={{ flex: 1 }}>
              <Txt size={14} weight={600} numberOfLines={1}>
                {d.label}
              </Txt>
              {d.sub ? (
                <Txt size={12} color="textSecondary" numberOfLines={1}>
                  {d.sub}
                </Txt>
              ) : null}
            </View>
            <Txt size={14} weight={700} tabular>
              {format(d.value)}
            </Txt>
          </View>
        </View>
      ))}
    </View>
  );
}

// One share out of a whole, as a labelled bar: payment methods, order types.
export function ShareBars({ data, format = (v) => String(v) }) {
  const t = useTheme();
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      {data.map((d) => (
        <View key={d.label} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt size={14} weight={600}>
              {d.label}
              {d.sub ? <Txt size={13} color="textSecondary">{`  ${d.sub}`}</Txt> : null}
            </Txt>
            <Txt size={14} weight={700} tabular>
              {format(d.value)} · {Math.round((d.value / total) * 100)}%
            </Txt>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.c.border, overflow: 'hidden' }}>
            <View style={{ width: `${(d.value / total) * 100}%`, height: 8, borderRadius: 4, backgroundColor: t.c.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}
