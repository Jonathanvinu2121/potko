import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useLive } from '../../src/store/live';
import { useNow, minutesSince } from '../../src/lib/useNow';
import { kitchenLabel, kitchenStage, liveItems, progress } from '../../src/lib/kitchen';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Chip } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';
import { ItemRow } from '../../src/components/ItemRow';
import { TimerChip, timerTone } from '../../src/components/TimerChip';

const TABS = [
  { key: 'new', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'done', label: 'Done' },
];

const EMPTY = {
  new: { icon: 'bell-outline', title: 'No new orders', text: 'New orders from the waiters appear here straight away.' },
  preparing: { icon: 'pot-steam-outline', title: 'Nothing cooking', text: 'Orders you accept move here.' },
  done: { icon: 'check-all', title: 'Nothing finished yet', text: 'Orders you finish today are listed here.' },
};

// C1 Kitchen board: New / Preparing / Done. Tap a card to open the order.
export default function Board() {
  const t = useTheme();
  const router = useRouter();
  const orders = useLive((s) => s.orders);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [tab, setTab] = useState('new');
  const [width, setWidth] = useState(0);

  // Oldest first, so the longest wait is always on top.
  const byAge = [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const staged = byAge.map((order) => ({ order, stage: kitchenStage(order) })).filter((x) => x.stage);
  const groups = {
    new: staged.filter((x) => x.stage === 'new'),
    preparing: staged.filter((x) => x.stage === 'accepted' || x.stage === 'preparing'),
    done: staged.filter((x) => x.stage === 'done').reverse(), // history: latest first
  };

  // One column on a phone, more on a tablet or a wall screen.
  const gap = t.d.gap;
  const columns = Math.max(1, Math.floor(width / 340));
  const cardWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : 0;

  const card = ({ order, stage }) => {
    const minutes = minutesSince(order.created_at, now);
    const tone = stage === 'done' ? 'neutral' : timerTone(minutes);
    const { ready, total } = progress(order);
    const allergy = order.items.some((i) => i.allergy_note);
    return (
      <Pressable
        key={order.id}
        onPress={() => router.push(`/kitchen/${order.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${kitchenLabel(order)}, order ${order.number}, ${minutes} minutes`}
        style={({ pressed }) => [
          {
            width: cardWidth,
            gap: 12,
            padding: t.d.pad,
            borderRadius: t.radius.card,
            borderWidth: tone === 'neutral' ? t.borderWidth : 2,
            borderColor: tone === 'error' ? t.c.error : tone === 'warning' ? t.c.warning : t.c.border,
            backgroundColor: pressed ? t.c.pressed : t.c.card,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
          t.shadow,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt size={20} weight={700} numberOfLines={1}>
              {kitchenLabel(order)}
            </Txt>
            <Txt size={13} weight={600} color="textSecondary" tabular>
              #{order.number}
              {stage === 'accepted' ? ' · Accepted, not started' : ''}
              {stage === 'preparing' ? ` · ${ready} of ${total} ready` : ''}
              {stage === 'done' ? ' · All ready' : ''}
            </Txt>
          </View>
          {stage === 'done' ? <Chip label="Done" icon="check-circle-outline" tone="success" /> : <TimerChip since={order.created_at} now={now} />}
        </View>

        {allergy ? <Chip label="Allergy on this order" icon="alert-outline" tone="error" /> : null}

        <View style={{ gap: 12 }}>
          {liveItems(order).map((item) => (
            <ItemRow
              key={item.id}
              qty={item.qty}
              name={item.name_snapshot}
              veg={item.veg}
              size={item.size}
              customisations={item.customisations}
              note={item.note ? `Waiter note: ${item.note}` : null}
              allergyNote={item.allergy_note}
              done={item.status === 'ready' || item.status === 'delivered'}
            />
          ))}
        </View>
      </Pressable>
    );
  };

  const list = groups[tab];

  return (
    <Screen header={<AppHeader title="Kitchen" />}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }} accessibilityRole="tablist">
        {TABS.map((item) => {
          const selected = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              aria-selected={selected}
              accessibilityLabel={`${item.label} ${groups[item.key].length}`}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minHeight: t.d.control,
                borderRadius: t.radius.control,
                borderWidth: t.borderWidth,
                borderColor: selected ? t.c.primary : t.c.border,
                backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Txt size={14} weight={600} color={selected ? 'primary' : 'text'}>
                {item.label}
              </Txt>
              <Txt size={12} weight={700} color={selected ? 'primary' : 'textSecondary'} tabular>
                {groups[item.key].length}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap }}>
        {!synced ? [0, 1].map((n) => <Skeleton key={n} height={180} width={cardWidth || '100%'} radius={t.radius.card} />) : list.map(card)}
      </View>

      {synced && list.length === 0 ? <EmptyState {...EMPTY[tab]} /> : null}
    </Screen>
  );
}
