import { View } from 'react-native';
import { useTheme } from '../theme';
import { money } from '../lib/format';
import { DEAD, ITEM_STATUS } from '../lib/orders';
import { usePrices } from '../lib/prices';
import { Txt } from './Txt';
import { Chip } from './Chip';
import { VegMark } from './VegMark';

// The dishes of an order as a small table: name (with portion, add-ons and notes), quantity,
// unit price and line total. With showStatus each dish also carries its kitchen state.
// Dishes that were removed, cancelled or could not be made are struck through and not charged.
//   right(item)  optional: something at the far right of a row (a menu button)
export function OrderLines({ order, showStatus, showDead = true, right }) {
  const t = useTheme();
  const prices = usePrices();
  const items = order.items.filter((i) => showDead || !DEAD.includes(i.status));
  const head = (label, style) => (
    <Txt size={12} weight={600} color="textSecondary" style={style}>
      {label}
    </Txt>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6, borderBottomWidth: t.borderWidth, borderBottomColor: t.c.border }}>
        {head('Item', { flex: 1 })}
        {head('Qty', { width: 30, textAlign: 'center' })}
        {head('Price', { width: 58, textAlign: 'right' })}
        {head('Total', { width: 66, textAlign: 'right' })}
        {right ? <View style={{ width: 28 }} /> : null}
      </View>
      {items.map((item) => {
        const dead = DEAD.includes(item.status);
        const status = ITEM_STATUS[item.status];
        const details = [item.size, ...(item.addons || []).map((a) => a.name), ...(item.customisations || [])].filter(Boolean);
        return (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, borderBottomWidth: t.borderWidth, borderBottomColor: t.c.border }}>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <VegMark veg={item.veg} />
                <Txt size={15} weight={600} color={dead ? 'textSecondary' : 'text'} style={[{ flex: 1 }, dead && { textDecorationLine: 'line-through' }]}>
                  {item.name_snapshot}
                </Txt>
              </View>
              {details.length ? (
                <Txt size={12} color="textSecondary">
                  {details.join(' · ')}
                </Txt>
              ) : null}
              {item.note ? (
                <Txt size={12} italic color="textSecondary">
                  “{item.note}”
                </Txt>
              ) : null}
              {item.allergy_note ? (
                <Txt size={12} weight={600} color="error">
                  Allergy: {item.allergy_note}
                </Txt>
              ) : null}
              {showStatus || dead ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <Chip label={status.label} icon={status.icon} tone={status.tone} size={11} />
                  {item.kot_number ? (
                    <Txt size={11} color="textSecondary" tabular>
                      KOT #{item.kot_number}
                    </Txt>
                  ) : null}
                  {item.unavailable_reason ? (
                    <Txt size={12} color="error">
                      {item.unavailable_reason}
                    </Txt>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Txt size={14} weight={600} tabular style={{ width: 30, textAlign: 'center' }}>
              {item.qty}
            </Txt>
            <Txt size={14} color="textSecondary" tabular style={{ width: 58, textAlign: 'right' }}>
              {prices.show ? money(item.unit_price) : ''}
            </Txt>
            <Txt size={14} weight={700} color={dead ? 'textSecondary' : 'text'} tabular style={[{ width: 66, textAlign: 'right' }, dead && { textDecorationLine: 'line-through' }]}>
              {prices.show ? money(Math.round(item.qty * item.unit_price * 100) / 100) : ''}
            </Txt>
            {right ? <View style={{ width: 28, alignItems: 'flex-end' }}>{right(item)}</View> : null}
          </View>
        );
      })}
    </View>
  );
}
