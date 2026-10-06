import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { TextField } from '../../src/components/TextField';
import { Segmented } from '../../src/components/Segmented';
import { BottomSheet } from '../../src/components/BottomSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';
import { Row, Toggle } from '../../src/components/Bits';

const ROLES = [
  { value: 'waiter', label: 'Waiter' },
  { value: 'chef', label: 'Chef' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Admin' },
];
const BLANK = { name: '', login_id: '', role: 'waiter', limit: '3', password: '', pin: '', active: true };

// Staff: who can sign in, as what, and how much discount each waiter may give alone.
// A manager can look and make one-time login codes; only an admin can add or change people.
export default function Staff() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const isAdmin = me?.role === 'admin';
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // a user, or {} for a new one
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null); // { code, name } just generated

  const load = useCallback(() => {
    setError(null);
    api('/users')
      .then((r) => setUsers(r.users))
      .catch((err) => setError(err.message));
  }, []);
  useFocusEffect(load);

  const set = (changes) => setForm((f) => ({ ...f, ...changes }));
  const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 4000 });

  const open = (user) => {
    setEditing(user);
    setForm(user.id ? { ...BLANK, name: user.name, login_id: user.login_id, role: user.role, limit: String(user.discount_limit_pct), active: user.active } : BLANK);
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, role: form.role, discount_limit_pct: Number(form.limit) };
      if (form.password) body.password = form.password;
      if (form.pin) body.pin = form.pin;
      if (editing.id) {
        body.active = form.active;
        await api(`/users/${editing.id}`, { method: 'PATCH', body });
      } else {
        body.login_id = form.login_id;
        await api('/users', { method: 'POST', body });
      }
      toast(editing.id ? `${form.name} saved` : `${form.name} added`, { tone: 'success' });
      setEditing(null);
      load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async (user) => {
    try {
      setCode(await api(`/users/${user.id}/otp`, { method: 'POST' }));
    } catch (err) {
      fail(err);
    }
  };

  const needsPin = form.role === 'manager' || form.role === 'admin';
  const valid = form.name.trim() && (editing?.id || (form.login_id.trim().length >= 3 && form.password.length >= 6)) && Number(form.limit) >= 0 && Number(form.limit) <= 100;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Staff" />}>
      <View style={{ gap: 12 }}>
        {isAdmin ? <Button title="Add a person" icon="account-plus-outline" variant="secondary" onPress={() => open({})} /> : null}

        {error ? (
          <View style={{ gap: 12 }}>
            <EmptyState icon="wifi-off" title="Couldn’t load staff" text={error} />
            <Button title="Try again" variant="secondary" onPress={load} />
          </View>
        ) : !users ? (
          [0, 1, 2, 3].map((n) => <Skeleton key={n} height={64} radius={t.radius.control} />)
        ) : (
          users.map((user) => (
            <Row
              key={user.id}
              title={`${user.name}${user.id === me.id ? ' (you)' : ''}`}
              subtitle={`${user.login_id}${user.role === 'waiter' ? ` · discount up to ${user.discount_limit_pct}%` : ''}${user.active ? '' : ' · deactivated'}`}
              dim={!user.active}
              onPress={isAdmin ? () => open(user) : undefined}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Chip label={user.role.toUpperCase()} tone="primary" size={11} />
                  {user.active ? <Button title="Login code" variant="link" onPress={() => makeCode(user)} /> : null}
                </View>
              }
            />
          ))
        )}
      </View>

      <BottomSheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : 'Add a person'}
        footer={<Button title={editing?.id ? 'Save' : 'Add person'} loading={busy} disabled={!valid} onPress={save} />}
      >
        <TextField label="Name" required value={form.name} onChangeText={(name) => set({ name })} autoCapitalize="words" maxLength={60} />
        {editing?.id ? null : (
          <TextField label="Staff ID (used to sign in)" required value={form.login_id} onChangeText={(login_id) => set({ login_id })} placeholder="e.g. W-106" autoCapitalize="characters" maxLength={30} />
        )}
        <Segmented label="Role" options={ROLES} value={form.role} onChange={(role) => set({ role })} />
        {form.role === 'waiter' ? (
          <TextField label="Discount this waiter may give alone (%)" value={form.limit} onChangeText={(v) => set({ limit: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" maxLength={5} />
        ) : null}
        <TextField
          label={editing?.id ? 'New password (leave empty to keep the current one)' : 'Password (at least 6 characters)'}
          required={!editing?.id}
          secure
          value={form.password}
          onChangeText={(password) => set({ password })}
          maxLength={60}
        />
        {needsPin ? (
          <TextField label={editing?.id ? 'New approval PIN (leave empty to keep)' : 'Approval PIN (4 to 6 digits, optional)'} secure value={form.pin} onChangeText={(v) => set({ pin: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" maxLength={6} />
        ) : null}
        {editing?.id && editing.id !== me.id ? <Toggle label={form.active ? 'Can sign in' : 'Deactivated'} value={form.active} onChange={(active) => set({ active })} /> : null}
      </BottomSheet>

      <BottomSheet visible={!!code} onClose={() => setCode(null)} title={`Login code for ${code?.name ?? ''}`} footer={<Button title="Done" onPress={() => setCode(null)} />}>
        <Txt size={40} weight={700} tabular center accessibilityLabel={`Code ${code?.code?.split('').join(' ')}`} style={{ letterSpacing: 6 }}>
          {code?.code}
        </Txt>
        <Txt size={13} color="textSecondary" center>
          Give this code to {code?.name}. It works once, for the next {code?.validMinutes} minutes, and is only asked for when one-time codes are switched on for their role.
        </Txt>
      </BottomSheet>
    </Screen>
  );
}
