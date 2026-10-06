import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useDraft, totals } from '../../../src/store/draft';
import { orderLabel } from '../../../src/lib/format';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';

const TYPES = [
  { type: 'dine_in', title: 'Dine-in', text: 'Choose a table', icon: 'silverware-fork-knife' },
  { type: 'delivery', title: 'Delivery', text: 'Customer and delivery details', icon: 'moped-outline' },
  { type: 'takeaway', title: 'Takeaway (In-car)', text: 'Identify the car at pickup', icon: 'car-outline' },
];

// W1 Order type: three big cards.
export default function OrderType() {
  const t = useTheme();
  const router = useRouter();
  const draft = useDraft();
  const { count } = totals(draft.lines);

  // Dine-in starts its order on the Tables screen, once a table is locked.
  const choose = (type) => {
    if (type === 'dine_in') return router.push('/new-order/tables');
    draft.start(type);
    router.push({ pathname: '/new-order/details', params: { type } });
  };

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="New order" />}>
      <Txt size={22} weight={700} style={{ marginBottom: 16 }}>
        How will they order?
      </Txt>

      <View style={{ gap: t.d.gap }}>
        {TYPES.map((option) => (
          <Pressable
            key={option.type}
            onPress={() => choose(option.type)}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            style={({ pressed }) => [
              {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                minHeight: 96,
                padding: t.d.pad,
                borderRadius: t.radius.card,
                borderWidth: t.borderWidth,
                borderColor: t.c.border,
                backgroundColor: pressed ? t.c.pressed : t.c.card,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
              t.shadow,
            ]}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: t.radius.control,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.c.primaryTint,
              }}
            >
              <Icon name={option.icon} size={26} color="primary" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt size={20} weight={700}>
                {option.title}
              </Txt>
              <Txt size={13} color="textSecondary">
                {option.text}
              </Txt>
            </View>
            <Icon name="chevron-right" color="textSecondary" />
          </Pressable>
        ))}
      </View>

      {/* An order that was started but not sent can be picked up again. */}
      {count > 0 ? (
        <Pressable
          onPress={() => router.push('/new-order/menu')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 48,
            marginTop: 16,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: t.radius.control,
            backgroundColor: t.c.warningTint,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Txt size={13} color="warningText">
            Not sent yet
          </Txt>
          <Txt size={13} weight={700} color="warningText" tabular style={{ flexShrink: 1 }} numberOfLines={1}>
            {draft.addTo ? 'Adding to ' : ''}{orderLabel(draft)} · {count} {count === 1 ? 'item' : 'items'} — continue
          </Txt>
        </Pressable>
      ) : null}
    </Screen>
  );
}
