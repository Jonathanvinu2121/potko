import { Text } from 'react-native';
import { useTheme, fonts } from '../theme';

// All text in the app. Size follows the user's font-size setting; colour is a token name.
// `tabular` keeps digits the same width: use it for quantities, prices, timers and table numbers.
export function Txt({ size = 15, weight = 400, color = 'text', italic, tabular, center, style, ...rest }) {
  const t = useTheme();
  const fontSize = t.size(size);
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: italic ? fonts.italic : fonts[weight], fontSize, lineHeight: Math.round(fontSize * 1.35), color: t.c[color] },
        tabular && { fontVariant: ['tabular-nums'] },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}
