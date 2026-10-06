import { useEffect } from 'react';
import { Vibration, useWindowDimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, breakpoints } from '../../src/theme';
import { useRoleGuard } from '../../src/lib/useRoleGuard';
import { useAuth } from '../../src/store/auth';
import { useLive } from '../../src/store/live';
import { on } from '../../src/lib/ws';
import { toast } from '../../src/store/toast';
import { Icon } from '../../src/components/Icon';

// Manager and admin. Tablet and desktop: a sidebar with every section.
// Phone: a bottom bar with Dashboard, Orders, Approvals and More (the rest are listed under More).
export default function ManagerLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const redirect = useRoleGuard('manager', 'admin');
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const pending = useLive((s) => s.approvals.length);
  const atCounter = useLive((s) => s.orders.filter((o) => o.at_counter && o.status !== 'closed').length);
  const wide = width >= breakpoints.tablet;

  // A new request needs the manager now, whichever section is open.
  useEffect(() => {
    if (redirect) return;
    return on('approval.requested', (a) => {
      Vibration.vibrate(300);
      toast(`${a.requested_by_name} asks: ${a.type === 'cancel' ? `cancel ${a.item_name}` : `${a.payload.pct}% discount`}`, {
        icon: 'shield-account-outline',
        duration: 5000,
      });
    });
  }, [redirect]);

  if (redirect) return <Redirect href={redirect} />;

  const icon = (name) => ({ focused }) => <Icon name={name} size={22} color={focused ? 'primary' : 'textSecondary'} />;
  const badge = pending + atCounter;
  // href: null hides a section's button without removing its screen.
  const onPhone = (visible) => (wide || visible ? {} : { href: null });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: t.c.primary,
        tabBarInactiveTintColor: t.c.textSecondary,
        tabBarActiveBackgroundColor: wide ? t.c.primaryTint : undefined,
        tabBarStyle: wide
          ? { minWidth: 210, paddingTop: 12, backgroundColor: t.c.card, borderRightColor: t.c.border, borderRightWidth: t.borderWidth }
          : {
              height: 46 + Math.round(t.size(12) * 1.4) + insets.bottom,
              paddingTop: 6,
              backgroundColor: t.c.card,
              borderTopColor: t.c.border,
              borderTopWidth: t.borderWidth,
            },
        tabBarLabelStyle: { fontFamily: fonts[600], fontSize: t.size(wide ? 14 : 12) },
        tabBarBadgeStyle: { backgroundColor: t.c.error, color: t.c.onPrimary, fontFamily: fonts[700] },
        sceneStyle: { backgroundColor: t.c.background },
      }}
    >
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard', tabBarIcon: icon('view-dashboard-outline') }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders', tabBarIcon: icon('receipt-text-outline') }} />
      <Tabs.Screen name="tables" options={{ title: 'Tables', tabBarIcon: icon('table-furniture'), ...onPhone(false) }} />
      <Tabs.Screen
        name="approvals"
        options={{ title: 'Approvals', tabBarIcon: icon('shield-account-outline'), tabBarBadge: badge > 9 ? '9+' : badge > 0 ? badge : undefined }}
      />
      <Tabs.Screen name="menu" options={{ title: 'Menu', tabBarIcon: icon('silverware-fork-knife'), ...onPhone(false) }} />
      <Tabs.Screen name="staff" options={{ title: 'Staff', tabBarIcon: icon('account-group-outline'), ...onPhone(false) }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports', tabBarIcon: icon('chart-box-outline'), ...onPhone(false) }} />
      <Tabs.Screen name="audit" options={{ title: 'Audit log', tabBarIcon: icon('history'), ...(isAdmin ? onPhone(false) : { href: null }) }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('cog-outline'), ...onPhone(false) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('dots-horizontal-circle-outline'), ...(wide ? { href: null } : {}) }} />
    </Tabs>
  );
}
