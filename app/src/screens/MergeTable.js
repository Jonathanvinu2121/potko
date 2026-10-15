import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth, useCan } from '../store/auth';
import { useLive } from '../store/live';
import { send } from '../lib/ws';
import { toast } from '../store/toast';
import { tableAllowed } from '../lib/access';
import { groupLabel } from '../lib/units';
import { money, plural } from '../lib/format';
import { Screen } from '../components/Screen';
import { AppHeader } from '../components/AppHeader';
import { Txt } from '../components/Txt';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Check } from '../components/Lists';
import { Success, Notice } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { usePrices } from '../lib/prices';

const numberOf = (label) => Number(String(label).slice(String(label).lastIndexOf('.') + 1)) || 0;

// Merge Table, in the steps of the "finals" design: select the tables, preview what they become,
// then the success page. It brings tables together in the two ways a floor does it:
//   opened on a split table   merge its parts back (T4.1 + T4.2). Free parts simply give their
//                             seats back; parts with bills become one bill.
//   opened on a whole table   join other tables in the same dining area to it for one party
//                             (T3 + T4). The party's order and bill stay on the first table.
// A bill that has been paid is never folded into another.
//   orderPath(id)  where "View Order" leads for this role
export function MergeTable({ tableId, orderPath }) {
  const router = useRouter();
  const userId = useAuth((s) => s.user?.id);
  const access = useAuth((s) => s.user?.access);
  const manageAll = useCan('orders.manage');
  const tables = useLive((s) => s.tables);
  const orders = useLive((s) => s.orders);
  const asked = tables.find((x) => x.id === tableId);
  const start = asked?.joined_to_id ? tables.find((x) => x.id === asked.joined_to_id) : asked;
  const parentId = start?.status === 'split' ? start.id : start?.parent_table_id;
  const parts = parentId ? tables.filter((x) => x.parent_table_id === parentId).sort((a, b) => numberOf(a.label) - numberOf(b.label)) : [];
  const parent = parentId ? tables.find((x) => x.id === parentId) : null;
  const joining = !parentId;
  const [picked, setPicked] = useState(null); // ids; null until the choices are known
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('select'); // select | preview

  const orderOf = (table) => orders.find((o) => o.id === table.order_id);
  // Why a table cannot be part of this, or null when it can.
  const block = (table) => {
    if (table.order_status === 'paid') return 'Already paid';
    if (table.order_id) {
      if (!manageAll && table.order_waiter_id !== userId) return `Served by ${table.order_waiter_name ?? 'another waiter'}`;
      const order = orderOf(table);
      if (order?.paid_total > 0) return 'A payment was already taken';
      if (order?.pending_approvals?.length > 0) return 'An approval is pending';
    } else if (table.locked_by && table.locked_by !== userId && !manageAll) return `Taken by ${table.locked_by_name}`;
    return null;
  };

  // Joining: the other whole tables of the same dining area that this person may use.
  const others = joining && start
    ? tables.filter((x) => x.id !== start.id && x.active && x.area_id === start.area_id && !x.parent_table_id && !x.joined_to_id && x.status !== 'split' && (manageAll || tableAllowed(access, x)))
    : [];
  const choices = joining ? others : parts;
  const chosen = picked ?? (joining ? [] : parts.filter((p) => !block(p)).map((p) => p.id));
  const ids = joining && start ? [start.id, ...chosen] : chosen;
  const key = ids.join(',');

  // What will happen comes from the server, so it is exactly what will be saved.
  useEffect(() => {
    setPreview(null);
    if (result || ids.length < 2) return undefined;
    let current = true;
    send('table.merge', { tableIds: ids, preview: true })
      .then((p) => current && setPreview(p))
      .catch((err) => current && setPreview({ error: err.message }));
    return () => {
      current = false;
    };
  }, [key, !!result]); // eslint-disable-line react-hooks/exhaustive-deps

  const prices = usePrices();
  const guestsOf = (table) => table.order_guests ?? orderOf(table)?.guests ?? 0;
  const itemsOf = (table) => table.order_item_count ?? 0;
  // "4 people · 3 items · ₹680", or "Free · 4 seats".
  const facts = (table) =>
    table.order_id
      ? [guestsOf(table) ? plural(guestsOf(table), 'person', 'people') : null, plural(itemsOf(table), 'item'), prices.show && table.order_total > 0 ? money(table.order_total) : null].filter(Boolean).join(' · ')
      : `Free · ${plural(table.seats, 'seat')}`;
  const picks = (joining ? [start, ...others] : parts).filter((x) => x && ids.includes(x.id));
  const people = picks.reduce((n, x) => n + guestsOf(x), 0);
  const items = picks.reduce((n, x) => n + itemsOf(x), 0);
  const seats = picks.reduce((n, x) => n + x.seats, 0);
  const together = picks.map((x) => x.label).join(' + ');

  // ---------- Success ----------
  if (result) {
    const name = groupLabel(result.table);
    const order = result.merged;
    return (
      <Screen header={<AppHeader title="Merge Table" />} footer={<View style={{ flexDirection: 'row', gap: 8 }}>
        {order && orderPath ? <Button title="View Order" variant="secondary" onPress={() => router.replace(orderPath(order.order_id))} style={{ flex: 1 }} /> : null}
        <Button title="Done" onPress={() => router.back()} style={{ flex: 1 }} />
      </View>}>
        <Success title="Tables Merged Successfully!" text={`Table ${together.replace(/ \+ ([^+]*)$/, ' and $1')} have been merged into a single table.`}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' }}>
            <View style={{ flex: 1 }}>
              <Txt size={18} weight={700}>
                {order?.table_label ?? name}
              </Txt>
              <Txt size={13} color="textSecondary">
                {[people ? plural(people, 'person', 'people') : null, plural(items, 'item')].filter(Boolean).join(' · ')}
              </Txt>
            </View>
            {order && prices.show ? (
              <Txt size={18} weight={700} tabular>
                {money(order.total)}
              </Txt>
            ) : null}
          </Card>
        </Success>
      </Screen>
    );
  }

  if (!start || (!joining && parts.length < 2)) {
    return (
      <Screen scroll={false} header={<AppHeader title="Merge Table" back />}>
        <EmptyState icon="call-merge" title="Nothing to merge" text="This table is whole again already. Go back to the tables." />
      </Screen>
    );
  }

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await send('table.merge', { tableIds: ids }));
    } catch (err) {
      toast(err.message, { icon: 'alert-circle-outline', tone: 'error', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  // ---------- Preview ----------
  if (step === 'preview') {
    return (
      <Screen
        header={<AppHeader title="Merge Tables" back onBack={() => setStep('select')} />}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Back" variant="secondary" disabled={busy} onPress={() => setStep('select')} style={{ flex: 1 }} />
            <Button title="Confirm Merge" icon="call-merge" disabled={!preview || !!preview.error} loading={busy} onPress={confirm} style={{ flex: 1.5 }} />
          </View>
        }
      >
        <View style={{ gap: 14 }}>
          <Txt size={13} color="textSecondary">
            These tables will be merged:
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {picks.map((x, i) => (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1 }}>
                {i > 0 ? <Icon name="plus" size={18} color="primary" /> : null}
                <Card style={{ flex: 1, minWidth: 120, gap: 2, alignItems: 'center' }}>
                  <Txt size={18} weight={700}>
                    {groupLabel(x)}
                  </Txt>
                  <Txt size={12} color="textSecondary" center>
                    {facts(x)}
                  </Txt>
                </Card>
              </View>
            ))}
          </View>
          <View style={{ alignItems: 'center' }}>
            <Icon name="arrow-down" size={22} color="primary" />
          </View>
          <Card style={{ alignItems: 'center', gap: 2 }}>
            <Txt size={20} weight={700}>
              {together}
            </Txt>
            <Txt size={13} color="textSecondary">
              {[people ? plural(people, 'person', 'people') : null, plural(items, 'item')].filter(Boolean).join(' · ')}
            </Txt>
            <Txt size={13} color="textSecondary">
              Capacity: {plural(seats, 'seat')}
            </Txt>
            {preview?.merged && prices.show ? (
              <Txt size={16} weight={700} tabular>
                {money(preview.merged.total)}
              </Txt>
            ) : null}
          </Card>
          {preview?.error ? <Notice tone="error" icon="alert-circle-outline" text={preview.error} /> : null}
          <Notice text="All orders, items and guests will be combined into a single table." />
        </View>
      </Screen>
    );
  }

  // ---------- Select ----------
  return (
    <Screen
      header={<AppHeader title="Merge Table" subtitle={joining ? start.area_name : undefined} back />}
      footer={<Button title="Next" disabled={ids.length < 2} onPress={() => setStep('preview')} />}
    >
      <View style={{ gap: 12 }}>
        <Txt size={13} color="textSecondary">
          {joining ? `Select the tables to merge with ${groupLabel(start)}.` : `Select two or more parts of ${parent?.label ?? ''}.`}
        </Txt>
        {joining ? (
          <Card style={{ gap: 2 }}>
            <Check label={groupLabel(start)} sub={facts(start)} checked disabled onChange={() => {}} />
          </Card>
        ) : null}
        {choices.length === 0 ? (
          <EmptyState icon="table-furniture" title="No other table here" text="Only tables in the same dining area can be merged." />
        ) : (
          <Card style={{ gap: 2 }}>
            {choices.map((table) => {
              const why = block(table);
              return (
                <Check
                  key={table.id}
                  label={groupLabel(table)}
                  sub={why ?? facts(table)}
                  checked={chosen.includes(table.id)}
                  disabled={!!why}
                  onChange={(on) => setPicked(on ? [...chosen, table.id] : chosen.filter((id) => id !== table.id))}
                />
              );
            })}
          </Card>
        )}
      </View>
    </Screen>
  );
}
