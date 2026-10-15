// Form pieces for the set-up screens: a menu of actions for one row, a labelled group of
// choices, an on/off row with its explanation, and a labelled number stepper.
import { Pressable, Switch, View } from 'react-native';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Stepper } from './Stepper';
import { ActionRow } from './Lists';

// The menu behind a row's three dots.
//   actions: [{ icon, title, subtitle?, destructive?, disabled?, onPress }]  (falsy entries are skipped)
export function ActionSheet({ visible, title, onClose, actions = [] }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View>
        {actions.filter(Boolean).map((action) => (
          <ActionRow
            key={action.title}
            icon={action.icon}
            title={action.title}
            subtitle={action.subtitle}
            destructive={action.destructive}
            disabled={action.disabled}
            chevron={false}
            tile={false}
            onPress={() => {
              onClose();
              action.onPress();
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

// The three dots that open a row's menu.
export function MoreButton({ onPress, label = 'More actions' }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 36, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.control, backgroundColor: pressed ? t.c.pressed : 'transparent' })}
    >
      <Icon name="dots-vertical" color="textSecondary" />
    </Pressable>
  );
}

// A labelled set of choices where one is picked, shown as tiles that wrap: Indoor / Outdoor / Private.
// options: [{ value, label, icon? }]
export function Choices({ label, required, options, value, onChange, columns }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Txt size={13} weight={600}>
          {label}
          {required ? ' *' : ''}
        </Txt>
      ) : null}
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              aria-checked={selected}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minHeight: 44,
                paddingHorizontal: 14,
                ...(columns ? { flexBasis: `${Math.floor(100 / columns) - 3}%`, flexGrow: 1 } : null),
                borderRadius: t.radius.control,
                borderWidth: selected ? 2 : t.borderWidth,
                borderColor: selected ? t.c.primary : t.c.border,
                backgroundColor: selected ? t.c.primaryTint : pressed ? t.c.pressed : t.c.card,
              })}
            >
              {option.icon ? <Icon name={option.icon} size={18} color={selected ? 'primary' : 'textSecondary'} /> : null}
              <Txt size={14} weight={600} color={selected ? 'primary' : 'text'} numberOfLines={1}>
                {option.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// An on/off setting with a title and a line that says what it does.
export function SwitchRow({ title, text, value, onChange, disabled, icon }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, opacity: disabled ? 0.5 : 1 }}>
      {icon ? <Icon name={icon} color="textSecondary" /> : null}
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
      <Switch
        value={!!value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: t.c.disabled, true: t.c.primary }}
        thumbColor={t.c.card}
        activeThumbColor={t.c.card}
      />
    </View>
  );
}

// "Capacity  [-] 4 [+] seats"
export function NumberRow({ label, required, value, onChange, min = 1, max = 99, unit }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt size={13} weight={600}>
        {label}
        {required ? ' *' : ''}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Stepper value={value} min={min} max={max} onChange={onChange} />
        {unit ? <Txt color="textSecondary">{unit}</Txt> : null}
      </View>
    </View>
  );
}

// A small title above a group of fields inside a long form.
export function FormSection({ title, text, children }) {
  return (
    <View style={{ gap: 10 }}>
      <View>
        <Txt size={15} weight={700}>
          {title}
        </Txt>
        {text ? (
          <Txt size={13} color="textSecondary">
            {text}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}
