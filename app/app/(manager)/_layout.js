import { useEffect } from 'react';
import { Vibration, useWindowDimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAudioPlayer } from 'expo-audio';
import { useTheme, fonts, breakpoints } from '../../src/theme';
import { useRoleGuard } from '../../src/lib/useRoleGuard';
import { useCan } from '../../src/store/auth';
import { useLive } from '../../src/store/live';
import { useSettings } from '../../src/store/settings';
import { on } from '../../src/lib/ws';
import { toast } from '../../src/store/toast';
import { isOpen, APPROVAL_TYPES } from '../../src/lib/orders';
import { Icon } from '../../src/components/Icon';

// The manager workspace (manager, admin and cashier): four places and no more.
//   Overview              is the restaurant running normally, and what needs me
//   Orders                the floor and every order
//   Payments & Approvals  settling bills, and requests that need the PIN
//   More                  Tables, Menu, Staff, Reports, Settings
// A tab a person has no permission for is not shown (the server refuses it anyway).
export default function ManagerLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const redirect = useRoleGuard('manager', 'admin', 'cashier');
  const seesOverview = useCan('overview.view');
  const decides = useCan('approvals.decide');
  const collects = useCan('payments.collect');
  const pending = useLive((s) => s.approvals.length);
  const bills = useLive((s) => s.orders.filter((o) => isOpen(o) && o.bill_requested_at).length);
  const wide = width >= breakpoints.tablet;
  const chime = useAudioPlayer(require('../../assets/new-order.wav'));

  // A new request needs the manager now, whichever section is open.
  useEffect(() => {
    if (redirect || !decides) return undefined;
    return on('approval.requested', (a) => {
      // Sound and vibration can be switched off on this device (Settings, System Preferences).
      if (useSettings.getState().sound) {
        try {
          chime.seekTo(0);
          chime.play();
        } catch {
          // the toast and the badge still show the request
        }
        Vibration.vibrate(300);
      }
      toast(`${a.requested_by_name} asks: ${APPROVAL_TYPES[a.type]?.label ?? a.type}${a.table_label ? ` on ${a.table_label}` : ''}`, { icon: 'shield-account-outline', duration: 5000 });
    });
  }, [redirect, decides, chime]);

  if (redirect) return <Redirect href={redirect} />;

  const icon = (name) => ({ focused }) => <Icon name={name} size={22} color={focused ? 'primary' : 'textSecondary'} />;
  const badge = (decides ? pending : 0) + (collects ? bills : 0);
  const hidden = { href: null };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: t.c.primary,
        tabBarInactiveTintColor: t.c.textSecondary,
        tabBarActiveBackgroundColor: t.c.primaryTint,
        tabBarItemStyle: wide ? undefined : { borderRadius: t.radius.control, marginHorizontal: 2 },
        tabBarStyle: wide
          ? { minWidth: 230, paddingTop: 12, backgroundColor: t.c.card, borderRightColor: t.c.border, borderRightWidth: t.borderWidth }
          : {
              height: 50 + Math.round(t.size(11) * 1.4) + insets.bottom,
              paddingTop: 6,
              paddingHorizontal: 4,
              backgroundColor: t.c.card,
              borderTopColor: t.c.border,
              borderTopWidth: t.borderWidth,
            },
        tabBarLabelStyle: { fontFamily: fonts[600], fontSize: t.size(wide ? 14 : 11) },
        tabBarBadgeStyle: { backgroundColor: t.c.error, color: t.c.onPrimary, fontFamily: fonts[700] },
        sceneStyle: { backgroundColor: t.c.background },
      }}
    >
      <Tabs.Screen name="overview" options={{ title: 'Overview', tabBarIcon: icon('home-outline'), ...(seesOverview ? {} : hidden) }} />
      <Tabs.Screen name="orders" options={{ title: 'Tables', tabBarIcon: icon('view-grid-outline') }} />
      <Tabs.Screen
        name="payments"
        options={{
          title: wide || width >= 400 ? 'Payments & Approvals' : 'Payments',
          tabBarAccessibilityLabel: 'Payments and Approvals',
          tabBarIcon: icon('cash-register'),
          tabBarBadge: badge > 9 ? '9+' : badge > 0 ? badge : undefined,
          ...(collects || decides ? {} : hidden),
        }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('dots-horizontal') }} />
    </Tabs>
  );
}
