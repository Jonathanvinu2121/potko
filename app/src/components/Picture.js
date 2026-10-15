import { Image, Platform, View } from 'react-native';
import { useTheme } from '../theme';
import { authHeader, fileUrl } from '../lib/api';
import { serverUrl } from '../lib/server';
import { initials } from '../lib/format';
import { Txt } from './Txt';
import { Icon } from './Icon';

// Where a saved picture is loaded from. Phones send the login in a header; a browser cannot,
// so there it travels in the address.
export const pictureSource = (imageId) =>
  Platform.OS === 'web' ? { uri: fileUrl(`/images/${imageId}`) } : { uri: `${serverUrl()}/images/${imageId}`, headers: authHeader() };

// A square picture of a dish, category or area, or a quiet icon tile when there is none.
export function Picture({ imageId, icon = 'image-outline', size = 48, radius, tone = 'primary', style }) {
  const t = useTheme();
  const r = radius ?? Math.round(size / 4);
  if (imageId) {
    return <Image source={pictureSource(imageId)} style={[{ width: size, height: size, borderRadius: r, backgroundColor: t.c.pressed }, style]} accessibilityIgnoresInvertColors />;
  }
  const colours = { primary: ['primaryTint', 'primary'], success: ['successTint', 'successText'], warning: ['warningTint', 'warningText'], error: ['errorTint', 'error'], neutral: ['pressed', 'textSecondary'] }[tone];
  return (
    <View style={[{ width: size, height: size, borderRadius: r, backgroundColor: t.c[colours[0]], alignItems: 'center', justifyContent: 'center' }, style]}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={colours[1]} />
    </View>
  );
}

const TONES = ['primary', 'success', 'warning', 'error', 'neutral'];

// A person: their photo, or their initials on a tint picked from their name (so it stays the same).
export function Avatar({ name = '', imageId, size = 40 }) {
  const t = useTheme();
  if (imageId) return <Image source={pictureSource(imageId)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.c.pressed }} />;
  const tone = TONES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % TONES.length];
  const colours = { primary: ['primaryTint', 'primary'], success: ['successTint', 'successText'], warning: ['warningTint', 'warningText'], error: ['errorTint', 'error'], neutral: ['pressed', 'textSecondary'] }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.c[colours[0]], alignItems: 'center', justifyContent: 'center' }}>
      <Txt size={Math.round(size * 0.38)} weight={700} color={colours[1]}>
        {initials(name)}
      </Txt>
    </View>
  );
}

// A coloured rounded square with an icon: the entries on More, attention rows, settings groups.
export function IconTile({ icon, tone = 'primary', size = 44, solid }) {
  const t = useTheme();
  const colours = { primary: ['primaryTint', 'primary'], success: ['successTint', 'successText'], warning: ['warningTint', 'warningText'], error: ['errorTint', 'error'], neutral: ['pressed', 'textSecondary'] }[tone];
  const solidBg = { primary: 'primary', success: 'success', warning: 'warning', error: 'error', neutral: 'textSecondary' }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: t.c[solid ? solidBg : colours[0]], alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={Math.round(size * 0.52)} color={solid ? 'onPrimary' : colours[1]} />
    </View>
  );
}
