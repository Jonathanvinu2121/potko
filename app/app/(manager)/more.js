import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/store/auth';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Row } from '../../src/components/Bits';

// More (phone only): the sections that do not fit in the bottom bar.
// On a tablet or desktop they are all in the sidebar instead.
export default function More() {
  const router = useRouter();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const links = [
    { title: 'Tables', subtitle: 'The floor, live. Add or rename tables', icon: 'table-furniture', href: '/tables' },
    { title: 'Menu', subtitle: 'Dishes, prices, out of stock', icon: 'silverware-fork-knife', href: '/menu' },
    { title: 'Staff', subtitle: isAdmin ? 'People, roles, discount limits, login codes' : 'People and login codes', icon: 'account-group-outline', href: '/staff' },
    { title: 'Reports', subtitle: 'Daily sales, top dishes, cancels and discounts', icon: 'chart-box-outline', href: '/reports' },
    isAdmin ? { title: 'Audit log', subtitle: 'Every sensitive action, with who and when', icon: 'history', href: '/audit' } : null,
    { title: 'Settings', subtitle: 'Your PIN, the look of this device, sign out', icon: 'cog-outline', href: '/settings' },
  ].filter(Boolean);

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="More" />}>
      <View style={{ gap: 8 }}>
        {links.map((link) => (
          <Row key={link.href} title={link.title} subtitle={link.subtitle} icon={link.icon} onPress={() => router.push(link.href)} />
        ))}
      </View>
    </Screen>
  );
}
