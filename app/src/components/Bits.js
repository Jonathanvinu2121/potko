// Small building blocks shared by the manager and admin screens.
import { Pressable, Switch, View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

// A number with a label, e.g. "₹12,400 · Today's sales". Tappable when onPress is given.
export function Stat({ label, value, icon, tone = 'text', onPress }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 150,
        gap: 6,
        padding: t.d.pad,
        borderRadius: t.radius.card,
        borderWidth: t.borderWidth,
        borderColor: t.c.border,
        backgroundColor: pressed ? t.c.pressed : t.c.card,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <Icon name={icon} size={16} color="textSecondary" /> : null}
        <Txt size={12} weight={600} color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Txt>
        {onPress ? <Icon name="chevron-right" size={16} color="textSecondary" /> : null}
      </View>
      <Txt size={24} weight={700} color={tone} tabular>
        {value}
      </Txt>
    </Pressable>
  );
}

// A titled block of content.
export function Section({ title, right, children }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 }}>
        <Txt size={15} weight={700}>
          {title}
        </Txt>
        {right}
      </View>
      {children}
    </View>
  );
}

// One line in a list: title, optional second line, something at the right. Tappable when onPress is given.
export function Row({ title, subtitle, icon, right, onPress, dim }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? title : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: t.radius.control,
        borderWidth: t.borderWidth,
        borderColor: t.c.border,
        backgroundColor: pressed ? t.c.pressed : t.c.card,
        opacity: dim ? 0.55 : 1,
      })}
    >
      {icon ? <Icon name={icon} color="textSecondary" /> : null}
      <View style={{ flex: 1 }}>
        <Txt size={15} weight={600}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt size={13} color="textSecondary">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
      {onPress && !right ? <Icon name="chevron-right" color="textSecondary" /> : null}
    </Pressable>
  );
}

// An on/off switch with its label. The words say the state, so it never relies on colour.
export function Toggle({ label, value, onChange, disabled }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <Txt size={13} weight={600} color={value ? 'successText' : 'textSecondary'}>
        {label}
      </Txt>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: t.c.disabled, true: t.c.success }}
        thumbColor={t.c.card}
        activeThumbColor={t.c.card}
      />
    </View>
  );
}
