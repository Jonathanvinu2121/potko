import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { useToast, hideToast } from '../store/toast';
import { Txt } from './Txt';
import { Icon } from './Icon';

// Draws the current toast above the bottom bar and the sticky action bar. Mounted once in the root layout.
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const current = useToast((s) => s.current);
  if (!current) return null;

  const success = current.tone === 'success';
  const error = current.tone === 'error';
  const bg = success ? t.c.success : error ? t.c.error : t.c.toast;
  const fg = success || error ? 'onPrimary' : 'onToast';

  return (
    <View
      style={{ pointerEvents: 'box-none', position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 156, alignItems: 'center', paddingHorizontal: t.space.screen }}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          maxWidth: 480,
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderRadius: t.radius.control,
          backgroundColor: bg,
        }}
      >
        <Icon name={current.icon} size={20} color={fg} />
        <Txt size={14} weight={600} color={fg} style={{ flexShrink: 1 }}>
          {current.text}
        </Txt>
        {current.action ? (
          <Pressable
            onPress={() => {
              current.action.onPress();
              hideToast();
            }}
            hitSlop={12}
            accessibilityRole="button"
            style={{ marginLeft: 8 }}
          >
            <Txt size={14} weight={700} color="primary">
              {current.action.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
