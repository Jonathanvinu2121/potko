import { ActivityIndicator, Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

// variant: 'primary' (the one main action on a screen), 'secondary', 'success', 'destructive' or 'link'.
//   label  spoken name for an icon-only button (title left empty)
export function Button({ title, label, onPress, variant = 'primary', icon, disabled, loading, style }) {
  const t = useTheme();
  const blocked = disabled || loading;

  const looks = {
    primary: { bg: t.c.primary, pressedBg: t.c.primaryPressed, fg: 'onPrimary', border: 'transparent' },
    secondary: { bg: t.c.card, pressedBg: t.c.pressed, fg: 'text', border: t.c.border },
    success: { bg: t.c.success, pressedBg: t.c.successText, fg: 'onPrimary', border: 'transparent' },
    destructive: { bg: t.c.error, pressedBg: t.c.error, fg: 'onPrimary', border: 'transparent' },
    link: { bg: 'transparent', pressedBg: t.c.pressed, fg: 'primary', border: 'transparent' },
  }[variant];
  const fg = disabled && variant !== 'link' ? 'onPrimary' : disabled ? 'textSecondary' : looks.fg;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      aria-disabled={!!blocked}
      aria-busy={!!loading}
      style={({ pressed }) => [
        {
          minHeight: t.d.control,
          borderRadius: t.radius.control,
          borderWidth: t.borderWidth,
          borderColor: looks.border,
          backgroundColor: disabled && variant !== 'link' ? t.c.disabled : pressed ? looks.pressedBg : looks.bg,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed ? 0.98 : 1 }],
          opacity: pressed && variant === 'destructive' ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={t.c[fg]} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon ? <Icon name={icon} size={20} color={fg} /> : null}
          {title ? (
            <Txt size={16} weight={600} color={fg}>
              {title}
            </Txt>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
