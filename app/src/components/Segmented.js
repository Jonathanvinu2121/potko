import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';

// A row of equal-width choices where exactly one is selected, e.g. Font size S / M / L.
// options: [{ value, label }]
export function Segmented({ label, options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Txt size={13} weight={600}>
          {label}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              aria-checked={selected}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: t.d.control,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: t.radius.control,
                borderWidth: t.borderWidth,
                borderColor: selected ? t.c.primary : t.c.border,
                backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Txt size={13} weight={600} color={selected ? 'primary' : 'text'} center numberOfLines={1}>
                {option.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
