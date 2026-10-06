import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { useSettings, DEFAULTS } from '../../src/store/settings';
import { homeFor } from '../../src/lib/roles';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { Segmented } from '../../src/components/Segmented';

const FONT_SIZES = [
  { value: 'S', label: 'S' },
  { value: 'M', label: 'M' },
  { value: 'L', label: 'L' },
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

// S3 Customise: font size, theme and layout density, applied to the whole app as you tap.
// Shown once after the first sign-in on a device (?first=1) and later from the account menu.
export default function Customise() {
  const t = useTheme();
  const router = useRouter();
  const first = useLocalSearchParams().first === '1';
  const user = useAuth((s) => s.user);
  const { fontSize, theme, density, preview } = useSettings();
  const [saving, setSaving] = useState(false);
  // What was in use when the screen opened, so leaving without saving puts it back.
  const before = useRef({ fontSize, theme, density }).current;

  if (!user) return <Redirect href="/role" />;

  const leave = () => (first ? router.replace(homeFor(user.role)) : router.back());

  const save = async (message) => {
    setSaving(true);
    try {
      await useSettings.getState().save(user.id);
      toast(message);
    } catch {
      toast('Could not save on this device. Your choices apply until you sign out.', { icon: 'alert-circle-outline', tone: 'error' });
    }
    setSaving(false);
    leave();
  };

  return (
    <Screen
      narrow={first}
      header={
        first ? null : (
          <AppHeader
            title="Customise"
            back
            onBack={() => {
              preview(before);
              router.back();
            }}
          />
        )
      }
      footer={
        <View style={{ gap: 4 }}>
          <Button title={first ? 'Save & Continue' : 'Save'} loading={saving} onPress={() => save('Your look is saved')} />
          {first ? (
            <Button
              title="Skip for now"
              variant="link"
              disabled={saving}
              onPress={() => {
                preview(DEFAULTS);
                save('Using the standard look');
              }}
            />
          ) : null}
        </View>
      }
    >
      {first ? (
        <Txt size={26} weight={700}>
          Make POTKO yours
        </Txt>
      ) : null}
      <Txt color="textSecondary" style={{ marginTop: first ? 4 : 0, marginBottom: 16 }}>
        Choose a comfortable setup. You can update this anytime.
      </Txt>

      <View style={{ gap: 16 }}>
        <Segmented label="Font size" options={FONT_SIZES} value={fontSize} onChange={(v) => preview({ fontSize: v })} />
        <Segmented label="Theme" options={THEMES} value={theme} onChange={(v) => preview({ theme: v })} />
        <Segmented label="Layout density" options={DENSITIES} value={density} onChange={(v) => preview({ density: v })} />

        <Card style={{ gap: t.d.gap }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt size={12} weight={600} color="textSecondary">
              LIVE PREVIEW
            </Txt>
            <Chip label="Table 8" tone="success" />
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
