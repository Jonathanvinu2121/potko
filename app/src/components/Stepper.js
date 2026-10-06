import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

// Quantity control: [−] 2 [+]
//   compact  a narrower version for rows where the dish name needs the room (still 44px tall)
export function Stepper({ value, onChange, min = 1, max = 99, compact }) {
  const t = useTheme();
  const side = compact ? 44 : Math.max(44, t.d.control);
  const across = compact ? 36 : side;

  const button = (icon, next, label) => {
    const disabled = next < min || next > max;
    return (
      <Pressable
        onPress={() => onChange(next)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-disabled={disabled}
        hitSlop={compact ? 4 : 0}
        style={({ pressed }) => ({
          width: across,
          height: side,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? t.c.primaryTint : 'transparent',
          opacity: disabled ? 0.35 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <Icon name={icon} size={20} color="primary" />
      </Pressable>
    );
  };

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          borderRadius: t.radius.control,
          borderWidth: t.borderWidth,
          borderColor: t.c.border,
          backgroundColor: t.c.card,
          overflow: 'hidden',
        },
        compact && t.shadow, // floats slightly, like the one in a food-delivery cart
      ]}
    >
      {button('minus', value - 1, 'One less')}
      <Txt size={compact ? 15 : 17} weight={700} tabular center style={{ minWidth: compact ? 24 : 36 }} accessibilityLabel={`Quantity ${value}`}>
        {value}
      </Txt>
      {button('plus', value + 1, 'One more')}
    </View>
  );
}
