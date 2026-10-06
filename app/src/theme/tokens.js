// "Street Feast POS & KOT" design tokens.
// Screens never hardcode a colour, radius or font: they read everything from useTheme().

const light = {
  primary: '#F47C48',
  primaryPressed: '#E06532',
  primaryTint: '#FFF1EA',
  onPrimary: '#FFFFFF',
  success: '#35B779',
  successTint: '#E8F6EE',
  successText: '#1F8A57',
  warning: '#F2B84B',
  warningTint: '#FEF6E4',
  warningText: '#8A5A00',
  error: '#D94A4A',
  errorTint: '#FDECEC',
  text: '#263238',
  textSecondary: '#6B7280',
  background: '#F8F9FA',
  card: '#FFFFFF',
  border: '#E8EAED',
  pressed: '#F1F3F4',
  disabled: '#D1D5DB',
  scrim: 'rgba(38, 50, 56, 0.45)',
  toast: '#1B2428',
  onToast: '#FFFFFF',
  shadow: 'rgba(0, 0, 0, 0.05)',
};

const dark = {
  ...light,
  primaryTint: '#3A251B',
  success: '#4CC98C',
  successTint: '#17352A',
  successText: '#6FD9A5',
  warningTint: '#3A2F14',
  warningText: '#F2C56B',
  error: '#EF6B6B',
  errorTint: '#3D1F1F',
  text: '#ECEFF1',
  textSecondary: '#A3ADB3',
  background: '#12171A',
  card: '#1C2327',
  border: '#2E383D',
  pressed: '#252E33',
  disabled: '#3A444A',
  scrim: 'rgba(0, 0, 0, 0.6)',
  toast: '#ECEFF1',
  onToast: '#12171A',
};

// Same roles, pushed to strong contrast: black text, black borders, darker brand colours.
const contrast = {
  ...light,
  primary: '#B8430F',
  primaryPressed: '#8F3209',
  primaryTint: '#FFE4D6',
  success: '#0B6B3A',
  successTint: '#DDF5E8',
  successText: '#0B6B3A',
  warning: '#7A4D00',
  warningTint: '#FFEFC7',
  warningText: '#7A4D00',
  error: '#A31212',
  errorTint: '#FFE0E0',
  text: '#000000',
  textSecondary: '#1F2933',
  background: '#FFFFFF',
  border: '#000000',
  pressed: '#E5E7EB',
  disabled: '#6B7280',
  scrim: 'rgba(0, 0, 0, 0.7)',
  toast: '#000000',
};

export const palettes = { light, dark, contrast };

// Inter is loaded one file per weight, so weight is chosen by family name.
export const fonts = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
  italic: 'Inter_400Regular_Italic',
};

export const fontScales = { S: 0.9, M: 1, L: 1.15 };

// Base sizes at font size M.
export const typeScale = { display: 26, title: 20, item: 17, body: 15, label: 13, small: 12 };

// Layout density: card padding, gaps, control height and grid columns on a phone.
// The control height never goes below the 44px touch floor.
export const densities = {
  compact: { pad: 12, gap: 8, control: 44, columns: 4 },
  medium: { pad: 16, gap: 12, control: 48, columns: 3 },
  large: { pad: 20, gap: 16, control: 56, columns: 2 },
};

export const radius = { card: 16, control: 12, sheet: 24, pill: 999 };
export const space = { screen: 16 };
export const breakpoints = { tablet: 768, desktop: 1024 };
