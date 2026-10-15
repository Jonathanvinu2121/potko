import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Redirect, useIsFocused, useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { ROLES, roleInfo, homeFor } from '../../src/lib/roles';
import { useServer } from '../../src/lib/server';
import { api } from '../../src/lib/api';
import { ROLE_LABEL, ROLE_ICON } from '../../src/lib/roles';
import { toast } from '../../src/store/toast';
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
  const [dev, setDev] = useState(null); // developer mode: the people who can be signed in as with one tap
  const [devBusy, setDevBusy] = useState(null);

  // Developer mode exists only on a test server on the developer's own computer; everywhere else
  // the server answers "off" and nothing extra is shown.
  useEffect(() => {
    let current = true;
    setDev(null);
    api('/auth/dev', { timeout: 6000 })
      .then((r) => current && setDev(r.enabled ? r.users : null))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [server]);

  // A server with no restaurant yet (just handed over) opens the first-run set-up instead.
  useEffect(() => {
    let current = true;
    api('/auth/setup', { timeout: 75000 })
      .then((r) => current && r.needed && router.replace('/setup'))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [server, router]);

  const devSignIn = async (person) => {
    setDevBusy(person.id);
    try {
      await useAuth.getState().devLogin(person.id);
      toast(`Signed in as ${person.name}`);
      router.replace(homeFor(person.role));
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error' });
    } finally {
      setDevBusy(null);
    }
  };

  // Someone already signed in who lands here (the back button, an old link) goes to their home.
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

      {dev ? (
        <View style={{ marginTop: 24, gap: 8, padding: t.d.pad, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.warning, backgroundColor: t.c.warningTint }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="bug-outline" size={18} color="warningText" />
            <Txt size={14} weight={700} color="warningText" style={{ flex: 1 }}>
              Developer mode
            </Txt>
          </View>
          <Txt size={12} color="warningText">
            Tap a person to sign in without a password. Only on this test server.
          </Txt>
          <View style={{ gap: 8, marginTop: 4 }}>
            {dev.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => devSignIn(person)}
                disabled={!!devBusy}
                accessibilityRole="button"
                accessibilityLabel={`Sign in as ${person.name}, ${ROLE_LABEL[person.role]}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 48,
                  paddingHorizontal: 12,
                  borderRadius: t.radius.control,
                  borderWidth: t.borderWidth,
                  borderColor: t.c.border,
                  backgroundColor: pressed ? t.c.pressed : t.c.card,
                  opacity: devBusy && devBusy !== person.id ? 0.5 : 1,
                })}
              >
                <Icon name={ROLE_ICON[person.role]} size={20} color="textSecondary" />
                <Txt size={15} weight={600} numberOfLines={1} style={{ flex: 1 }}>
                  {person.name}
                </Txt>
                <Txt size={12} color="textSecondary">
                  {ROLE_LABEL[person.role]} · {person.login_id}
                </Txt>
                <Icon name={devBusy === person.id ? 'loading' : 'chevron-right'} size={20} color="textSecondary" />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

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
