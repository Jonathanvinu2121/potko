// List pieces used across the manager screens: a search box, a row for action sheets and
// menus, tick boxes and radio cards, a labelled line of a bill, and tabs.
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { IconTile } from './Picture';

export function SearchField({ value, onChangeText, placeholder = 'Search', style }) {
  const t = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: t.d.control, paddingHorizontal: 12, borderRadius: t.radius.control, backgroundColor: t.c.pressed },
        style,
      ]}
    >
      <Icon name="magnify" size={20} color="textSecondary" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.c.textSecondary}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, minHeight: t.d.control, fontFamily: fonts[400], fontSize: t.size(15), color: t.c.text, ...Platform.select({ web: { outlineStyle: 'none' } }) }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="close-circle" size={18} color="textSecondary" />
        </Pressable>
      ) : null}
    </View>
  );
}

// One line of an action sheet or a menu: icon, title, an optional second line, a chevron.
// A disabled row stays visible and says why in its second line.
export function ActionRow({ icon, title, subtitle, tone = 'neutral', destructive, disabled, onPress, right, chevron = true, tile = true }) {
  const t = useTheme();
  const colour = destructive ? 'error' : tone === 'primary' ? 'primary' : 'text';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      aria-disabled={!!disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: t.radius.control,
        backgroundColor: pressed ? t.c.pressed : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {icon ? tile ? <IconTile icon={icon} tone={destructive ? 'error' : tone} size={36} /> : <Icon name={icon} color={colour} /> : null}
      <View style={{ flex: 1 }}>
        <Txt size={16} weight={600} color={colour}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={13} color="textSecondary">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
      {chevron && onPress && !right ? <Icon name="chevron-right" color="textSecondary" /> : null}
    </Pressable>
  );
}

// A tick box with its label. `card` draws it as a bordered tile (table pickers).
export function Check({ label, sub, checked, onChange, disabled, left }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      aria-checked={!!checked}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}
    >
      <Box checked={checked} />
      {left}
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={checked ? 600 : 400}>
          {label}
        </Txt>
        {sub ? (
          <Txt size={13} color="textSecondary">
            {sub}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Box({ checked, round }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: round ? 11 : 6,
        borderWidth: 2,
        borderColor: checked ? t.c.primary : t.c.disabled,
        backgroundColor: checked && !round ? t.c.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? round ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.c.primary }} /> : <Icon name="check-bold" size={14} color="onPrimary" /> : null}
    </View>
  );
}

// One choice out of a few, drawn as a card with a title and a line of explanation.
export function RadioCard({ title, text, icon, selected, onPress, disabled, children }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={title}
      aria-checked={!!selected}
      style={({ pressed }) => ({
        gap: 10,
        padding: 14,
        borderRadius: t.radius.control,
        borderWidth: selected ? 2 : t.borderWidth,
        borderColor: selected ? t.c.primary : t.c.border,
        backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Box checked={selected} round />
        {icon ? <Icon name={icon} color={selected ? 'primary' : 'textSecondary'} /> : null}
        <View style={{ flex: 1 }}>
          <Txt size={15} weight={600}>
            {title}
          </Txt>
          {text ? (
            <Txt size={13} color="textSecondary">
              {text}
            </Txt>
          ) : null}
        </View>
      </View>
      {selected ? children : null}
    </Pressable>
  );
}

// "Label ............ value" as on a bill. `strong` is the total line.
export function Line({ label, value, strong, tone = 'text', muted }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
      <Txt size={strong ? 17 : 15} weight={strong ? 700 : 400} color={strong ? 'text' : muted ? 'textSecondary' : 'text'} style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt size={strong ? 22 : 15} weight={strong ? 700 : 600} color={tone} tabular>
        {value}
      </Txt>
    </View>
  );
}

// Tabs across the top of a screen: Payments | Approvals, Floor View | List View.
// options: [{ value, label, icon?, badge? }]
// fit: each tab is as wide as its words need (step names of different lengths), not an equal share.
export function Tabs({ options, value, onChange, underline, fit }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[{ flexDirection: 'row' }, underline ? { borderBottomWidth: t.borderWidth, borderBottomColor: t.c.border } : { gap: 6, padding: 4, borderRadius: t.radius.control, backgroundColor: t.c.pressed }]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            aria-selected={selected}
            style={({ pressed }) => [
              { ...(fit ? { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' } : { flex: 1 }), minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6, opacity: pressed ? 0.75 : 1 },
              underline
                ? { borderBottomWidth: 2, borderBottomColor: selected ? t.c.primary : 'transparent', marginBottom: -t.borderWidth }
                : { borderRadius: t.radius.control - 2, backgroundColor: selected ? t.c.primary : 'transparent' },
            ]}
          >
            {option.icon ? <Icon name={option.icon} size={18} color={underline ? (selected ? 'primary' : 'textSecondary') : selected ? 'onPrimary' : 'textSecondary'} /> : null}
            <Txt size={14} weight={600} color={underline ? (selected ? 'primary' : 'textSecondary') : selected ? 'onPrimary' : 'textSecondary'} numberOfLines={1}>
              {option.label}
            </Txt>
            {option.badge ? (
              <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: selected && !underline ? t.c.onPrimary : t.c.error }}>
                <Txt size={11} weight={700} color={selected && !underline ? 'primary' : 'onPrimary'} tabular>
                  {option.badge}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// A green dot and "Online", or grey and "Offline". The word is always there.
export function Presence({ online }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radius.pill, backgroundColor: online ? t.c.successTint : t.c.pressed }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: online ? t.c.success : t.c.disabled }} />
      <Txt size={12} weight={600} color={online ? 'successText' : 'textSecondary'}>
        {online ? 'Online' : 'Offline'}
      </Txt>
    </View>
  );
}
