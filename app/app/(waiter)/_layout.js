import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../../src/theme';
import { useRoleGuard } from '../../src/lib/useRoleGuard';
import { Icon } from '../../src/components/Icon';
import { useLive } from '../../src/store/live';
import { on } from '../../src/lib/ws';
import { toast } from '../../src/store/toast';
import { isOpen, handedOver, unavailableItems } from '../../src/lib/orders';
import { approvalShort } from '../../src/lib/approvals';

// Waiter: a bottom bar with exactly three tabs.
export default function WaiterLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const redirect = useRoleGuard('waiter');
  const readyCount = useLive((s) => s.readyCount);
  // An order with a dish the kitchen can't make needs the waiter: Replace or Remove.
  const alerts = useLive((s) => s.orders.filter((o) => isOpen(o) && !handedOver(o) && unavailableItems(o).length > 0).length);

  // The kitchen can't make something: tell the waiter at once, whichever tab is open.
  useEffect(() => {
    if (redirect) return;
    const stopDenied = on('chef.denied', ({ unavailable, reason }) =>
      toast(`Kitchen can’t make ${unavailable} ${unavailable === 1 ? 'item' : 'items'} · ${reason}`, { icon: 'alert-outline', tone: 'error', duration: 5000 })
    );
    // The manager's answer to a cancel, void, discount or refund request arrives the moment it is given.
    const stopDecided = on('approval.decided', (a) => {
      const what = approvalShort(a);
      const why = a.decision_reason || a.payload?.decision_reason ? ` · ${a.decision_reason || a.payload.decision_reason}` : '';
      if (a.status === 'approved') toast(`${what} approved by ${a.decided_by_name}`, { tone: 'success', duration: 5000 });
      else toast(`${what} rejected by ${a.decided_by_name}${why}`, { icon: 'close-circle-outline', tone: 'error', duration: 5000 });
    });
    return () => {
      stopDenied();
      stopDecided();
    };
  }, [redirect]);

  if (redirect) return <Redirect href={redirect} />;

  const icon = (name) => ({ focused }) => <Icon name={name} size={24} color={focused ? 'primary' : 'textSecondary'} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.c.primary,
        tabBarInactiveTintColor: t.c.textSecondary,
        // Tall enough for icon and label at every font size, plus the phone's home-bar inset.
        tabBarStyle: {
          height: 46 + Math.round(t.size(12) * 1.4) + insets.bottom,
          paddingTop: 6,
          backgroundColor: t.c.card,
          borderTopColor: t.c.border,
          borderTopWidth: t.borderWidth,
        },
        tabBarLabelStyle: { fontFamily: fonts[600], fontSize: t.size(12) },
        tabBarBadgeStyle: { backgroundColor: t.c.error, color: t.c.onPrimary, fontFamily: fonts[700] },
        sceneStyle: { backgroundColor: t.c.background },
      }}
    >
      <Tabs.Screen name="new-order" options={{ title: '+ New Order', tabBarIcon: icon('plus-circle-outline') }} />
      {/* Red badge while an unavailable-item alert is waiting. */}
      <Tabs.Screen
        name="given-orders"
        options={{ title: 'Given Orders', tabBarIcon: icon('receipt-text-outline'), tabBarBadge: alerts > 0 ? alerts : undefined }}
      />
      {/* Red count = items ready to deliver. Hidden at 0, "9+" above 9. */}
      <Tabs.Screen
        name="ready"
        options={{
          title: 'Ready',
          tabBarIcon: icon('check-circle-outline'),
          tabBarBadge: readyCount > 9 ? '9+' : readyCount > 0 ? readyCount : undefined,
        }}
      />
    </Tabs>
  );
}
