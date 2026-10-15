import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { minutesSince } from '../lib/useNow';
import { kitchenLabel, kotLabel, isWaiting, newItems, acceptedItems, cookingItems, liveItems, progress } from '../lib/kitchen';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';
import { Button } from './Button';
import { ItemRow } from './ItemRow';
import { TimerChip, timerTone } from './TimerChip';

// The round control at the right of a dish that is cooking: one tap marks it ready.
// 48px, so it is easy to hit with busy hands.
export function ReadyTick({ item, working, disabled, onPress }) {
  const t = useTheme();
  if (item.status === 'ready' || item.status === 'delivered') {
    return (
      <View accessibilityLabel="Ready" style={{ width: 48, height: 48, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.successTint, borderWidth: 2, borderColor: t.c.success }}>
        <Icon name="check" color="successText" />
      </View>
    );
  }
  if (item.status !== 'preparing') return null;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`Mark ${item.name_snapshot} ready`}
      aria-busy={!!working}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: t.radius.pill,
        borderWidth: 2,
        borderColor: working || pressed ? t.c.success : t.c.textSecondary,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed || working ? t.c.successTint : t.c.card,
        opacity: disabled && !working ? 0.5 : 1,
      })}
    >
      {working ? <Icon name="check" color="success" /> : null}
    </Pressable>
  );
}

// One order on the kitchen board. Everything the chef does to it happens right here, so the
// board with all the other orders never leaves the screen:
//   new dishes       Deny / Accept
//   accepted dishes  Deny / Start preparing
//   cooking dishes   a tick beside each one, and All ready
// The top row opens the ticket on its own screen (larger, with prep time), which is optional.
//   busy  the action running anywhere on the board (see useKitchenActions)
export function KitchenTicket({ order, now, busy, online, onOpen, onAccept, onStart, onDeny, onItemReady, onAllReady }) {
  const t = useTheme();
  const fresh = newItems(order);
  const accepted = acceptedItems(order);
  const cooking = cookingItems(order);
  const live = liveItems(order);
  const done = fresh.length === 0 && accepted.length === 0 && cooking.length === 0;
  const { ready, total } = progress(order);
  const minutes = minutesSince(order.created_at, now);
  const tone = done ? 'neutral' : timerTone(minutes);
  const allergy = order.items.some((i) => i.allergy_note);
  const blocked = !!busy || !online;
  const begun = cooking.length > 0 || ready > 0; // part of this ticket is already cooking or ready
  const state =
    fresh.length > 0 ? (begun || accepted.length > 0 ? `${fresh.length} more to accept` : 'New')
    : accepted.length > 0 ? (begun ? `${accepted.length} more to start` : 'Accepted')
    : done ? 'All ready' : `${ready} of ${total} ready`;

  return (
    <View
      style={[
        {
          gap: 12,
          padding: t.d.pad,
          borderRadius: t.radius.card,
          borderWidth: tone === 'neutral' ? t.borderWidth : 2,
          borderColor: tone === 'error' ? t.c.error : tone === 'warning' ? t.c.warning : t.c.border,
          backgroundColor: t.c.card,
        },
        t.shadow,
      ]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${kitchenLabel(order)}, order ${order.number}, ${state}, ${minutes} minutes. Open ticket`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Txt size={20} weight={700} numberOfLines={1}>
            {kitchenLabel(order)}
          </Txt>
          <Txt size={13} weight={600} color="textSecondary" tabular numberOfLines={1}>
            #{order.number}
            {kotLabel(order) ? ` · ${kotLabel(order)}` : ''} · {state}
          </Txt>
        </View>
        {done ? <Chip label="Done" icon="check-circle-outline" tone="success" /> : <TimerChip since={order.created_at} now={now} />}
        <Icon name="chevron-right" color="textSecondary" />
      </Pressable>

      {allergy ? <Chip label="Allergy on this order" icon="alert-outline" tone="error" /> : null}

      <View style={{ gap: 12 }}>
        {live.map((item) => (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
          <ItemRow
            qty={item.qty}
            name={item.name_snapshot}
            veg={item.veg}
            size={item.size}
            customisations={[...(item.addons || []).map((a) => a.name), ...item.customisations]}
            note={item.note ? `Waiter note: ${item.note}` : null}
            allergyNote={item.allergy_note}
            done={item.status === 'ready' || item.status === 'delivered'}
            // On a ticket that is further along, the dishes added later are marked out.
            right={item.status === 'sent' && (begun || accepted.length > 0) ? <Chip label="New" tone="primary" /> : item.status === 'accepted' && begun ? <Chip label="Accepted" icon="check" /> : null}
          />
            </View>
            {isWaiting(item) ? null : <ReadyTick item={item} working={busy === `item:${item.id}`} disabled={blocked} onPress={() => onItemReady(item)} />}
          </View>
        ))}
      </View>

      {fresh.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Deny" variant="secondary" disabled={blocked} onPress={onDeny} style={{ flex: 1 }} />
          <Button title="Accept" icon="check" loading={busy === `${order.id}:accept`} disabled={blocked && busy !== `${order.id}:accept`} onPress={onAccept} style={{ flex: 2 }} />
        </View>
      ) : accepted.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="Deny" variant="secondary" disabled={blocked} onPress={onDeny} style={{ flex: 1 }} />
          <Button title="Start preparing" icon="pot-steam-outline" loading={busy === `${order.id}:start`} disabled={blocked && busy !== `${order.id}:start`} onPress={onStart} style={{ flex: 2 }} />
        </View>
      ) : cooking.length > 1 ? (
        <Button title="All ready" variant="secondary" icon="check-all" loading={busy === `${order.id}:all`} disabled={blocked && busy !== `${order.id}:all`} onPress={onAllReady} />
      ) : null}
    </View>
  );
}
