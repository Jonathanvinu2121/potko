import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/store/auth';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { Segmented } from '../../src/components/Segmented';
import { Section, Row } from '../../src/components/Bits';

const PAYMENT = [
  { value: 'waiter', label: 'Waiter takes payment' },
  { value: 'counter', label: 'Waiter or counter' },
];
const OTP_ROLES = [
  { key: 'manager', label: 'Managers' },
  { key: 'chef', label: 'Chefs' },
  { key: 'waiter', label: 'Waiters' },
];

// Settings: this device's look, my approval PIN, and (admin only) the restaurant itself:
// its name, where payment is taken, and which roles need a one-time code to sign in.
export default function Settings() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const restaurant = useAuth((s) => s.restaurant);
  const isAdmin = user?.role === 'admin';
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState(restaurant?.name ?? '');
  const [busy, setBusy] = useState(null);

  // Another admin screen may rename the restaurant: keep the field in step.
  useEffect(() => setName(restaurant?.name ?? ''), [restaurant?.name]);

  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });
  const settings = restaurant?.settings ?? {};
  const otpRoles = settings.otp_roles ?? [];

  const savePin = async () => {
    setBusy('pin');
    try {
      await api('/me/pin', { method: 'POST', body: { password, pin } });
      await useAuth.getState().refresh();
      setPassword('');
      setPin('');
      toast('Approval PIN saved', { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // The server pushes the saved settings back to every screen, this one included.
  const saveRestaurant = async (changes, message) => {
    setBusy('restaurant');
    try {
      await api('/restaurant', { method: 'PATCH', body: changes });
      toast(message, { tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const toggleOtp = (role) => {
    const next = otpRoles.includes(role) ? otpRoles.filter((r) => r !== role) : [...otpRoles, role];
    saveRestaurant({ otp_roles: next }, next.includes(role) ? `One-time codes switched on for ${role}s` : `One-time codes switched off for ${role}s`);
  };

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Settings" />}>
      <View style={{ gap: 20 }}>
        <Section title="This device">
          <Row title="Customise" subtitle="Font size, theme and layout density" icon="palette-outline" onPress={() => router.push('/customise')} />
        </Section>

        <Section title="My approval PIN">
          <Card style={{ gap: 12 }}>
            <Txt size={13} color="textSecondary">
              {user?.has_pin ? 'You have a PIN. Enter a new one to change it.' : 'You have no PIN yet. You need one to approve cancels and discounts.'}
            </Txt>
            <TextField label="Your password" secure value={password} onChangeText={setPassword} maxLength={60} />
            <TextField label="New PIN (4 to 6 digits)" secure value={pin} onChangeText={(v) => setPin(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={6} />
            <Button title="Save PIN" variant="secondary" loading={busy === 'pin'} disabled={!password || pin.length < 4} onPress={savePin} />
          </Card>
        </Section>

        {isAdmin ? (
          <>
            <Section title="Restaurant">
              <Card style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} style={{ flex: 1 }} />
                  <Button title="Save" variant="secondary" loading={busy === 'restaurant'} disabled={!name.trim() || name.trim() === restaurant?.name} onPress={() => saveRestaurant({ name }, 'Restaurant name saved')} />
                </View>
                <Segmented
                  label="Payment"
                  options={PAYMENT}
                  value={settings.payment_at ?? 'waiter'}
                  onChange={(payment_at) => saveRestaurant({ payment_at }, payment_at === 'counter' ? 'Waiters can now send bills to the counter' : 'Waiters now take every payment')}
                />
              </Card>
            </Section>

            <Section title="Security: one-time login codes">
              <Card style={{ gap: 12 }}>
                <Txt size={13} color="textSecondary">
                  When switched on for a role, those people need a fresh code each time they sign in. A manager or admin makes the code on the Staff screen. No SMS is used.
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {OTP_ROLES.map((r) => (
                    <Chip key={r.key} label={`${r.label}: ${otpRoles.includes(r.key) ? 'On' : 'Off'}`} icon={otpRoles.includes(r.key) ? 'lock-outline' : 'lock-open-outline'} selected={otpRoles.includes(r.key)} onPress={() => toggleOtp(r.key)} />
                  ))}
                </View>
              </Card>
            </Section>
          </>
        ) : null}

        <Button
          title="Sign out"
          icon="logout"
          variant="secondary"
          onPress={async () => {
            await useAuth.getState().logout();
            toast('Signed out', { icon: 'logout' });
          }}
        />
      </View>
    </Screen>
  );
}
