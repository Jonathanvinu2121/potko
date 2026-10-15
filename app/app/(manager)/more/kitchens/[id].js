import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useLive } from '../../../../src/store/live';
import { useMenuAdmin } from '../../../../src/store/menu';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Card } from '../../../../src/components/Card';
import { Button } from '../../../../src/components/Button';
import { EmptyState } from '../../../../src/components/EmptyState';
import { Check, SearchField } from '../../../../src/components/Lists';
import { ListState, Notice } from '../../../../src/components/Feedback';

// More > Kitchens > one kitchen: the dishes it cooks. Tick a dish to cook it here, or a whole
// category at once. Usually a dish is at one kitchen; ticked at several, its ticket shows at each.
// A dish left with no kitchen is cooked at the default one.
export default function KitchenDishes() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const terminals = useLive((s) => s.terminals);
  const synced = useLive((s) => s.synced);
  const { categories, items, status, error, load } = useMenuAdmin();
  const terminal = terminals.find((k) => k.id === id);
  const fallback = terminals.find((k) => k.is_default);
  const [picked, setPicked] = useState(null); // dish ids ticked; null until the menu is here
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  // Where a dish is cooked today: its own kitchen, or the default one.
  // A dish can be at several kitchens; one with none of its own is at the default kitchen.
  const kitchensOf = (item) => (item.terminal_ids?.length ? item.terminal_ids : [fallback?.id]);
  const here = useMemo(() => items.filter((i) => kitchensOf(i).includes(id)).map((i) => i.id), [items, id, fallback?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (picked === null && status === 'ready' && terminal) setPicked(here);
  }, [picked, status, terminal, here]);

  if (!terminal) {
    return (
      <Screen scroll={false} header={<AppHeader title="Kitchen" back />}>
        {synced ? <EmptyState icon="chef-hat" title="This kitchen is no longer there" text="Go back to the list of kitchens." /> : <ListState loading />}
      </Screen>
    );
  }

  const chosen = picked ?? [];
  const isDefault = terminal.is_default;
  // The default kitchen cooks whatever no other kitchen has, so its own dishes cannot be unticked here.
  const locked = (item) => isDefault && here.includes(item.id) && !(item.terminal_ids?.length);
  const toggle = (item, on) => setPicked(on ? [...chosen, item.id] : chosen.filter((x) => x !== item.id));
  const words = query.trim().toLowerCase();
  const shown = items.filter((i) => !words || i.name.toLowerCase().includes(words) || String(i.code).toLowerCase().includes(words));
  const changed = picked !== null && (chosen.length !== here.length || chosen.some((x) => !here.includes(x)));
  const nameOf = (terminalId) => terminals.find((k) => k.id === terminalId)?.name;

  const save = async () => {
    setBusy(true);
    try {
      await api(`/terminals/${id}/items`, { method: 'PUT', body: { itemIds: chosen } });
      await Promise.all([load(), useLive.getState().syncFloor()]);
      toast(`${terminal.name} now cooks ${plural(chosen.length, 'dish', 'dishes')}`, { tone: 'success' });
      router.back();
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<AppHeader title={`Dishes at ${terminal.name}`} subtitle="Tick the dishes this kitchen cooks" back />}
      footer={<Button title={`Save · ${plural(chosen.length, 'dish', 'dishes')}`} disabled={!changed} loading={busy} onPress={save} />}
    >
      <View style={{ gap: 16 }}>
        <SearchField value={query} onChangeText={setQuery} placeholder="Search a dish" />
        {isDefault ? (
          <Notice text={`${terminal.name} is the default kitchen: it cooks every dish that no other kitchen has. Tick a dish to bring it back here.`} />
        ) : null}

        {status === 'error' ? (
          <ListState error={error} onRetry={load} />
        ) : status !== 'ready' || picked === null ? (
          <ListState loading rows={5} />
        ) : shown.length === 0 ? (
          <EmptyState icon="silverware-fork-knife" title={items.length ? 'No dish matches' : 'No dishes on the menu yet'} text={items.length ? 'Try another name or code.' : 'Add dishes under More, Menu first.'} />
        ) : (
          categories.map((category) => {
            const dishes = shown.filter((i) => i.category_id === category.id);
            if (dishes.length === 0) return null;
            const free = dishes.filter((i) => !locked(i));
            const all = free.length > 0 && free.every((i) => chosen.includes(i.id));
            const setAll = () => {
              const ids = free.map((i) => i.id);
              setPicked(all ? chosen.filter((x) => !ids.includes(x)) : [...new Set([...chosen, ...ids])]);
            };
            return (
              <Card key={category.id} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                  <View style={{ flex: 1 }}>
                    <Txt size={16} weight={700} numberOfLines={1}>
                      {category.name}
                    </Txt>
                    <Txt size={12} color="textSecondary" tabular>
                      {dishes.filter((i) => chosen.includes(i.id)).length} of {dishes.length} here
                    </Txt>
                  </View>
                  {free.length > 0 ? (
                    <Pressable
                      onPress={setAll}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={all ? `Untick all of ${category.name}` : `Tick all of ${category.name}`}
                      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Txt size={14} weight={600} color="primary">
                        {all ? 'Untick all' : 'Tick all'}
                      </Txt>
                    </Pressable>
                  ) : null}
                </View>
                <View style={{ borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
                  {dishes.map((item) => {
                    const elsewhere = kitchensOf(item).filter((k) => k !== id).map(nameOf).filter(Boolean).join(', ') || null;
                    return (
                      <Check
                        key={item.id}
                        label={item.name}
                        sub={locked(item) ? `${item.code} · cooked here` : elsewhere ? `${item.code} · also at ${elsewhere}` : item.code}
                        checked={chosen.includes(item.id)}
                        disabled={locked(item)}
                        onChange={(on) => toggle(item, on)}
                      />
                    );
                  })}
                </View>
              </Card>
            );
          })
        )}
      </View>
    </Screen>
  );
}
