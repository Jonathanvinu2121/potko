import { View } from 'react-native';
import { useTheme } from '../theme';

export function Card({ children, style }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.c.card,
          borderRadius: t.radius.card,
          borderWidth: t.borderWidth,
          borderColor: t.c.border,
          padding: t.d.pad,
        },
        t.shadow,
        style,
      ]}
    >
      {children}
    </View>
  );
}
