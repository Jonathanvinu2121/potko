import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth, useCan } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { useStaff, mayChange } from '../../../../src/store/staff';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { ago } from '../../../../src/lib/format';
import { ROLE_LABEL } from '../../../../src/lib/roles';
import { useNow } from '../../../../src/lib/useNow';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { ConfirmSheet } from '../../../../src/components/ConfirmSheet';
import { SearchField, Presence } from '../../../../src/components/Lists';
import { ListState } from '../../../../src/components/Feedback';
import { Avatar } from '../../../../src/components/Picture';
import { ActionSheet, MoreButton } from '../../../../src/components/Forms';
import { ResetPasswordSheet } from '../../../../src/components/StaffSheets';

const FILTERS = [
  { key: 'all', label: 'All', roles: null },
  { key: 'manager', label: 'Managers', roles: ['admin', 'manager'] },
  { key: 'waiter', label: 'Waiters', roles: ['waiter'] },
  { key: 'chef', label: 'Chefs', roles: ['chef'] },
  { key: 'cashier', label: 'Cashiers', roles: ['cashier'] },
];

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

// More > Staff: everyone who works here, who is signed in right now, and what each is assigned to.
// "2 hours ago" reads as part of the sentence; a date such as "Oct 11" keeps its capital.
const seen = (text) => (/^[A-Z][a-z]{2} \d/.test(text) ? text : text.toLowerCase());

export default function StaffList() {
  const t = useTheme();
  const router = useRouter();
  const now = useNow();
  const me = useAuth((s) => s.user);
  const canManage = useCan('staff.manage');
  const { users, status, error, load } = useStaff();
  const live = useLive((s) => s.online);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [menu, setMenu] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'logout' | 'delete', person }
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const isOnline = (person) => live[person.id] ?? person.online;
  const roles = FILTERS.find((f) => f.key === filter).roles;
  const text = query.trim().toLowerCase();
  const shown = users.filter((u) => (!roles || roles.includes(u.role)) && `${u.name} ${u.login_id} ${u.phone ?? ''}`.toLowerCase().includes(text));
  const countOf = (f) => (f.roles ? users.filter((u) => f.roles.includes(u.role)).length : users.length);

  const act = async () => {
    const { kind, person } = confirm;
    setBusy(true);
    try {
      if (kind === 'logout') {
        const { ended } = await api(`/users/${person.id}/logout`, { method: 'POST', body: {} });
        toast(ended ? `${person.name} is signed out everywhere` : `${person.name} was not signed in anywhere`, { tone: 'success' });
      } else {
        await api(`/users/${person.id}`, { method: 'DELETE' });
        toast(`${person.name} deleted`, { tone: 'success' });
      }
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Screen header={<AppHeader title="Staff Management" subtitle="Manage your team members" back />}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <SearchField value={query} onChangeText={setQuery} placeholder="Search staff" style={{ flex: 1 }} />
          {canManage ? <Button title="Add Staff" icon="plus" onPress={() => router.push('/more/staff/edit')} /> : null}
        </View>
        <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={`${f.label} ${countOf(f)}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>

        {status === 'error' ? (
          <ListState error={error} onRetry={load} />
        ) : status !== 'ready' ? (
          <ListState loading rowHeight={76} rows={5} />
        ) : shown.length === 0 ? (
          <ListState empty icon="account-search-outline" title={users.length ? 'Nobody matches' : 'No staff yet'} text={users.length ? 'Try another name or role.' : 'Add the first team member.'} />
        ) : (
          shown.map((person) => {
            const online = isOnline(person);
            return (
              <View key={person.id} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 2, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
                <Pressable
                  onPress={() => router.push(`/more/staff/${person.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${person.name}, ${ROLE_LABEL[person.role]}, ${online ? 'online' : 'offline'}. Open profile.`}
                  style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : person.active ? 1 : 0.55 })}
                >
                  <Avatar name={person.name} imageId={person.image_id} size={48} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Txt size={16} weight={700} numberOfLines={1}>
                      {person.name}
                      {person.id === me?.id ? <Txt size={13} color="textSecondary">{'  (you)'}</Txt> : null}
                    </Txt>
                    <Txt size={13} color="textSecondary" numberOfLines={1}>
                      {ROLE_LABEL[person.role]}
                    </Txt>
                    <Txt size={13} color="textSecondary" numberOfLines={1}>
                      {person.assignment}
                    </Txt>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {person.active ? <Presence online={online} /> : <Chip label="Inactive" tone="error" size={12} />}
                    <Txt size={11} color="textSecondary">
                      {online ? 'Active now' : `Last seen ${seen(ago(person.last_seen_at ?? person.last_login_at, now))}`}
                    </Txt>
                  </View>
                </Pressable>
                <MoreButton label={`Actions for ${person.name}`} onPress={() => setMenu(person)} />
              </View>
            );
          })
        )}
      </View>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { icon: 'account-outline', title: 'View Details', onPress: () => router.push(`/more/staff/${menu.id}`) },
          mayChange(menu) ? { icon: 'pencil-outline', title: 'Edit Staff', onPress: () => router.push(`/more/staff/edit?id=${menu.id}`) } : null,
          mayChange(menu) ? { icon: 'lock-reset', title: 'Reset Password', onPress: () => setResetting(menu) } : null,
          mayChange(menu) ? { icon: 'logout', title: 'Log Out from All Devices', destructive: true, onPress: () => setConfirm({ kind: 'logout', person: menu }) } : null,
          mayChange(menu) && menu.id !== me?.id ? { icon: 'trash-can-outline', title: 'Delete Staff', destructive: true, onPress: () => setConfirm({ kind: 'delete', person: menu }) } : null,
        ] : []}
      />
      <ResetPasswordSheet person={resetting} onClose={() => setResetting(null)} onDone={load} />
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.kind === 'delete' ? `Delete ${confirm.person.name}?` : `Log ${confirm?.person.name ?? ''} out of every device?`}
        text={
          confirm?.kind === 'delete'
            ? 'They can no longer sign in and leave the staff list. Their name stays on the orders, payments and reports they were part of.'
            : 'Every phone and tablet they are signed in on goes back to the sign-in screen now. They can sign in again with their password.'
        }
        confirmLabel={confirm?.kind === 'delete' ? 'Delete Staff' : 'Log Out Everywhere'}
        destructive
        busy={busy}
        onConfirm={act}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  );
}
