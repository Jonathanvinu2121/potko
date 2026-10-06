import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme';
import { useAuth } from '../store/auth';
import { useConnection } from '../lib/ws';
import { toast } from '../store/toast';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';
import { Button } from './Button';
import { BottomSheet } from './BottomSheet';

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// The header on every signed-in screen: restaurant name with the sync dot, the screen title,
// and the role badge. `back` adds a back arrow (every inner screen has one).
// Tapping the sync dot says whether the app is connected; tapping the badge opens the account menu.
export function AppHeader({ title, back, onBack }) {
  const t = useTheme();
  const router = useRouter();
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
          <Txt size={20} weight={700} numberOfLines={1}>
            {title}
          </Txt>
        </View>

        <Chip label={(user?.role ?? '').toUpperCase()} tone="primary" size={12} onPress={() => setMenuOpen(true)} />
      </View>

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
          title="Customise"
          icon="palette-outline"
          variant="secondary"
          onPress={() => {
            setMenuOpen(false);
            router.push('/customise');
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
