import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { useSettings } from '../../src/store/settings';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { Segmented } from '../../src/components/Segmented';
import { SwitchRow } from '../../src/components/Forms';

const FONT_SIZES = [
  { value: 'S', label: 'Small' },
  { value: 'M', label: 'Medium' },
  { value: 'L', label: 'Large' },
];
const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
];
const DENSITIES = [
  { value: 'compact', label: 'Compact' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

// Settings for a waiter or a chef, opened from the account menu: text size, theme, layout density
// and sound, applied to the whole app as they are tapped and kept for this person on this device.
// (The office has its full Settings under More. The app's colours are fixed.)
export default function MySettings() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const { fontSize, theme, density, sound, preview } = useSettings();
  const [saving, setSaving] = useState(false);
  // What was in use when the screen opened, so leaving without saving puts it back.
  const before = useRef({ fontSize, theme, density, sound }).current;
  const changed = fontSize !== before.fontSize || theme !== before.theme || density !== before.density || sound !== before.sound;

  if (!user) return <Redirect href="/role" />;

  const save = async () => {
    setSaving(true);
    try {
      await useSettings.getState().save(user.id);
      toast('Settings saved', { tone: 'success' });
    } catch {
      toast('Could not save on this device. Your choices apply until you sign out.', { icon: 'alert-circle-outline', tone: 'error' });
    }
    setSaving(false);
    router.back();
  };

  return (
    <Screen
      narrow
      header={
        <AppHeader
          title="Settings"
          subtitle="How the app looks and sounds on this device"
          back
          onBack={() => {
            preview(before);
            router.back();
          }}
        />
      }
      footer={<Button title="Save" disabled={!changed} loading={saving} onPress={save} />}
    >
      <View style={{ gap: 24 }}>
        <Segmented label="Text size" options={FONT_SIZES} value={fontSize} onChange={(v) => preview({ fontSize: v })} />
        <Segmented label="Theme" options={THEMES} value={theme} onChange={(v) => preview({ theme: v })} />
        <Segmented label="Layout density" options={DENSITIES} value={density} onChange={(v) => preview({ density: v })} />
        <SwitchRow icon="bell-ring-outline" title="Sound and vibration" text="When something new needs you" value={sound} onChange={(v) => preview({ sound: v })} />

        <Card style={{ gap: t.d.gap }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={12} weight={600} color="textSecondary" style={{ letterSpacing: 1 }}>
              PREVIEW
            </Txt>
            <Chip label="Table 8" tone="primary" />
          </View>
          <Txt size={17} weight={600} tabular>
            2 × Paneer tikka
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={13} color="textSecondary" tabular>
              No onion · 12m
            </Txt>
            <Chip label="Ready" icon="check-circle-outline" tone="success" />
          </View>
        </Card>
      </View>
    </Screen>
  );
}
