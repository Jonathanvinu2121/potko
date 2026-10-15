import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { homeFor } from '../../src/lib/roles';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { Txt } from '../../src/components/Txt';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { Notice } from '../../src/components/Feedback';

// First-run set-up: shown instead of sign-in while the server has no restaurant yet. The client
// creates the restaurant and their own admin account (with the setup code they were given), is
// signed in, and sets up everything else in the app. Once done, this screen never shows again.
export default function Setup() {
  const t = useTheme();
  const router = useRouter();
  const [state, setState] = useState(null); // { needed, ready } from the server
  const [form, setForm] = useState({ restaurantName: '', setupCode: '', adminName: '', loginId: '', password: '', confirm: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));

  useEffect(() => {
    let current = true;
    // A sleeping free server can take about a minute to answer the first request.
    api('/auth/setup', { timeout: 75000 })
      .then((r) => {
        if (!current) return;
        if (!r.needed) router.replace('/role'); // already set up: sign in instead
        else setState(r);
      })
      .catch(() => current && setState({ needed: true, ready: true }));
    return () => {
      current = false;
    };
  }, [router]);

  // What still stops the form, shown on the button's line.
  const problem = !form.restaurantName.trim()
    ? 'Enter the restaurant name'
    : !form.setupCode.trim()
      ? 'Enter the setup code'
      : !form.adminName.trim()
        ? 'Enter your name'
        : form.loginId.trim().length < 3
          ? 'Choose a Staff ID (3 or more letters or digits)'
          : form.password.length < 6
            ? 'The password needs at least 6 characters'
            : form.password !== form.confirm
              ? 'The two passwords are not the same'
              : !/^\d{4}$/.test(form.pin)
                ? 'Choose a 4-digit approval PIN'
                : null;

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const data = await api('/auth/setup', {
        method: 'POST',
        timeout: 75000,
        body: { setupCode: form.setupCode.trim(), restaurantName: form.restaurantName.trim(), adminName: form.adminName.trim(), loginId: form.loginId.trim(), password: form.password, pin: form.pin },
      });
      await useAuth.getState().enter(data);
      toast(`${data.restaurant.name} is ready. Welcome, ${data.user.name}`, { tone: 'success', duration: 4000 });
      router.replace(homeFor(data.user.role));
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
      if (err.code === 'setup_done') router.replace('/role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      narrow
      footer={
        <View style={{ gap: 8 }}>
          <Button title="Create Restaurant" icon="check" loading={busy} disabled={!!problem || state?.ready === false} onPress={submit} />
          <Txt size={12} color="textSecondary" center>
            {problem ?? 'You become the admin. Everything else is set up inside the app.'}
          </Txt>
        </View>
      }
    >
      <Image source={require('../../assets/logo.png')} accessibilityRole="image" accessibilityLabel="POTKO logo" style={{ width: 64, height: 64, marginBottom: 16 }} />
      <Txt size={26} weight={700}>
        Set up your restaurant
      </Txt>
      <Txt color="textSecondary" style={{ marginTop: 4, marginBottom: 16 }}>
        Create your restaurant and your admin account. You do this once.
      </Txt>

      {state?.ready === false ? (
        <View style={{ marginBottom: 16 }}>
          <Notice tone="warning" icon="alert-outline" title="Not ready yet" text="This server has no setup code yet. Ask the person who gave you the app to switch set-up on, then open the app again." />
        </View>
      ) : null}

      <View style={{ gap: t.d.gap }}>
        <TextField label="Restaurant Name" required value={form.restaurantName} onChangeText={(restaurantName) => set({ restaurantName })} placeholder="e.g. Spice Route Indiranagar" autoCapitalize="words" maxLength={80} editable={!busy} />
        <TextField label="Setup Code" required secure value={form.setupCode} onChangeText={(setupCode) => set({ setupCode })} placeholder="The code you were given" editable={!busy} />
        <TextField label="Your Name" required value={form.adminName} onChangeText={(adminName) => set({ adminName })} placeholder="e.g. Priya" autoCapitalize="words" maxLength={60} editable={!busy} />
        <TextField label="Staff ID" required value={form.loginId} onChangeText={(loginId) => set({ loginId: loginId.replace(/\s/g, '') })} placeholder="e.g. A-101 (you sign in with this)" autoCapitalize="characters" maxLength={60} editable={!busy} />
        <TextField label="Password" required secure value={form.password} onChangeText={(password) => set({ password })} placeholder="At least 6 characters" editable={!busy} />
        <TextField label="Confirm Password" required secure value={form.confirm} onChangeText={(confirm) => set({ confirm })} placeholder="The same password again" editable={!busy} />
        <View style={{ gap: 4 }}>
          <TextField label="Approval PIN" required secure value={form.pin} onChangeText={(pin) => set({ pin: pin.replace(/[^0-9]/g, '') })} placeholder="4 digits" keyboardType="number-pad" maxLength={4} editable={!busy} returnKeyType="go" onSubmitEditing={submit} />
          <Txt size={12} color="textSecondary">
            You type it to approve discounts, refunds and cancelled dishes.
          </Txt>
        </View>
      </View>
    </Screen>
  );
}
