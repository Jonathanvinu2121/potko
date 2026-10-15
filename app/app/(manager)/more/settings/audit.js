import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '../../../../src/theme';
import { api } from '../../../../src/lib/api';
import { describe, when } from '../../../../src/lib/audit';
import { ROLE_LABEL } from '../../../../src/lib/roles';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { ListState } from '../../../../src/components/Feedback';

const FILTERS = [
  { key: null, label: 'Everything' },
  { key: 'order', label: 'Orders & payments' },
  { key: 'user', label: 'Staff & sign-ins' },
  { key: 'menu_item', label: 'Menu' },
  { key: 'table', label: 'Tables' },
  { key: 'restaurant', label: 'Settings' },
];

// Settings > Account & Security > Audit Log: who did what, and when. Records are written by the
// server and can never be changed or deleted.
export default function AuditLog() {
  const t = useTheme();
  const [entity, setEntity] = useState(null);
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (before) => {
    setBusy(true);
    setError(null);
    return api(`/audit?${entity ? `entity=${entity}&` : ''}${before ? `before=${before}` : ''}`)
      .then((data) => {
        setEntries((old) => (before ? [...(old ?? []), ...data.entries] : data.entries));
        setMore(data.entries.length === 100);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    setEntries(null);
    load();
  }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen header={<AppHeader title="Audit Log" subtitle="Who did what, and when" back />}>
      <View style={{ gap: 12 }}>
        <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {FILTERS.map((f) => (
            <Chip key={f.label} label={f.label} selected={entity === f.key} onPress={() => setEntity(f.key)} />
          ))}
        </ScrollView>
        {!entries ? (
          <ListState loading={!error} error={error} onRetry={() => load()} rows={6} rowHeight={56} />
        ) : entries.length === 0 ? (
          <ListState empty icon="clipboard-text-clock-outline" title="Nothing recorded here yet" text="Actions appear as soon as they happen." />
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={{ gap: 2, paddingVertical: 10, paddingHorizontal: 12, borderRadius: t.radius.control, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
              <Txt size={14} weight={600}>
                {describe(entry)}
              </Txt>
              <Txt size={12} color="textSecondary">
                {entry.user_name ?? 'System'}
                {entry.user_role ? ` (${ROLE_LABEL[entry.user_role] ?? entry.user_role})` : ''} · {when(entry.at)}
                {entry.refs?.order_id ? ` · order ref ${entry.refs.order_id}` : ''}
              </Txt>
              {entry.reason && !describe(entry).includes(entry.reason) ? (
                <Txt size={12} color="textSecondary">
                  Reason: {entry.reason}
                </Txt>
              ) : null}
            </View>
          ))
        )}
        {entries && more ? <Button title="Show older" variant="secondary" loading={busy} onPress={() => load(entries[entries.length - 1].id)} /> : null}
      </View>
    </Screen>
  );
}
