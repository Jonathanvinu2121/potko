import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { ago, dayTime } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { ActionRow } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

// Settings > Account & Security: my password, the devices I am signed in on, and leaving all of
// them at once. Admins also reach the full audit log from here.
export default function AccountSecurity() {
  const t = useTheme();
  const router = useRouter();
  const canAudit = useCan('audit.view');
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'all' | a session
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api('/me/sessions')
        .then((data) => { setSessions(data.sessions); setError(null); })
        .catch((err) => setError(err.message)),
    []
  );
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const open = (sessions ?? []).filter((s) => !s.ended_at);
  const others = open.filter((s) => !s.current);

  const act = async () => {
    setBusy(true);
    try {
      if (confirm === 'all') {
        // Every device, this one included: the server ends them all, then this screen signs out.
        await api('/me/logout-all', { method: 'POST', body: {} });
        setConfirm(null);
        await useAuth.getState().logout({ tellServer: false });
        toast('Signed out of every device', { icon: 'logout' });
        return;
      }
      await api(`/me/sessions/${confirm.id}/logout`, { method: 'POST' });
      toast('That device is signed out', { tone: 'success' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Screen header={<AppHeader title="Account & Security" back />}>
      <View style={{ gap: 16 }}>
        <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, paddingVertical: 4 }}>
          <ActionRow icon="key-outline" tone="primary" title="Change Password" subtitle="Update your account password" onPress={() => router.push('/more/settings/password')} />
          {canAudit ? <ActionRow icon="clipboard-text-clock-outline" tone="neutral" title="Audit Log" subtitle="Everything that was changed, by whom and when" onPress={() => router.push('/more/settings/audit')} /> : null}
        </View>

        <View style={{ gap: 8 }}>
          <Txt size={15} weight={700}>
            Active Sessions
          </Txt>
          <Txt size={13} color="textSecondary">
            The devices you are signed in on.
          </Txt>
          {!sessions ? (
            <ListState loading={!error} error={error} onRetry={load} rows={2} rowHeight={72} />
          ) : (
            open.map((session) => (
              <View key={session.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: session.current ? t.c.primary : t.c.border, backgroundColor: t.c.card }}>
                <Icon name={/android|iphone|ipad|ios/i.test(session.device || '') ? 'cellphone' : 'monitor'} color="textSecondary" />
                <View style={{ flex: 1, gap: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Txt size={15} weight={600}>
                      {session.device || 'Unknown device'}
                    </Txt>
                    {session.current ? <Chip label="This device" tone="primary" size={11} /> : null}
                  </View>
                  <Txt size={13} color="textSecondary">
                    Signed in {dayTime(session.created_at)}
                    {session.ip ? ` · ${session.ip}` : ''}
                  </Txt>
                  <Txt size={13} color="textSecondary">
                    {session.online ? 'Open now' : `Last used ${ago(session.last_seen_at).toLowerCase()}`}
                  </Txt>
                </View>
                {session.current ? null : <Button title="Log Out" variant="secondary" onPress={() => setConfirm(session)} />}
              </View>
            ))
          )}
          {sessions && others.length === 0 ? (
            <Txt size={13} color="textSecondary">
              You are not signed in anywhere else.
            </Txt>
          ) : null}
        </View>

        <Button title="Log Out from All Devices" icon="logout" variant="secondary" onPress={() => setConfirm('all')} />
        <Txt size={12} color="textSecondary">
          Log Out from All Devices ends every session, this one included. Sign Out on the Settings page leaves only this device.
        </Txt>
      </View>

      <ConfirmSheet
        visible={!!confirm}
        title={confirm === 'all' ? 'Log out of every device?' : `Log out ${confirm?.device || 'that device'}?`}
        text={confirm === 'all' ? 'Every phone, tablet and browser you are signed in on goes back to the sign-in screen, this one too.' : 'It goes back to the sign-in screen now.'}
        confirmLabel={confirm === 'all' ? 'Log Out Everywhere' : 'Log Out'}
        destructive
        busy={busy}
        onConfirm={act}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}
