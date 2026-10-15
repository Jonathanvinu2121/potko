import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { Notice } from '../../../../src/components/Feedback';

// Settings > Account & Security > Change Password. Every other device is signed out.
export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const mismatch = again.length > 0 && again.length >= password.length && again !== password;
  const ready = current.length > 0 && password.length >= 6 && again === password;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ended } = await api('/me/password', { method: 'POST', body: { current, password } });
      toast(ended ? `Password updated. ${plural(ended, 'other device')} signed out.` : 'Password updated', { tone: 'success', duration: 4000 });
      router.back();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen narrow header={<AppHeader title="Change Password" back />} footer={<Button title="Update Password" disabled={!ready} loading={busy} onPress={save} />}>
      <View style={{ gap: 16 }}>
        {error ? <Notice tone="error" icon="alert-circle-outline" text={error} /> : null}
        <TextField label="Current Password" required secure value={current} onChangeText={setCurrent} placeholder="Enter current password" maxLength={60} />
        <TextField label="New Password" required secure value={password} onChangeText={setPassword} placeholder="At least 6 characters" maxLength={60} />
        <TextField label="Confirm New Password" required secure value={again} onChangeText={setAgain} placeholder="Enter the new password again" maxLength={60} error={mismatch} />
        {mismatch ? (
          <Txt size={13} color="error">
            The two passwords are not the same.
          </Txt>
        ) : null}
        <Notice text="Use at least 6 characters; a mix of letters and numbers is harder to guess. After the change you stay signed in here and every other device is signed out." />
      </View>
    </Screen>
  );
}
