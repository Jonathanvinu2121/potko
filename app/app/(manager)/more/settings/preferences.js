import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useCan } from '../../../../src/store/auth';
import { useSettings } from '../../../../src/store/settings';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Card } from '../../../../src/components/Card';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { Notice } from '../../../../src/components/Feedback';
import { Choices, SwitchRow, FormSection } from '../../../../src/components/Forms';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DELAYS = [10, 15, 20, 30, 45].map((n) => ({ value: n, label: `${n} min` }));
const OTP_ROLES = [
  { key: 'manager', label: 'Managers' },
  { key: 'cashier', label: 'Cashiers' },
  { key: 'chef', label: 'Chefs' },
  { key: 'waiter', label: 'Waiters' },
];
// Typing 1930 gives 19:30.
const asTime = (text) => {
  const d = text.replace(/[^0-9]/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

// Settings > System Preferences: sound on this device, and the few basics of how the restaurant
// runs: service hours, when the business day starts, and when a slow kitchen raises an alert.
export default function SystemPreferences() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const settings = useAuth((s) => s.restaurant?.settings) ?? {};
  const editable = useCan('settings.manage');
  const sound = useSettings((s) => s.sound);
  const [form, setForm] = useState({
    services: (settings.services ?? []).map((s) => ({ ...s })),
    day_start: settings.day_start ?? '05:00',
    timezone: settings.timezone ?? 'Asia/Kolkata',
    delay: settings.kitchen_delay_minutes ?? 15,
    otp_roles: settings.otp_roles ?? [],
  });
  const [busy, setBusy] = useState(false);
  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  const setService = (index, changes) => set({ services: form.services.map((s, i) => (i === index ? { ...s, ...changes } : s)) });

  const setSound = async (value) => {
    useSettings.getState().preview({ sound: value });
    await useSettings.getState().save(user.id).catch(() => {});
    toast(value ? 'Sound and vibration are on' : 'Sound and vibration are off on this device', { icon: value ? 'bell-ring-outline' : 'bell-off-outline' });
  };

  const problem = form.services.some((s) => !s.name.trim() || !TIME.test(s.from) || !TIME.test(s.to))
    ? 'Every service needs a name and its hours, such as 19:00 to 23:30'
    : !TIME.test(form.day_start) ? 'The day starts at a time such as 05:00'
      : !form.timezone.trim() ? 'Enter the time zone'
        : null;

  const save = async () => {
    setBusy(true);
    try {
      await api('/restaurant', {
        method: 'PATCH',
        body: { services: form.services, day_start: form.day_start, timezone: form.timezone.trim(), kitchen_delay_minutes: form.delay, otp_roles: form.otp_roles },
      });
      toast('Preferences saved', { tone: 'success' });
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      narrow
      header={<AppHeader title="System Preferences" subtitle="Sound and how the restaurant runs" back />}
      footer={editable ? <Button title={problem ?? 'Save Changes'} disabled={!!problem} loading={busy} onPress={save} /> : null}
    >
      <View style={{ gap: 20 }}>
        <FormSection title="This device">
          <Card>
            <SwitchRow icon="bell-outline" title="Sound notifications" text="Play a sound and vibrate when a new request or order needs you. The message on screen always shows." value={sound} onChange={setSound} />
          </Card>
        </FormSection>

        {editable ? null : <Notice icon="lock-outline" text="Only an admin can change the restaurant's preferences below." />}
        <View pointerEvents={editable ? 'auto' : 'none'} style={{ gap: 20 }}>
          <FormSection title="Service hours" text="Shown on the Overview as the service running now. Write times as 24-hour, such as 19:00.">
            {form.services.map((service, index) => (
              <Card key={index} style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  <TextField label="Service name" value={service.name} onChangeText={(name) => setService(index, { name })} placeholder="e.g. Dinner Service" autoCapitalize="words" maxLength={30} editable={editable} style={{ flex: 1 }} />
                  <Pressable onPress={() => set({ services: form.services.filter((_, i) => i !== index) })} accessibilityRole="button" accessibilityLabel={`Remove ${service.name || 'this service'}`} hitSlop={6} style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="trash-can-outline" color="error" />
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TextField label="From" value={service.from} onChangeText={(from) => setService(index, { from: asTime(from) })} placeholder="19:00" keyboardType="number-pad" maxLength={5} error={!TIME.test(service.from)} editable={editable} style={{ flex: 1 }} />
                  <TextField label="To" value={service.to} onChangeText={(to) => setService(index, { to: asTime(to) })} placeholder="23:30" keyboardType="number-pad" maxLength={5} error={!TIME.test(service.to)} editable={editable} style={{ flex: 1 }} />
                </View>
              </Card>
            ))}
            {form.services.length < 6 ? <Button title="Add a service" icon="plus" variant="secondary" onPress={() => set({ services: [...form.services, { name: '', from: '', to: '' }] })} /> : null}
          </FormSection>

          <FormSection title="Business day" text="Sales after midnight count for the evening before, until this time. Reports and the Overview use it.">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextField label="Day starts at" value={form.day_start} onChangeText={(v) => set({ day_start: asTime(v) })} placeholder="05:00" keyboardType="number-pad" maxLength={5} error={!TIME.test(form.day_start)} editable={editable} style={{ flex: 1 }} />
              <TextField label="Time zone" value={form.timezone} onChangeText={(timezone) => set({ timezone })} placeholder="Asia/Kolkata" maxLength={40} editable={editable} style={{ flex: 1.4 }} />
            </View>
          </FormSection>

          <FormSection title="Kitchen delay alert" text="An order waiting in the kitchen longer than this shows on the Overview under Needs attention.">
            <Choices options={DELAYS} value={form.delay} onChange={(delay) => set({ delay })} />
          </FormSection>

          <FormSection title="One-time login codes" text="When switched on for a role, those people need a fresh code each time they sign in. A manager or admin makes the code on the person's Staff profile. No SMS is used.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {OTP_ROLES.map((role) => {
                const on = form.otp_roles.includes(role.key);
                return <Chip key={role.key} label={`${role.label}: ${on ? 'On' : 'Off'}`} icon={on ? 'lock-outline' : 'lock-open-outline'} selected={on} onPress={() => set({ otp_roles: on ? form.otp_roles.filter((r) => r !== role.key) : [...form.otp_roles, role.key] })} />;
              })}
            </View>
          </FormSection>
        </View>
        <Txt size={12} color="textSecondary">
          Tables, Menu, Staff and Reports have their own sections under More.
        </Txt>
      </View>
    </Screen>
  );
}
