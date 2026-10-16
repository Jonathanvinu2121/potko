// Sheets used on the staff list and a person's profile.
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { TextField } from './TextField';
import { Txt } from './Txt';
import { Notice } from './Feedback';

// A manager sets a new password for someone who forgot theirs. Nothing is sent by SMS or email:
// the manager tells the person. Every device they were signed in on is signed out.
export function ResetPasswordSheet({ person, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(null);
  if ((person?.id ?? null) !== seen) {
    setSeen(person?.id ?? null);
    setPassword('');
  }

  const save = async () => {
    setBusy(true);
    try {
      await api(`/users/${person.id}`, { method: 'PATCH', body: { password } });
      toast(`New password set for ${person.name}`, { tone: 'success' });
      onClose();
      onDone?.();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={!!person}
      onClose={busy ? () => {} : onClose}
      title="Reset Password"
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} style={{ flex: 1 }} />
          <Button title="Set Password" disabled={password.length < 6} loading={busy} onPress={save} style={{ flex: 1.4 }} />
        </View>
      }
    >
      <Txt color="textSecondary">
        Set a new password for {person?.name}. Their Staff ID stays {person?.login_id}.
      </Txt>
      <TextField label="New Password" required secure value={password} onChangeText={setPassword} placeholder="At least 6 characters" maxLength={60} />
      <Notice icon="logout" text="They are signed out on every device and sign in again with the new password. Tell them the password yourself: it is not sent anywhere." />
    </BottomSheet>
  );
}

// A one-time login code, for restaurants that ask for one at sign-in. Shown once, valid 10 minutes.
export function LoginCodeSheet({ code, onClose }) {
  return (
    <BottomSheet visible={!!code} onClose={onClose} title="One-time login code" footer={<Button title="Done" onPress={onClose} />}>
      <Txt color="textSecondary">Read this code to {code?.name}. They type it after their password. It works once, for {code?.validMinutes} minutes.</Txt>
      <Txt size={34} weight={700} center tabular style={{ letterSpacing: 6 }}>
        {code?.code}
      </Txt>
    </BottomSheet>
  );
}
