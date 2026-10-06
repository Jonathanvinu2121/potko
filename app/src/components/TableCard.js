import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { minutesSince } from '../lib/useNow';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';

// What each table status is called on the card. Never colour alone: every state has a label, most an icon.
const STATUS = {
  free: { label: 'Tap to seat' },
  occupied: { label: 'Seated', icon: 'account-check-outline' },
  order_placed: { label: 'Order placed', icon: 'send-check-outline' },
  preparing: { label: 'Preparing', icon: 'pot-steam-outline' },
  ready: { label: 'Ready', icon: 'check-circle-outline' },
  all_delivered: { label: 'All delivered', icon: 'check-all' },
  needs_payment: { label: 'Needs payment', icon: 'cash' },
};

// One table on the Tables grid.
//   mine      this waiter holds the table
//   taken     another waiter holds it: dimmed, lock icon, their name
//   shakeKey  change this number to make the card shake once (tap on a taken table)
export function TableCard({ table, mine, busy, now, shakeKey, onPress }) {
  const t = useTheme();
  const shake = useRef(new Animated.Value(0)).current;
  const taken = !!table.locked_by && !mine;
  const ready = table.status === 'ready';
  const status = STATUS[table.status] ?? STATUS.free;

  useEffect(() => {
    if (!shakeKey) return;
    const step = (toValue) => Animated.timing(shake, { toValue, duration: 50, useNativeDriver: Platform.OS !== 'web' });
    Animated.sequence([step(6), step(-6), step(4), step(-4), step(0)]).start();
  }, [shakeKey, shake]);

  const border = ready ? t.c.success : mine ? t.c.primary : t.c.border;
  const fill = ready ? t.c.successTint : mine ? t.c.primaryTint : t.c.card;
  const tone = ready ? 'successText' : mine ? 'primary' : 'textSecondary';
  const minutes = table.order_created_at ? minutesSince(table.order_created_at, now) : null;

  const label = taken
    ? `${table.label}, taken by ${table.locked_by_name}`
    : `${table.label}, ${table.status === 'free' ? 'free' : status.label}${mine ? ', mine' : ''}`;

  return (
    <Animated.View style={{ transform: [{ translateX: shake }] }}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          minHeight: 112,
          padding: t.d.pad - 4,
          justifyContent: 'space-between',
          borderRadius: t.radius.card,
          borderWidth: t.borderWidth,
          borderColor: border,
          backgroundColor: pressed && !taken ? t.c.pressed : fill,
          opacity: taken ? 0.4 : 1, // locked by another waiter
          transform: [{ scale: pressed && !taken ? 0.98 : 1 }],
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Txt size={22} weight={700} tabular>
            {table.label}
          </Txt>
          {busy ? (
            <ActivityIndicator size="small" color={t.c.primary} />
          ) : taken ? (
            <Icon name="lock-outline" size={18} color="textSecondary" />
          ) : mine ? (
            <Chip label="MINE" tone="primary" size={10} />
          ) : null}
        </View>

        <Txt size={12} color="textSecondary" tabular>
          {table.seats}p{minutes === null ? '' : ` · ${minutes}m`}
        </Txt>

        {taken ? (
          <Txt size={12} weight={600} color="textSecondary" numberOfLines={1}>
            {table.locked_by_name}
          </Txt>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {status.icon && table.status !== 'free' ? <Icon name={status.icon} size={14} color={tone} /> : null}
            <Txt size={12} weight={600} color={table.status === 'free' ? 'text' : tone} numberOfLines={1}>
              {status.label}
            </Txt>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
