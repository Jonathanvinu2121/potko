import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme';

// One icon set for the whole app. Colour is a token name.
export function Icon({ name, size = 22, color = 'text', style }) {
  const t = useTheme();
  return <MaterialCommunityIcons name={name} size={size} color={t.c[color]} style={style} />;
}
