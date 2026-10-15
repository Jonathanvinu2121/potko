import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { mayChange } from '../../../../src/store/staff';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { count, dayTime, duration, money, plural } from '../../../../src/lib/format';
import { ROLE_LABEL } from '../../../../src/lib/roles';
import { accountEvent } from '../../../../src/lib/audit';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { Stat } from '../../../../src/components/Bits';
import { Tabs, Presence, ActionRow } from '../../../../src/components/Lists';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { Avatar } from '../../../../src/components/Picture';
import { ResetPasswordSheet, LoginCodeSheet } from '../../../../src/components/StaffSheets';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

const PERIODS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
];
// From the start of the day `days` ago until now, in the phone's own time.
function periodQuery(days) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - days);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`;
}

// One fact about the person: an icon, what it is, and its value.
function Fact({ icon, label, value, first }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 30, paddingVertical: 12, borderTopWidth: first ? 0 : t.borderWidth, borderTopColor: t.c.border }}>
      <Icon name={icon} size={18} color="textSecondary" style={{ marginTop: 2 }} />
      <Txt size={14} color="textSecondary" style={{ width: 118 }}>
        {label}
      </Txt>
      <Txt size={14} weight={600} style={{ flex: 1, textAlign: 'right' }}>
        {value}
      </Txt>
    </View>
  );
}

// One thing that can be done with the account: a row of its own with an icon and ›.
function RowCard({ icon, title, destructive, disabled, onPress }) {
  const t = useTheme();
  return (
    <View style={{ borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
      <ActionRow icon={icon} tile={false} title={title} destructive={destructive} disabled={disabled} onPress={onPress} />
    </View>
  );
}

const DOT = { success: 'success', error: 'error', warning: 'warning', primary: 'primary' };

// More > Staff > one person: who they are, what they may use, where they are signed in, what
// they did in a period, and what has happened to the account.
export default function StaffProfile() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const me = useAuth((s) => s.user);
  const seesReports = !!me?.permissions?.['reports.view'];
  const otpRoles = useAuth((s) => s.restaurant?.settings?.otp_roles);
  const liveOnline = useLive((s) => s.online[id]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [period, setPeriod] = useState('30d');
  const [resetting, setResetting] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'logout' | 'revoke' | 'delete'
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(null);

  // Reads again whenever the screen comes back into view or another period is chosen.
  const load = useCallback(
    () =>
      api(`/users/${id}?${periodQuery(PERIODS.find((p) => p.key === period).days)}`)
        .then((result) => { setData(result); setError(null); })
        .catch((err) => setError(err.message)),
    [id, period]
  );
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!data) {
    return (
      <Screen header={<AppHeader title="Staff Profile" back />}>
        <ListState loading={!error} error={error} onRetry={() => load()} rows={4} rowHeight={84} />
      </Screen>
    );
  }

  const person = data.user;
  const online = liveOnline ?? person.online;
  const editable = mayChange(person);
  const openSessions = data.sessions.filter((s) => !s.ended_at);
  const access = data.assigned;

  const act = async () => {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        await api(`/users/${id}`, { method: 'DELETE' });
        toast(`${person.name} deleted`, { tone: 'success' });
        setConfirm(null);
        router.back();
        return;
      }
      if (confirm === 'revoke') {
        await api(`/users/${id}`, { method: 'PATCH', body: { active: false } });
        toast(`${person.name} can no longer sign in`, { tone: 'success' });
        await load();
        return;
      }
      const { ended } = await api(`/users/${id}/logout`, { method: 'POST', body: {} });
      toast(ended ? `${person.name} is signed out everywhere` : 'Nothing was signed in', { tone: 'success' });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const makeCode = () => api(`/users/${id}/otp`, { method: 'POST' }).then(setCode).catch(fail);
  const restore = () =>
    api(`/users/${id}`, { method: 'PATCH', body: { active: true } })
      .then(() => {
        toast(`${person.name} can sign in again`, { tone: 'success' });
        return load();
      })
      .catch(fail);

  return (
    <Screen
      header={<AppHeader title="Staff Profile" back />}
    >
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar name={person.name} imageId={person.image_id} size={72} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Txt size={20} weight={700}>
                {person.name}
              </Txt>
              {person.active ? <Presence online={online} /> : <Chip label="Access off" icon="account-cancel-outline" tone="error" size={12} />}
            </View>
            <Txt size={14} color="textSecondary">
              {ROLE_LABEL[person.role]} · {person.login_id}
            </Txt>
            {person.phone ? (
              <Txt size={13} color="textSecondary">
                {person.phone}
              </Txt>
            ) : null}
            {person.email ? (
              <Txt size={13} color="textSecondary" numberOfLines={1}>
                {person.email}
              </Txt>
            ) : null}
            <Txt size={13} color="textSecondary">
              Joined {new Date(person.created_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
            </Txt>
          </View>
          {/* Edit on the right of the person's details, centred with them (the reference design). */}
          {editable ? <Button title="Edit" icon="pencil-outline" variant="secondary" onPress={() => router.push(`/more/staff/edit?id=${id}`)} /> : null}
        </View>

        <Tabs underline options={[{ value: 'overview', label: 'Overview' }, { value: 'access', label: 'Role & Access' }, { value: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />

        {/* Role & Access: what this person may reach, one row per step of Edit. The role itself is
            set once; changing it is a small option at the end, not the first thing offered. */}
        {tab === 'access' ? (
          <>
            <Card style={{ gap: 2, padding: 4 }}>
              {person.role === 'waiter' ? (
                <>
                  <ActionRow icon="floor-plan" title="Dining Area Access" subtitle={access.everywhere ? 'All dining areas' : access.areas.map((a) => a.name).join(', ')} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=areas`)} />
                  <ActionRow icon="table-furniture" title="Table Access" subtitle={access.areas.some((a) => a.mode === 'tables') ? 'Chosen tables' : 'All tables'} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=tables`)} />
                  <ActionRow icon="cash-multiple" title="Payment Permission" subtitle={{ take: 'Can take payment', close: 'Close table only', none: 'No access' }[person.payment_access ?? (person.can_collect_payment ? 'take' : 'close')]} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=payment`)} />
                </>
              ) : null}
              {person.role === 'waiter' || person.role === 'cashier' ? (
                <ActionRow icon="tag-outline" title="Price Visibility" subtitle={person.permissions['prices.view'] === false ? 'Cannot see prices' : 'Can see prices'} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=prices`)} />
              ) : null}
              {person.role === 'chef' ? (
                <ActionRow icon="monitor-dashboard" title="Terminal Access" subtitle={access.terminals.map((k) => k.name).join(', ') || 'None yet'} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=terminals`)} />
              ) : null}
              {person.role === 'manager' ? (
                <ActionRow icon="chart-bar" title="Business Numbers & Approvals" subtitle={[person.permissions['reports.view'] === false ? 'No business numbers' : 'Sees business numbers', person.permissions['approvals.decide'] === false ? 'cannot approve' : 'approves with PIN'].join(' · ')} disabled={!editable} onPress={() => router.push(`/more/staff/edit?id=${id}&step=business`)} />
              ) : null}
              {person.role === 'admin' ? <ActionRow icon="shield-crown-outline" title="Full access" subtitle="An admin can do everything" chevron={false} disabled /> : null}
            </Card>
            {editable && person.id !== me?.id ? (
              <Pressable onPress={() => router.push(`/more/staff/edit?id=${id}&step=role`)} accessibilityRole="button" hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}>
                <Txt size={13} color="textSecondary" style={{ textDecorationLine: 'underline' }}>
                  Change role
                </Txt>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === 'overview' ? (
          <>
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              <Fact first icon="account-outline" label="Role" value={ROLE_LABEL[person.role]} />
              {person.role === 'waiter' ? (
                <>
                  <Fact icon="floor-plan" label="Access Floors" value={access.everywhere ? 'All floors' : access.areas.map((a) => a.name).join(', ')} />
                  <Fact
                    icon="table-furniture"
                    label="Table Access"
                    value={access.areas.some((a) => a.mode === 'tables') ? access.areas.map((a) => (a.mode === 'tables' ? `${a.tables.join(', ')} (${a.name})` : `All of ${a.name}`)).join('; ') : 'All tables'}
                  />
                  <Fact icon="cash-multiple" label="Payment" value={{ take: 'Can take payment', close: 'Close table only', none: 'No access' }[person.payment_access ?? (person.can_collect_payment ? 'take' : 'close')]} />
                </>
              ) : null}
              {person.role === 'chef' ? <Fact icon="monitor-dashboard" label="Assigned Terminals" value={access.terminals.map((k) => k.name).join(', ') || 'None yet'} /> : null}
              {person.role === 'waiter' || person.role === 'cashier' ? <Fact icon="percent-outline" label="Discount Limit" value={`Up to ${person.discount_limit}% without approval`} /> : null}
              {person.permissions['approvals.decide'] ? <Fact icon="shield-key-outline" label="Approval PIN" value={person.has_pin ? 'Set' : 'Not set yet'} /> : null}
              <Fact icon="login" label="Last Login" value={person.last_login_at ? dayTime(person.last_login_at) : 'Never'} />
            </Card>

            {seesReports && ['waiter', 'chef', 'cashier'].includes(person.role) ? (
              <RowCard icon="chart-bar" title="See their numbers in Reports" onPress={() => router.push(`/more/reports/staff/${id}`)} />
            ) : null}

            {editable ? (
              <View style={{ gap: 8 }}>
                {person.id === me?.id ? null : person.active ? (
                  <RowCard icon="account-cancel-outline" title="Switch Off Access" onPress={() => setConfirm('revoke')} />
                ) : (
                  <RowCard icon="account-check-outline" title="Restore Access" onPress={restore} />
                )}
                <RowCard icon="logout" title="Log Out from All Devices" disabled={openSessions.length === 0} onPress={() => setConfirm('logout')} />
                <RowCard icon="lock-reset" title="Reset Password" onPress={() => setResetting(true)} />
                {otpRoles?.includes(person.role) ? <RowCard icon="numeric" title="One-time login code" onPress={makeCode} /> : null}
                {person.id !== me?.id ? <RowCard icon="trash-can-outline" title="Delete Staff" destructive onPress={() => setConfirm('delete')} /> : null}
              </View>
            ) : null}
          </>
        ) : tab !== 'activity' ? null : data.activity.length === 0 ? (
          <ListState empty icon="history" title="Nothing recorded yet" text="Sign-ins and changes to this account will appear here." />
        ) : (
          <View>
            {data.activity.map((entry, index) => {
              const event = accountEvent(entry);
              const byOther = entry.user_id && entry.user_id !== person.id;
              return (
                <View key={entry.id} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ alignItems: 'center', width: 12 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: t.c[DOT[event.tone] ?? 'disabled'] }} />
                    {index < data.activity.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: t.c.border }} /> : null}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 14 }}>
                    <Txt size={15} weight={700}>
                      {event.title}
                    </Txt>
                    <Txt size={13} color="textSecondary">
                      {dayTime(entry.at)}
                      {entry.new?.device ? ` · ${entry.new.device}` : ''}
                    </Txt>
                    {byOther ? (
                      <Txt size={13} color="textSecondary">
                        By {ROLE_LABEL[entry.by_role] ?? 'staff'} ({entry.by_name})
                      </Txt>
                    ) : null}
                  </View>
                </View>
              );
            })}
            <Txt size={12} color="textSecondary">
              The latest {plural(data.activity.length, 'entry', 'entries')}. The full record is in Settings, Audit log.
            </Txt>
          </View>
        )}
      </View>

      <ResetPasswordSheet person={resetting ? person : null} onClose={() => setResetting(false)} onDone={() => load()} />
      <LoginCodeSheet code={code} onClose={() => setCode(null)} />
      <ConfirmSheet
        visible={!!confirm}
        title={confirm === 'delete' ? `Delete ${person.name}?` : confirm === 'revoke' ? `Switch off ${person.name}'s access?` : `Log ${person.name} out of every device?`}
        text={
          confirm === 'delete'
            ? 'They can no longer sign in and leave the staff list. Their name stays on the orders, payments and reports they were part of.'
            : confirm === 'revoke'
              ? 'They are signed out now and cannot sign in until you restore their access. Nothing is deleted.'
            : 'The screen goes back to sign-in now. They can sign in again with their password.'
        }
        confirmLabel={confirm === 'delete' ? 'Delete Staff' : confirm === 'revoke' ? 'Switch Off Access' : 'Log Out'}
        destructive
        busy={busy}
        onConfirm={act}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}
