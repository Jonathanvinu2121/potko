import { View } from 'react-native';
import { orderTags } from '../lib/orders';
import { Chip } from './Chip';

// The state of an order as a row of small tags (see orderTags). Each tag has words and an icon,
// so the colour is never the only signal.
//   max  show at most this many, then "+2"
export function OrderTags({ order, max = 6, size = 12 }) {
  const tags = orderTags(order);
  const shown = tags.slice(0, max);
  return (
    <View accessibilityLabel={`Status: ${tags.map((x) => x.label).join(', ')}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {shown.map((tag) => (
        <Chip key={tag.key} label={tag.label} icon={tag.icon} tone={tag.tone} size={size} />
      ))}
      {tags.length > shown.length ? <Chip label={`+${tags.length - shown.length}`} size={size} /> : null}
    </View>
  );
}
