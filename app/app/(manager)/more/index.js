import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useAuth } from '../../../src/store/auth';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { IconTile } from '../../../src/components/Picture';
import { EmptyState } from '../../../src/components/EmptyState';

// The places under More. Each is shown to the people who may use it.
const ENTRIES = [
  { path: '/more/tables', title: 'Tables', text: 'Dining areas and their tables', icon: 'table-furniture', tone: 'primary', needs: ['tables.manage'] },
  { path: '/more/kitchens', title: 'Kitchens', text: 'Each kitchen, its dishes and its chefs', icon: 'chef-hat', tone: 'success', needs: ['tables.manage', 'menu.manage', 'staff.manage'] },
  { path: '/more/menu', title: 'Menu', text: 'Manage food items, categories and add-ons', icon: 'silverware-fork-knife', tone: 'error', needs: ['menu.manage'] },
  { path: '/more/staff', title: 'Staff', text: 'Manage users, roles and permissions', icon: 'account-group', tone: 'neutral', needs: ['staff.view', 'staff.manage'] },
  { path: '/more/reports', title: 'Reports', text: 'Sales, menu, orders and staff numbers', icon: 'chart-bar', tone: 'success', needs: ['reports.view'] },
  { path: '/more/settings', title: 'Settings', text: 'Store, billing, printers and preferences', icon: 'cog', tone: 'warning', needs: [] },
];

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const permissions = useAuth((s) => s.user?.permissions) ?? {};
  const shown = ENTRIES.filter((e) => e.needs.length === 0 || e.needs.some((p) => permissions[p]));

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="More" />}>
      <View style={{ gap: 12 }}>
        {shown.length === 0 ? <EmptyState icon="dots-horizontal" title="Nothing here for you" text="Ask an admin if you need access to more." /> : null}
        {shown.map((entry) => (
          <Pressable
            key={entry.path}
            onPress={() => router.push(entry.path)}
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}. ${entry.text}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 16,
              padding: 16,
              borderRadius: t.radius.card,
              borderWidth: t.borderWidth,
              borderColor: t.c.border,
              backgroundColor: pressed ? t.c.primaryTint : t.c.card,
            })}
          >
            <IconTile icon={entry.icon} tone={entry.tone} size={48} solid />
            <View style={{ flex: 1 }}>
              <Txt size={17} weight={700}>
                {entry.title}
              </Txt>
              <Txt size={13} color="textSecondary">
                {entry.text}
              </Txt>
            </View>
            <Icon name="chevron-right" color="textSecondary" />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
