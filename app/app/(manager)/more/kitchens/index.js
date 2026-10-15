import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useLive } from '../../../../src/store/live';
import { useCan } from '../../../../src/store/auth';
import { api } from '../../../../src/lib/api';
import { toast } from '../../../../src/store/toast';
import { plural } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Icon } from '../../../../src/components/Icon';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { BottomSheet } from '../../../../src/components/BottomSheet';
import { ListState, Notice } from '../../../../src/components/Feedback';
import { IconTile } from '../../../../src/components/Picture';
import { Check } from '../../../../src/components/Lists';
import { ActionSheet, MoreButton } from '../../../../src/components/Forms';

const fail = (err) => toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });

// More > Kitchens: the kitchens a ticket can be sent to (Main Kitchen, Tandoor, Bar, Dessert).
// Everything about a kitchen is decided here, on the kitchen itself:
//   Dishes   which dishes it cooks (a dish is cooked at one kitchen)
//   Chefs    who works there. A chef's board shows only the tickets of their kitchens, so a
//            kitchen with no chef is cooked by nobody: that is called out.
//   Add a kitchen with the button at the bottom.
export default function Kitchens() {
  const t = useTheme();
  const router = useRouter();
  const mayDishes = useCan('menu.manage');
  const terminals = useLive((s) => s.terminals);
  const synced = useLive((s) => s.synced);
  const mayAssign = useCan('staff.manage');
  const [chefs, setChefs] = useState(null); // every chef of the restaurant; null until loaded
  const [form, setForm] = useState(null); // { id?, name } while the name sheet is open
  const [assign, setAssign] = useState(null); // { terminal, ids } while choosing chefs
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!mayAssign) return;
    api('/users')
      .then((r) => setChefs(r.users.filter((u) => u.role === 'chef' && u.active)))
      .catch(() => setChefs([]));
  }, [mayAssign]);

  const refresh = () => useLive.getState().syncFloor();
  const save = async () => {
    setBusy(true);
    try {
      if (form.id) await api(`/terminals/${form.id}`, { method: 'PATCH', body: { name: form.name } });
      else await api('/terminals', { method: 'POST', body: { name: form.name } });
      toast(form.id ? 'Kitchen renamed' : `${form.name.trim()} added. Give it dishes and a chef next.`, { tone: 'success', duration: 4000 });
      setForm(null);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const saveChefs = async () => {
    setBusy(true);
    try {
      await api(`/terminals/${assign.terminal.id}/chefs`, { method: 'PUT', body: { userIds: assign.ids } });
      toast(`${plural(assign.ids.length, 'chef')} at ${assign.terminal.name}`, { tone: 'success' });
      setAssign(null);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const change = (terminal, body, message) =>
    api(`/terminals/${terminal.id}`, { method: 'PATCH', body })
      .then(() => { toast(message, { tone: 'success' }); return refresh(); })
      .catch(fail);
  const remove = (terminal) =>
    api(`/terminals/${terminal.id}`, { method: 'DELETE' })
      .then(() => { toast(`${terminal.name} deleted`, { tone: 'success' }); return refresh(); })
      .catch(fail);
  const otherTerminals = (chef, terminal) => terminals.filter((k) => k.id !== terminal.id && (k.chefs || []).some((c) => c.id === chef.id)).map((k) => k.name);

  return (
    <Screen header={<AppHeader title="Kitchens" subtitle="Each kitchen, its dishes and its chefs" back />} footer={<Button title="Add Kitchen" icon="plus" onPress={() => setForm({ name: '' })} />}>
      <View style={{ gap: 12 }}>
        {!synced ? (
          <ListState loading rowHeight={112} />
        ) : terminals.length === 0 ? (
          <ListState empty icon="chef-hat" title="No kitchen yet" text="Add the first one. Every dish is sent to a kitchen, and chefs see the tickets of theirs." />
        ) : (
          terminals.map((terminal) => {
            const here = terminal.chefs || [];
            return (
              <View key={terminal.id} style={[{ gap: 12, padding: t.d.pad, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, opacity: terminal.active ? 1 : 0.7 }, t.shadow]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconTile icon="monitor-dashboard" tone={terminal.is_default ? 'primary' : 'neutral'} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt size={17} weight={700} numberOfLines={1}>
                      {terminal.name}
                    </Txt>
                    <Txt size={13} color="textSecondary" numberOfLines={1}>
                      {terminal.is_default ? 'Cooks every dish not given to another kitchen' : terminal.active ? 'Cooks only the dishes given to it' : 'Switched off'}
                    </Txt>
                  </View>
                  {terminal.is_default ? <Chip label="Default" tone="primary" size={12} /> : !terminal.active ? <Chip label="Off" size={12} /> : null}
                  <MoreButton label={`Actions for ${terminal.name}`} onPress={() => setMenu(terminal)} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt size={12} weight={600} color="textSecondary" style={{ letterSpacing: 1 }}>
                      DISHES
                    </Txt>
                    <Txt size={15} weight={600} tabular>
                      {plural(terminal.item_count, 'dish', 'dishes')}
                    </Txt>
                  </View>
                  {mayDishes ? <Button title={terminal.item_count ? 'Change' : 'Add dishes'} variant="secondary" icon="silverware-fork-knife" onPress={() => router.push(`/more/kitchens/${terminal.id}`)} /> : null}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <Txt size={12} weight={600} color="textSecondary" style={{ letterSpacing: 1 }}>
                      CHEFS
                    </Txt>
                    {here.length === 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Icon name="alert-outline" size={16} color="warningText" />
                        <Txt size={13} weight={600} color="warningText" style={{ flex: 1 }}>
                          Nobody yet: its tickets are seen by no one
                        </Txt>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {here.map((chef) => (
                          <Chip key={chef.id} label={chef.name} icon="chef-hat" />
                        ))}
                      </View>
                    )}
                  </View>
                  {mayAssign ? <Button title={here.length ? 'Change' : 'Add chefs'} variant="secondary" icon="account-multiple-plus-outline" onPress={() => setAssign({ terminal, ids: here.map((c) => c.id) })} /> : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      <BottomSheet visible={!!form} onClose={busy ? () => {} : () => setForm(null)} title={form?.id ? 'Rename Kitchen' : 'Add Kitchen'} footer={<Button title={form?.id ? 'Save' : 'Add Kitchen'} disabled={!form?.name?.trim()} loading={busy} onPress={save} />}>
        <TextField label="Kitchen Name" required value={form?.name ?? ''} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder="e.g. Tandoor, Chinese, Grill, Dessert" autoCapitalize="words" maxLength={40} />
      </BottomSheet>

      <BottomSheet
        visible={!!assign}
        onClose={busy ? () => {} : () => setAssign(null)}
        title={assign ? `Chefs at ${assign.terminal.name}` : ''}
        footer={<Button title={assign ? `Save · ${plural(assign.ids.length, 'chef')}` : 'Save'} loading={busy} onPress={saveChefs} />}
      >
        {chefs === null ? (
          <ListState loading rows={2} />
        ) : chefs.length === 0 ? (
          <Notice icon="account-plus-outline" text="There is no chef yet. Add one under More, Staff, then assign them here." />
        ) : (
          <View style={{ gap: 2 }}>
            {chefs.map((chef) => {
              const others = assign ? otherTerminals(chef, assign.terminal) : [];
              return (
                <Check
                  key={chef.id}
                  label={chef.name}
                  sub={others.length ? `Also at ${others.join(', ')}` : 'No other terminal'}
                  checked={!!assign?.ids.includes(chef.id)}
                  onChange={(on) => setAssign((a) => ({ ...a, ids: on ? [...a.ids, chef.id] : a.ids.filter((x) => x !== chef.id) }))}
                />
              );
            })}
          </View>
        )}
      </BottomSheet>

      <ActionSheet
        visible={!!menu}
        title={menu?.name}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { icon: 'pencil-outline', title: 'Rename', onPress: () => setForm({ id: menu.id, name: menu.name }) },
          menu.is_default ? null : { icon: 'star-outline', title: 'Make Default', subtitle: 'Dishes without their own terminal will come here', onPress: () => change(menu, { is_default: true }, `${menu.name} is now the default terminal`) },
          menu.is_default ? null : { icon: menu.active ? 'eye-off-outline' : 'eye-outline', title: menu.active ? 'Switch Off' : 'Switch On', subtitle: menu.active ? 'Its dishes go to the default terminal meanwhile' : undefined, onPress: () => change(menu, { active: !menu.active }, menu.active ? `${menu.name} switched off` : `${menu.name} switched on`) },
          menu.is_default ? null : { icon: 'trash-can-outline', title: 'Delete', destructive: true, onPress: () => remove(menu) },
        ].filter(Boolean) : []}
      />
    </Screen>
  );
}
