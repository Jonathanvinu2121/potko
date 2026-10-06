import { View } from 'react-native';
import { useTheme } from '../theme';

// The small square-and-dot food mark used on menus: green for veg, red for non-veg.
// It always carries a spoken label, and the item sheet and item row spell it out as a chip.
export function VegMark({ veg, size = 16 }) {
  const t = useTheme();
  const color = veg ? t.c.success : t.c.error;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={veg ? 'Veg' : 'Non-veg'}
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: size * 0.45, height: size * 0.45, borderRadius: t.radius.pill, backgroundColor: color }} />
    </View>
  );
}
