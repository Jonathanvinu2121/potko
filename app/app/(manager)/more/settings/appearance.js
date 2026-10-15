import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth } from '../../../../src/store/auth';
import { useSettings } from '../../../../src/store/settings';
import { toast } from '../../../../src/store/toast';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { Segmented } from '../../../../src/components/Segmented';
import { Notice } from '../../../../src/components/Feedback';

const THEMES = [
  { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
  { value: 'dark', label: 'Dark', icon: 'weather-night' },
  { value: 'contrast', label: 'High contrast', icon: 'contrast-circle' },
];
const FONT_SIZES = [
  { value: 'S', label: 'Small' },
  { value: 'M', label: 'Medium' },
  { value: 'L', label: 'Large' },
];
const DENSITIES = [
  { value: 'compact', label: 'Compact' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Settings > Appearance: theme, font size and layout density. (The app's colours are fixed.)
// Each choice is applied as it is tapped; Save Changes keeps it for this person on this device.
export default function Appearance() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const { fontSize, theme, density, preview } = useSettings();
  const before = useRef({ fontSize, theme, density }).current;
  const [saving, setSaving] = useState(false);
  const changed = fontSize !== before.fontSize || theme !== before.theme || density !== before.density;

  const save = async () => {
    setSaving(true);
    try {
      await useSettings.getState().save(user.id);
      toast('Your look is saved', { tone: 'success' });
    } catch {
      toast('Could not save on this device. Your choices apply until you sign out.', { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    }
    setSaving(false);
    router.back();
  };
  const leave = () => {
    preview(before); // leaving without saving puts the old look back
    router.back();
  };

  return (
    <Screen
      narrow
      header={<AppHeader title="Appearance" subtitle="Theme, text size and layout" back onBack={leave} />}
      footer={<Button title="Save Changes" disabled={!changed} loading={saving} onPress={save} />}
    >
      <View style={{ gap: 24 }}>
        <View style={{ gap: 8 }}>
          <Txt size={13} weight={600}>
            Theme
          </Txt>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {THEMES.map((option) => {
              const selected = theme === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => preview({ theme: option.value })}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  aria-checked={selected}
                  style={({ pressed }) => ({ flex: 1, gap: 6, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, borderRadius: t.radius.control, borderWidth: selected ? 2 : t.borderWidth, borderColor: selected ? t.c.primary : t.c.border, backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card })}
                >
                  <Icon name={option.icon} color={selected ? 'primary' : 'textSecondary'} />
                  <Txt size={13} weight={600} color={selected ? 'primary' : 'text'} center>
                    {option.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Segmented label="Font size" options={FONT_SIZES} value={fontSize} onChange={(v) => preview({ fontSize: v })} />
        <Segmented label="Layout density" options={DENSITIES} value={density} onChange={(v) => preview({ density: v })} />

        <Card style={{ gap: t.d.gap }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={12} weight={600} color="textSecondary">
              LIVE PREVIEW
            </Txt>
            <Chip label="Table 8" tone="primary" />
          </View>
          <Txt size={17} weight={600} tabular>
            2 × Paneer tikka
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Chip label="Ready" icon="check-circle-outline" tone="success" />
            <Button title="Send to Kitchen" onPress={() => {}} />
          </View>
        </Card>
        <Txt size={12} color="textSecondary">
          These choices are yours on this device. The restaurant's logo is set under Restaurant Profile.
        </Txt>
      </View>
    </Screen>
  );
}
