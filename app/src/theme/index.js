import { useMemo } from 'react';
import { useSettings } from '../store/settings';
import { palettes, fontScales, typeScale, densities, radius, space, fonts, breakpoints } from './tokens';

export { fonts, breakpoints };

// Builds the theme for one combination of font size, colour theme and density.
export function makeTheme({ fontSize, theme, density }) {
  const scale = fontScales[fontSize] ?? 1;
  const c = palettes[theme] ?? palettes.light;
  return {
    name: theme,
    c,
    d: densities[density] ?? densities.medium,
    radius,
    space,
    borderWidth: theme === 'contrast' ? 2 : 1,
    size: (px) => Math.round(px * scale),
    type: Object.fromEntries(Object.entries(typeScale).map(([k, px]) => [k, Math.round(px * scale)])),
    shadow: { boxShadow: `0px 2px 6px ${c.shadow}` }, // very light, per the design system
  };
}

// The current theme. Re-renders the caller the moment the user changes a Customise option.
export function useTheme() {
  const fontSize = useSettings((s) => s.fontSize);
  const theme = useSettings((s) => s.theme);
  const density = useSettings((s) => s.density);
  return useMemo(() => makeTheme({ fontSize, theme, density }), [fontSize, theme, density]);
}
