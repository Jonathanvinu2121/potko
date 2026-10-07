import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Redirect, useIsFocused, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { ROLES, roleInfo, homeFor } from '../../src/lib/roles';
import { useServer } from '../../src/lib/server';
import { ServerSheet } from '../../src/components/ServerSheet';
import { Screen } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Icon } from '../../src/components/Icon';
import { Button } from '../../src/components/Button';

// S1 Role select: tap one of four cards, then Continue.
export default function RoleSelect() {
  const t = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const [selected, setSelected] = useState(null);
  const [serverOpen, setServerOpen] = useState(false);
  const server = useServer((s) => s.url);
  const focused = useIsFocused();

  // Someone already signed in who lands here (the back button, an old link) goes to their home.
  // Only while this screen is the one in front: right after signing in it is still underneath the
  // Customise screen, and must not pull the user away from it.
  if (user && focused) return <Redirect href={homeFor(user.role)} />;

  return (
    <Screen
      narrow
      footer={
        <View style={{ gap: 8 }}>
          <Button
            title={selected ? `Continue as ${roleInfo(selected).label}` : 'Continue'}
            disabled={!selected}
            onPress={() => router.push({ pathname: '/login', params: { role: selected } })}
          />
          <Txt size={12} color="textSecondary" center>
            You can switch roles after signing out
          </Txt>
        </View>
      }
    >
      <Image
        source={require('../../assets/logo.png')}
        accessibilityRole="image"
        accessibilityLabel="POTKO logo"
        style={{ width: 64, height: 64, marginBottom: 16 }}
      />
      <Txt size={26} weight={700}>
        Welcome to POTKO
      </Txt>
      <Txt color="textSecondary" style={{ marginTop: 4, marginBottom: 16 }}>
        Select how you’ll use the restaurant workspace today.
      </Txt>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.d.gap }} accessibilityRole="radiogroup">
        {ROLES.map((role) => {
          const active = role.key === selected;
          return (
            <Pressable
              key={role.key}
              onPress={() => setSelected(role.key)}
              accessibilityRole="radio"
              aria-checked={active}
              accessibilityLabel={role.label}
              style={({ pressed }) => [
                {
                  flexBasis: '45%',
                  flexGrow: 1,
                  minHeight: 132,
                  justifyContent: 'space-between',
                  padding: t.d.pad,
                  borderRadius: t.radius.card,
                  borderWidth: active ? 2 : t.borderWidth,
                  borderColor: active ? t.c.primary : t.c.border,
                  backgroundColor: active ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
                t.shadow,
              ]}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: t.radius.control,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? t.c.primary : t.c.background,
                }}
              >
                <Icon name={role.icon} color={active ? 'onPrimary' : 'textSecondary'} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Txt size={17} weight={700}>
                  {role.label}
                </Txt>
                {active ? <Icon name="check-circle-outline" size={20} color="primary" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Which server this device talks to. Small on purpose: it is set once, when the app is installed. */}
      <Pressable
        onPress={() => setServerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Server address"
        style={({ pressed }) => ({
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          marginTop: 12,
          paddingHorizontal: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name="server-network" size={16} color="textSecondary" />
        <Txt size={12} color="textSecondary" numberOfLines={1}>
          Server: {server.replace(/^https?:\/\//, '')}
        </Txt>
      </Pressable>
      <ServerSheet visible={serverOpen} onClose={() => setServerOpen(false)} />
    </Screen>
  );
}
