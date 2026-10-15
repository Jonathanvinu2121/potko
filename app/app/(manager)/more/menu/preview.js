import { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../../src/theme';
import { useAuth } from '../../../../src/store/auth';
import { useLive } from '../../../../src/store/live';
import { useMenuAdmin } from '../../../../src/store/menu';
import { money } from '../../../../src/lib/format';
import { Screen } from '../../../../src/components/Screen';
import { AppHeader } from '../../../../src/components/AppHeader';
import { Txt } from '../../../../src/components/Txt';
import { Chip } from '../../../../src/components/Chip';
import { Button } from '../../../../src/components/Button';
import { Picture } from '../../../../src/components/Picture';
import { VegMark } from '../../../../src/components/VegMark';
import { ListState } from '../../../../src/components/Feedback';

// One row of the preview: a label on the left, its values on the right.
function Block({ label, rows }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
      <Txt size={14} weight={600} style={{ width: 96 }}>
        {label}
      </Txt>
      <View style={{ flex: 1, gap: 4 }}>
        {rows.map(([name, value], n) => (
          <View key={n} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt size={14} color="textSecondary" style={{ flex: 1 }}>
              {name}
            </Txt>
            {value !== undefined ? (
              <Txt size={14} tabular>
                {value}
              </Txt>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// Item Preview: everything about one dish, view only. "Edit" (inside the card, under the dish's
// name, as on the Staff Profile) opens the dish form.
export default function ItemPreview() {
  const t = useTheme();
  const router = useRouter();
  const id = Number(useLocalSearchParams().id);
  const tax = useAuth((s) => s.restaurant?.settings?.tax) ?? { rate: 5, mode: 'exclusive' };
  const terminals = useLive((s) => s.terminals);
  const { categories, items, status, error, load } = useMenuAdmin();

  useEffect(() => {
    load();
  }, [load]);

  const item = items.find((i) => i.id === id);
  if (!item) {
    return (
      <Screen header={<AppHeader title="Item Preview" back />}>
        <ListState loading={status !== 'ready' && status !== 'error'} error={status === 'error' ? error : null} onRetry={load} empty={status === 'ready'} icon="food-outline" title="This item is no longer on the menu" />
      </Screen>
    );
  }

  const category = categories.find((c) => c.id === item.category_id);
  const rate = item.tax_rate ?? tax.rate;
  const mode = item.tax_mode ?? tax.mode;
  const at = item.terminal_ids?.length ? item.terminal_ids : [terminals.find((k) => k.is_default)?.id];
  const options = (item.modifier_groups || []).flatMap((g) => g.options || []);
  const pairs = (item.addon_ids || []).map((pid) => items.find((i) => i.id === pid)).filter(Boolean);

  return (
    <Screen header={<AppHeader title="Item Preview" back />}>
      <View style={{ gap: 4, padding: 16, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card }}>
        <View style={{ flexDirection: 'row', gap: 14, paddingBottom: 12 }}>
          <Picture imageId={item.image_id} icon="food-outline" size={88} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <VegMark veg={item.veg} size={14} />
              <Txt size={18} weight={700} style={{ flexShrink: 1 }}>
                {item.name}
              </Txt>
              <Chip label={item.available ? 'Active' : 'Inactive'} tone={item.available ? 'success' : 'neutral'} size={12} />
            </View>
            <Txt size={13} color="textSecondary">
              {[category?.name, item.code].filter(Boolean).join(' · ')}
            </Txt>
            {item.description ? (
              <Txt size={13} color="textSecondary">
                {item.description}
              </Txt>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
              <Button title="Edit" icon="pencil-outline" variant="secondary" onPress={() => router.push(`/more/menu/item?id=${item.id}`)} />
            </View>
          </View>
        </View>
        <Block label="Base Price" rows={[[item.open_price ? 'Entered when ordered' : item.sizes.length ? 'Set by the portions below' : '', item.open_price || item.sizes.length ? undefined : money(item.price)]]} />
        <Block label="Tax" rows={[[mode === 'inclusive' ? 'Included in the price' : 'Added on top', `GST (${rate}%)`]]} />
        {item.sizes.length ? <Block label="Portions" rows={item.sizes.map((s) => [s.label, money(s.price)])} /> : null}
        {options.length ? <Block label="Add-ons" rows={options.map((o) => [o.name, money(o.price)])} /> : null}
        {pairs.length ? <Block label="Goes Well With" rows={pairs.map((p) => [p.name, p.open_price ? 'Open price' : money(p.price)])} /> : null}
        <View style={{ gap: 8, paddingTop: 12, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
          <Txt size={14} weight={600}>
            Available At
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {at.map((tid) => terminals.find((k) => k.id === tid)).filter(Boolean).map((k) => (
              <Chip key={k.id} label={k.name} tone="primary" size={12} />
            ))}
          </View>
        </View>
      </View>
    </Screen>
  );
}
