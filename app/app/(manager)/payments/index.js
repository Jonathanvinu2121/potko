import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../src/theme';
import { useCan } from '../../../src/store/auth';
import { useLive } from '../../../src/store/live';
import { api } from '../../../src/lib/api';
import { useNow, minutesSince } from '../../../src/lib/useNow';
import { money, orderLabel, plural, ago, tableName, duration } from '../../../src/lib/format';
import { isOpen, itemCount, amountDue, allSettled, handedOver, APPROVAL_TYPES, TYPE_ICON } from '../../../src/lib/orders';
import { approvalText } from '../../../src/lib/approvals';
import { Screen } from '../../../src/components/Screen';
import { AppHeader } from '../../../src/components/AppHeader';
import { Txt } from '../../../src/components/Txt';
import { Icon } from '../../../src/components/Icon';
import { Chip } from '../../../src/components/Chip';
import { Tabs } from '../../../src/components/Lists';
import { ListState, Notice } from '../../../src/components/Feedback';
import { IconTile, Avatar } from '../../../src/components/Picture';

const TYPES = [
  { key: 'dine_in', label: 'Dine In' },
  { key: 'takeaway', label: 'Takeaway' },
  { key: 'delivery', label: 'Delivery' },
];
const KINDS = ['discount', 'cancel', 'void', 'refund'];

// Payments & Approvals.
//   Payments   every bill waiting to be settled. Choose one, then review it.
//   Approvals  requests that need a manager: discount, cancellation, void, refund.
export default function Payments() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const collects = useCan('payments.collect');
  const decides = useCan('approvals.decide');
  const orders = useLive((s) => s.orders);
  const areas = useLive((s) => s.areas);
  const pending = useLive((s) => s.approvals);
  const synced = useLive((s) => s.synced);
  const now = useNow();
  const [tab, setTab] = useState(params.tab === 'approvals' || !collects ? 'approvals' : 'payments');
  const [type, setType] = useState(null);
  const [areaId, setAreaId] = useState(null);
  const [kind, setKind] = useState(null);
  const [decided, setDecided] = useState([]);

  // Requests decided in the last day are listed under the waiting ones.
  useFocusEffect(
    useCallback(() => {
      if (!decides) return;
      api('/approvals')
        .then((r) => setDecided(r.approvals))
        .catch(() => {});
    }, [decides, pending.length])
  );

  // The queue: bills that were asked for, and bills where part of the money is already in.
  const queue = orders
    .filter((o) => isOpen(o) && (o.bill_requested_at || o.paid_total > 0))
    .sort((a, b) => new Date(a.bill_requested_at ?? a.created_at) - new Date(b.bill_requested_at ?? b.created_at));
  const served = orders.filter((o) => isOpen(o) && allSettled(o) && !o.bill_requested_at && !(o.paid_total > 0)).length;
  const shown = queue.filter((o) => (!type || o.type === type) && (!areaId || o.area_id === areaId));

  const requests = [...pending, ...decided.filter((d) => !pending.some((p) => p.id === d.id))];
  const listed = requests.filter((a) => !kind || a.type === kind);
  const tabs = [
    ...(collects ? [{ value: 'payments', label: 'Payments', icon: 'cash-register', badge: queue.length || undefined }] : []),
    ...(decides ? [{ value: 'approvals', label: 'Approvals', icon: 'bell-outline', badge: pending.length || undefined }] : []),
  ];

  return (
    <Screen edges={['top', 'left', 'right']} header={<AppHeader title="Payments & Approvals" />}>
      <View style={{ gap: 12 }}>
        {tabs.length > 1 ? <Tabs options={tabs} value={tab} onChange={setTab} /> : null}

        {tab === 'payments' ? (
          <>
            <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={`All ${queue.length}`} selected={!type} onPress={() => setType(null)} />
              {TYPES.map((x) => (
                <Chip key={x.key} label={`${x.label} ${queue.filter((o) => o.type === x.key).length}`} selected={type === x.key} onPress={() => setType(type === x.key ? null : x.key)} />
              ))}
            </ScrollView>
            {areas.length > 1 ? (
              <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {areas.map((a) => (
                  <Chip key={a.id} label={`${a.name} ${queue.filter((o) => o.area_id === a.id).length}`} selected={areaId === a.id} onPress={() => setAreaId(areaId === a.id ? null : a.id)} />
                ))}
              </ScrollView>
            ) : null}

            {!synced ? (
              <ListState loading rowHeight={92} />
            ) : shown.length === 0 ? (
              <ListState empty icon="cash-check" title={queue.length ? 'No bills match' : 'No bills waiting'} text={queue.length ? 'Clear the filters to see every bill in the queue.' : 'A bill joins this queue when a waiter asks for it.'} />
            ) : (
              shown.map((order) => {
                const due = amountDue(order);
                return (
                  <Pressable
                    key={order.id}
                    onPress={() => router.push(`/payments/bill/${order.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${orderLabel(order)}, ${money(due)}, proceed to bill`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: pressed ? t.c.pressed : t.c.card })}
                  >
                    <IconTile icon={TYPE_ICON[order.type]} tone={order.paid_total > 0 ? 'warning' : 'primary'} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt size={18} weight={700} numberOfLines={1}>
                        {order.type === 'dine_in' ? order.table_label : orderLabel(order)}
                      </Txt>
                      <Txt size={13} color="textSecondary" numberOfLines={2}>
                        {[order.guests ? plural(order.guests, 'Guest') : null, order.area_name, order.waiter_name, handedOver(order) ? (order.type === 'dine_in' ? 'Table closed' : 'Closed') : null].filter(Boolean).join(' · ')}
                      </Txt>
                      <Txt size={12} color="textSecondary" tabular numberOfLines={1}>
                        #{order.number} · {plural(itemCount(order), 'item')} · waiting {duration(minutesSince(order.bill_requested_at ?? order.created_at, now))}
                        {order.paid_total > 0 ? ` · ${money(order.paid_total)} paid` : ''}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Txt size={18} weight={700} tabular>
                        {money(due)}
                      </Txt>
                      <Chip label="Proceed" tone="primary" />
                    </View>
                  </Pressable>
                );
              })
            )}
            {served > 0 ? <Notice text={`${plural(served, 'order')} fully served and not yet asked for the bill. Open ${served === 1 ? 'it' : 'one'} from Tables to bill it now.`} /> : null}
          </>
        ) : (
          <>
            <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={`All ${pending.length}`} selected={!kind} onPress={() => setKind(null)} />
              {KINDS.map((k) => (
                <Chip key={k} label={`${APPROVAL_TYPES[k].label} ${pending.filter((a) => a.type === k).length}`} selected={kind === k} onPress={() => setKind(kind === k ? null : k)} />
              ))}
            </ScrollView>

            {!synced ? (
              <ListState loading rowHeight={110} />
            ) : listed.length === 0 ? (
              <ListState empty icon="shield-check-outline" title="Nothing waiting" text="Discount, cancellation, void and refund requests appear here the moment they are made." />
            ) : (
              listed.map((a) => {
                const meta = APPROVAL_TYPES[a.type] ?? APPROVAL_TYPES.discount;
                const text = approvalText(a);
                const waiting = a.status === 'pending';
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => router.push(`/payments/approval/${a.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${meta.title}, ${a.table_label ? tableName(a.table_label) : `order ${a.order_number}`}, ${a.status}`}
                    style={({ pressed }) => ({ gap: 8, padding: 14, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: pressed ? t.c.pressed : t.c.card, opacity: waiting ? 1 : 0.75 })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                      <IconTile icon={meta.icon} tone={meta.tone} size={40} />
                      <View style={{ flex: 1 }}>
                        <Txt size={16} weight={700}>
                          {meta.title}
                        </Txt>
                        <Txt size={13} color="textSecondary" tabular>
                          {a.table_label ? tableName(a.table_label) : orderLabel({ type: a.order_type, customer_name: a.customer_name, car_number: a.car_number })} · Order #{a.order_number}
                        </Txt>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Chip label={waiting ? 'Pending' : a.status === 'approved' ? 'Approved' : 'Rejected'} tone={waiting ? 'warning' : a.status === 'approved' ? 'success' : 'neutral'} size={12} />
                        <Txt size={12} color="textSecondary">
                          {ago(a.created_at, now)}
                        </Txt>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Txt size={14} style={{ flex: 1 }}>
                        {text.line}
                      </Txt>
                      {text.amount ? (
                        <Txt size={17} weight={700} color="error" tabular>
                          − {money(text.amount)}
                        </Txt>
                      ) : null}
                      <Icon name="chevron-right" color="textSecondary" />
                    </View>
                    {a.payload?.reason ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: t.c.pressed }}>
                        <Icon name="message-outline" size={14} color="textSecondary" />
                        <Txt size={13} color="textSecondary">
                          {a.payload.reason}
                        </Txt>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Avatar name={a.requested_by_name} size={24} />
                      <Txt size={13} color="textSecondary">
                        Requested by {a.requested_by_name}
                        {a.requested_by_role ? ` (${a.requested_by_role})` : ''}
                        {a.decided_by_name ? ` · ${a.status} by ${a.decided_by_name}` : ''}
                      </Txt>
                    </View>
                  </Pressable>
                );
              })
            )}
          </>
        )}
      </View>
    </Screen>
  );
}
