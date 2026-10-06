import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useAuth } from '../../src/store/auth';
import { api } from '../../src/lib/api';
import { describe, when } from '../../src/lib/audit';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { Skeleton } from '../../src/components/Skeleton';

// Audit log (admin): every sensitive action in the restaurant, newest first.
// Nothing here can be edited or deleted from the app.
export default function Audit() {
  const t = useTheme();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api('/audit')
      .then((r) => {
        setEntries(r.entries);
        setMore(r.entries.length === 100);
      })
      .catch((err) => setError(err.message));
  }, []);
  useFocusEffect(load);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const r = await api(`/audit?before=${entries[entries.length - 1].id}`);
      setEntries((list) => [...list, ...r.entries]);
      setMore(r.entries.length === 100);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!isAdmin) return <Redirect href="/dashboard" />;

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Audit log" />}>
      {error && !entries ? (
        <View style={{ gap: 12 }}>
          <EmptyState icon="wifi-off" title="Couldn’t load the audit log" text={error} />
          <Button title="Try again" variant="secondary" onPress={load} />
        </View>
      ) : !entries ? (
        <View style={{ gap: 12 }}>
          {[0, 1, 2, 3, 4].map((n) => (
            <Skeleton key={n} height={44} />
          ))}
        </View>
      ) : entries.length === 0 ? (
        <EmptyState icon="history" title="Nothing recorded yet" text="Orders, edits, cancels, discounts and payments are all recorded here." />
      ) : (
        <View style={{ gap: 12 }}>
          <Card style={{ gap: 12 }}>
            {entries.map((entry, index) => (
              <View key={entry.id} style={[{ gap: 2 }, index > 0 && { paddingTop: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }]}>
                <Txt size={14} weight={600}>
                  {describe(entry)}
                </Txt>
                <Txt size={12} color="textSecondary" tabular>
                  {entry.user_name || 'System'}
                  {entry.user_role ? ` (${entry.user_role})` : ''} · {when(entry.at)} · {entry.entity} #{entry.entity_id}
                </Txt>
              </View>
            ))}
          </Card>
          {more ? <Button title="Show older entries" variant="secondary" loading={loadingMore} onPress={loadMore} /> : null}
        </View>
      )}
    </Screen>
  );
}
