import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../src/theme';
import { useMenu } from '../../src/store/menu';
import { useLive } from '../../src/store/live';
import { useMyTerminals } from '../../src/lib/kitchen';
import { api } from '../../src/lib/api';
import { toast } from '../../src/store/toast';
import { Screen } from '../../src/components/Screen';
import { AppHeader } from '../../src/components/AppHeader';
import { Txt } from '../../src/components/Txt';
import { Picture } from '../../src/components/Picture';
import { Toggle } from '../../src/components/Bits';
import { useSwitchConfirm } from '../../src/components/SwitchConfirm';
import { SearchField } from '../../src/components/Lists';
import { ListState } from '../../src/components/Feedback';

// C3 My dishes: the dishes cooked at this chef's kitchens (the server sends no others), one
// switch each. Switched off, a dish shows as unavailable on every waiter's menu at once.
export default function MyDishes() {
  const t = useTheme();
  const { items, categories, status, error, load } = useMenu();
  const mine = useMyTerminals();
  const stations = useLive((s) => s.terminals).filter((k) => mine.includes(k.id)).map((k) => k.name).join(' · ');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(null);
  const switcher = useSwitchConfirm();

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (item, available) => {
    setBusy(item.id);
    try {
      await api(`/menu/items/${item.id}/availability`, { method: 'PATCH', body: { available } });
      toast(available ? `${item.name} is back on the menu` : `${item.name} switched off`, { tone: available ? 'success' : 'neutral' });
      load();
    } catch (err) {
      toast(err.message, { tone: 'error', icon: 'alert-circle-outline' });
    } finally {
      setBusy(null);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q));

  return (
    <Screen header={<AppHeader title="My dishes" subtitle={stations || undefined} back />}>
      <View style={{ gap: 16 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search dishes…" />
        {status !== 'ready' ? (
          <ListState loading={status === 'loading' || status === 'idle'} error={error} onRetry={load} />
        ) : shown.length === 0 ? (
          <ListState empty icon="silverware-fork-knife" title="No dishes here" text="A manager chooses each kitchen's dishes under More, Kitchens." />
        ) : (
          categories
            .filter((c) => shown.some((i) => i.category_id === c.id))
            .map((c) => (
              <View key={c.id} style={{ gap: 8 }}>
                <Txt size={13} weight={700} color="textSecondary" style={{ letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  {c.name}
                </Txt>
                {shown
                  .filter((i) => i.category_id === c.id)
                  .map((item) => (
                    <View
                      key={item.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        padding: 12,
                        minHeight: 64,
                        borderRadius: t.radius.card,
                        borderWidth: t.borderWidth,
                        borderColor: t.c.border,
                        backgroundColor: t.c.card,
                        opacity: item.available ? 1 : 0.7,
                      }}
                    >
                      <Picture imageId={item.image_id} icon="silverware-fork-knife" size={44} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt size={15} weight={600} numberOfLines={1}>
                          {item.name}
                        </Txt>
                        <Txt size={12} color={item.available ? 'successText' : 'error'}>
                          {item.available ? 'On the menu' : 'Switched off'}
                        </Txt>
                      </View>
                      <Toggle quiet label={item.available ? `Switch off ${item.name}` : `Switch on ${item.name}`} value={item.available} disabled={busy === item.id} onChange={(on) => switcher.ask({ name: item.name, on, text: on ? 'Waiters can order it again.' : 'Waiters cannot order it until it is switched on again.', apply: () => toggle(item, on) })} />
                    </View>
                  ))}
              </View>
            ))
        )}
      </View>
      {switcher.sheet}
    </Screen>
  );
}
