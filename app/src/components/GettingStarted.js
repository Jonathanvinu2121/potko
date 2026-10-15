import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { useAuth, useCan } from '../store/auth';
import { api } from '../lib/api';
import { Txt } from './Txt';
import { Icon } from './Icon';

// The four things a new restaurant sets up, each ticked as soon as it is done (read from the
// server each time the Overview opens):
//   key        what the server counts (GET /me/getting-started)
//   needs      the permission that may do it
const STEPS = [
  { key: 'tables', title: 'Add your tables', text: 'More › Tables: dining areas and their tables', href: '/more/tables', needs: 'tables.manage' },
  { key: 'dishes', title: 'Add your menu', text: 'More › Menu: categories and dishes, by hand or from a file', href: '/more/menu', needs: 'menu.manage' },
  { key: 'waiters', title: 'Add your waiters', text: 'More › Staff: each waiter with their areas and tables', href: '/more/staff', needs: 'staff.manage' },
  { key: 'chefs', title: 'Give the kitchens their chefs', text: 'More › Kitchens: name each kitchen, its dishes and chefs', href: '/more/kitchens', needs: 'staff.manage' },
];
const hiddenKey = (restaurantId) => `potko.gettingStarted.hidden.${restaurantId}`;

// The Getting started card on the admin's and manager's Overview. It disappears once every step
// is done, or when it is hidden.
export function GettingStarted() {
  const t = useTheme();
  const router = useRouter();
  const restaurantId = useAuth((s) => s.restaurant?.id);
  const can = {
    'tables.manage': useCan('tables.manage'),
    'menu.manage': useCan('menu.manage'),
    'staff.manage': useCan('staff.manage'),
  };
  const [counts, setCounts] = useState(null);
  const [hidden, setHidden] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      AsyncStorage.getItem(hiddenKey(restaurantId))
        .then((v) => current && setHidden(v === '1'))
        .catch(() => current && setHidden(false));
      api('/me/getting-started')
        .then((c) => current && setCounts(c))
        .catch(() => {});
      return () => {
        current = false;
      };
    }, [restaurantId])
  );

  const steps = STEPS.filter((s) => can[s.needs]);
  if (!counts || hidden || steps.length === 0) return null;
  const done = steps.filter((s) => counts[s.key] > 0).length;
  if (done === steps.length) return null;

  const hide = () => {
    setHidden(true);
    AsyncStorage.setItem(hiddenKey(restaurantId), '1').catch(() => {});
  };

  return (
    <View style={{ gap: 4, padding: 16, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt size={17} weight={700} style={{ flex: 1 }}>
          Getting started
        </Txt>
        <Txt size={13} color="textSecondary" tabular>
          {done} of {steps.length} done
        </Txt>
      </View>
      <View style={{ height: 6, borderRadius: t.radius.pill, backgroundColor: t.c.border, overflow: 'hidden', marginVertical: 6 }}>
        <View style={{ width: `${(done / steps.length) * 100}%`, height: 6, backgroundColor: t.c.primary }} />
      </View>
      {steps.map((s) => {
        const ok = counts[s.key] > 0;
        return (
          <Pressable
            key={s.key}
            onPress={() => router.push(s.href)}
            accessibilityRole="button"
            accessibilityLabel={`${s.title}${ok ? ', done' : ''}. Open`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name={ok ? 'check-circle' : 'checkbox-blank-circle-outline'} size={22} color={ok ? 'success' : 'textSecondary'} />
            <View style={{ flex: 1 }}>
              <Txt size={15} weight={600} style={ok ? { textDecorationLine: 'line-through' } : null} color={ok ? 'textSecondary' : 'text'}>
                {s.title}
              </Txt>
              <Txt size={12} color="textSecondary">
                {s.text}
              </Txt>
            </View>
            <Icon name="chevron-right" color="textSecondary" />
          </Pressable>
        );
      })}
      <Pressable onPress={hide} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
        <Txt size={13} color="textSecondary" style={{ textDecorationLine: 'underline' }}>
          Hide this
        </Txt>
      </Pressable>
    </View>
  );
}
