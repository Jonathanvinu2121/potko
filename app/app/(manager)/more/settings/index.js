import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useTheme } from '../../../../src/theme';
import { useAuth } from '../../../../src/store/auth';
import { toast } from '../../../../src/store/toast';
import { ROLE_LABEL } from '../../../../src/lib/roles';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Button } from '../../../../src/components/Button';
import { ActionRow } from '../../../../src/components/Lists';
import { Avatar } from '../../../../src/components/Picture';

// The six groups of Settings. Tables, Menu, Staff, Reports and Approvals have their own places
// and are not repeated here.
const GROUPS = [
  { path: 'profile', title: 'Restaurant Profile', text: 'Name, logo, address and contact', icon: 'storefront-outline', tone: 'primary' },
  { path: 'appearance', title: 'Appearance & Customization', text: 'Theme, colour, font size and layout', icon: 'palette-outline', tone: 'success' },
  { path: 'pin', title: 'Manager PIN', text: 'Set or change your approval PIN', icon: 'lock-outline', tone: 'primary', needs: ['approvals.decide', 'refunds.issue'] },
  { path: 'security', title: 'Account & Security', text: 'Password, signed-in devices, log out everywhere', icon: 'shield-check-outline', tone: 'neutral' },
  { path: 'devices', title: 'POS & Devices', text: 'Printers, payment methods, tax and billing', icon: 'printer-pos-outline', tone: 'warning' },
  { path: 'preferences', title: 'System Preferences', text: 'Sound, service hours and other basics', icon: 'tune-variant', tone: 'neutral' },
];

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [leaving, setLeaving] = useState(false);
  const permissions = user?.permissions ?? {};
  const shown = GROUPS.filter((g) => !g.needs || g.needs.some((p) => permissions[p]));

  const signOut = async () => {
    setLeaving(true);
    await useAuth.getState().logout();
    toast('Signed out', { icon: 'logout' });
  };

  return (
    <Screen header={<AppHeader title="Settings" back />}>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: t.radius.card, backgroundColor: t.c.primaryTint }}>
          <Avatar name={user?.name} imageId={user?.image_id} size={48} />
          <View style={{ flex: 1 }}>
            <Txt size={17} weight={700}>
              {user?.name}
            </Txt>
            <Txt size={13} color="textSecondary">
              {ROLE_LABEL[user?.role]} · {user?.login_id}
            </Txt>
          </View>
        </View>

        <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, paddingVertical: 4 }}>
          {shown.map((group) => (
            <ActionRow key={group.path} icon={group.icon} tone={group.tone} title={group.title} subtitle={group.text} onPress={() => router.push(`/more/settings/${group.path}`)} />
          ))}
        </View>

        <Button title="Sign Out" icon="logout" variant="secondary" loading={leaving} onPress={signOut} />
        <Txt size={12} color="textSecondary" center>
          Sign Out leaves this device only. To leave every device, use Account & Security.{'\n'}POTKO {Constants.expoConfig?.version ?? ''}
        </Txt>
      </View>
    </Screen>
  );
}
