import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

const TONES = {
  neutral: { bg: 'pressed', fg: 'textSecondary' },
  primary: { bg: 'primaryTint', fg: 'primary' },
  success: { bg: 'successTint', fg: 'successText' },
  warning: { bg: 'warningTint', fg: 'warningText' },
  error: { bg: 'errorTint', fg: 'error' },
};

// A fully rounded label. With onPress it becomes a choice chip; `selected` turns it orange.
// A status chip always carries a label (and usually an icon), never colour alone.
export function Chip({ label, tone = 'neutral', icon, selected, onPress, size = 13, style }) {
  const t = useTheme();
  const look = TONES[selected ? 'primary' : tone];
  const body = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
          backgroundColor: t.c[look.bg],
          borderRadius: t.radius.pill,
          borderWidth: t.borderWidth,
          borderColor: selected ? t.c.primary : t.name === 'contrast' ? t.c.border : 'transparent',
          paddingHorizontal: onPress ? 14 : 10,
          paddingVertical: onPress ? 8 : 4,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={t.size(size) + 2} color={look.fg} /> : null}
      <Txt size={size} weight={600} color={look.fg}>
        {label}
      </Txt>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-pressed={selected === undefined ? undefined : !!selected}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}
