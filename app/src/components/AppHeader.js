import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { useAuth } from '../store/auth';
import { useConnection } from '../lib/ws';
import { toast } from '../store/toast';
import { crumbsFor } from '../lib/crumbs';
import { OFFICE_ROLES } from '../lib/roles';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';
import { Button } from './Button';
import { BottomSheet } from './BottomSheet';

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// The header on every signed-in screen: restaurant name with the sync dot, the screen title,
// and the role badge. `back` adds a back arrow (every inner screen has one).
// Tapping the sync dot says whether the app is connected; tapping the badge opens the account menu.
//   subtitle  a second line under the title (inner screens show it instead of the restaurant name)
//   right     buttons for this screen, shown before the role badge
//   crumbs    the breadcrumb trail [{ label, href }] when the screen knows better than its address;
//             otherwise every inner screen gets one from where it sits (see lib/crumbs)
export function AppHeader({ title, subtitle, back, onBack, right, crumbs }) {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const trail = crumbs ?? (back ? crumbsFor(pathname, title) : null);
  // Back to a screen that is already open underneath, rather than opening it a second time.
  const goTo = (href) => (router.dismissTo ? router.dismissTo(href) : router.navigate(href));
  const user = useAuth((s) => s.user);
  const restaurant = useAuth((s) => s.restaurant);
  const status = useConnection((s) => s.status);
  const lastSync = useConnection((s) => s.lastSync);
  const [menuOpen, setMenuOpen] = useState(false);
  const online = status === 'online';

  const showSync = () =>
    online
      ? toast(`Connected · Last sync ${clock(lastSync)}`, { icon: 'wifi' })
      : toast(lastSync ? `Not connected · Last sync ${clock(lastSync)}` : 'Not connected', { icon: 'wifi-off', tone: 'error' });

  return (
    <View style={{ backgroundColor: t.c.card, borderBottomWidth: t.borderWidth, borderBottomColor: t.c.border }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          maxWidth: 1200,
          alignSelf: 'center',
          paddingHorizontal: t.space.screen,
          paddingVertical: 10,
        }}
      >
        {back ? (
          <Pressable
            onPress={onBack ?? (() => router.back())}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              marginLeft: -10,
              borderRadius: t.radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? t.c.pressed : 'transparent',
            })}
          >
            <Icon name="arrow-left" />
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }}>
          <Pressable
            onPress={showSync}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={online ? 'Connected' : 'Not connected'}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}
          >
            <View style={{ width: 8, height: 8, borderRadius: t.radius.pill, backgroundColor: online ? t.c.success : t.c.error }} />
            <Txt size={12} weight={500} color="textSecondary" numberOfLines={1}>
              {restaurant?.name}
              {online ? '' : status === 'connecting' ? ' · Connecting…' : ' · Offline'}
            </Txt>
          </Pressable>
          <Txt size={20} weight={700} numberOfLines={2}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt size={13} color="textSecondary" numberOfLines={2}>
              {subtitle}
            </Txt>
          ) : null}
        </View>

        {right}
        <Chip label={(user?.role ?? '').toUpperCase()} tone="primary" size={12} onPress={() => setMenuOpen(true)} />
      </View>

      {trail && trail.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel="You are here"
          style={{ width: '100%', maxWidth: 1200, alignSelf: 'center' }}
          contentContainerStyle={{ alignItems: 'center', gap: 2, paddingHorizontal: t.space.screen, paddingBottom: 8 }}
        >
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1;
            return (
              <View key={`${crumb.label}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                {last || !crumb.href ? (
                  <Txt size={12} weight={600} color={last ? 'text' : 'textSecondary'} numberOfLines={1} style={{ maxWidth: 200 }}>
                    {crumb.label}
                  </Txt>
                ) : (
                  <Pressable
                    onPress={() => goTo(crumb.href)}
                    hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                    accessibilityRole="link"
                    accessibilityLabel={`Back to ${crumb.label}`}
                    style={({ pressed }) => ({ minHeight: 24, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
                  >
                    <Txt size={12} weight={600} color="primary" numberOfLines={1} style={{ maxWidth: 160 }}>
                      {crumb.label}
                    </Txt>
                  </Pressable>
                )}
                {last ? null : <Icon name="chevron-right" size={14} color="textSecondary" />}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {!online ? (
        <View
          accessibilityRole="alert"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.c.error, paddingVertical: 8 }}
        >
          <Icon name="wifi-off" size={16} color="onPrimary" />
          <Txt size={13} weight={600} color="onPrimary">
            Reconnecting…
          </Txt>
        </View>
      ) : null}

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={user?.name}>
        <Txt color="textSecondary">
          {user?.login_id} · {restaurant?.name}
        </Txt>
        <Button
          title="Settings"
          icon="cog-outline"
          variant="secondary"
          onPress={() => {
            setMenuOpen(false);
            // The office has its full Settings under More; waiters and chefs get their own short page.
            router.push(OFFICE_ROLES.includes(user?.role) ? '/more/settings' : '/customise');
          }}
        />
        <Button
          title="Sign out"
          icon="logout"
          variant="secondary"
          onPress={async () => {
            setMenuOpen(false);
            await useAuth.getState().logout();
            toast('Signed out', { icon: 'logout' });
          }}
        />
      </BottomSheet>
    </View>
  );
}
