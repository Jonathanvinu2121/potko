import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../../../src/store/auth';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { Notice } from '../../../../src/components/Feedback';
import { IconTile } from '../../../../src/components/Picture';

const digits = (text) => text.replace(/[^0-9]/g, '');

// Settings > Manager PIN: the PIN typed to approve a discount, cancellation, void or refund.
// Changing it needs the current PIN; someone who forgot it proves who they are with their password.
export default function ManagerPin() {
  const router = useRouter();
  const hasPin = useAuth((s) => s.user?.has_pin);
  const [byPassword, setByPassword] = useState(!hasPin);
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mismatch = again.length >= pin.length && again !== pin && again.length > 0;
  const ready = current.length >= (byPassword ? 1 : 4) && pin.length === 4 && again === pin;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/pin', { method: 'POST', body: byPassword ? { password: current, pin } : { currentPin: current, pin } });
      await useAuth.getState().refresh();
      toast(hasPin ? 'Manager PIN updated' : 'Manager PIN set', { tone: 'success' });
      router.back();
    } catch (err) {
      setError(err.message);
      setCurrent('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen narrow header={<AppHeader title="Manager PIN" back />} footer={<Button title={hasPin ? 'Update PIN' : 'Set PIN'} disabled={!ready} loading={busy} onPress={save} />}>
      <View style={{ gap: 16 }}>
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <IconTile icon="lock-outline" size={64} />
          <Txt color="textSecondary" center>
            Your Manager PIN is asked for sensitive actions: approving a discount, a cancellation, a void or a refund.
          </Txt>
        </View>

        {error ? <Notice tone="error" icon="alert-circle-outline" text={error} /> : null}
        {!hasPin ? <Notice tone="warning" icon="alert-outline" text="You have no PIN yet, so you cannot approve requests. Enter your account password to set one." /> : null}

        {byPassword ? (
          <TextField label="Your account password" required secure value={current} onChangeText={setCurrent} maxLength={60} />
        ) : (
          <TextField label="Current PIN" required secure value={current} onChangeText={(v) => setCurrent(digits(v))} placeholder="Enter current PIN" keyboardType="number-pad" maxLength={6} />
        )}
        {hasPin ? (
          <Button
            title={byPassword ? 'I remember my PIN' : 'Forgot your PIN? Use your password'}
            variant="link"
            onPress={() => { setByPassword(!byPassword); setCurrent(''); setError(null); }}
          />
        ) : null}
        <TextField label="New PIN" required secure value={pin} onChangeText={(v) => setPin(digits(v))} placeholder="4 digits" keyboardType="number-pad" maxLength={4} />
        <TextField label="Confirm New PIN" required secure value={again} onChangeText={(v) => setAgain(digits(v))} placeholder="Enter the new PIN again" keyboardType="number-pad" maxLength={4} error={mismatch} />
        {mismatch ? (
          <Txt size={13} color="error">
            The two PINs are not the same.
          </Txt>
        ) : null}
        <Notice text="Use 4 digits that are easy for you to remember and hard for others to guess. Never share it: every approval is recorded under your name. Five wrong tries lock the PIN for a while." />
      </View>
    </Screen>
  );
}
