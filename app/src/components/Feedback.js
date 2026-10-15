// Screens' "it worked" and "it did not load" moments.
import { View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

// A big green tick with what just happened: "Table split successfully", "Payment successful".
// Anything below (a summary, the buttons) is passed as children.
export function Success({ title, text, children }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingTop: 8 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: t.c.successTint, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: t.c.success, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check-bold" size={32} color="onPrimary" />
        </View>
      </View>
      <Txt size={20} weight={700} center accessibilityRole="header" style={{ marginTop: 4 }}>
        {title}
      </Txt>
      {text ? (
        <Txt color="textSecondary" center>
          {text}
        </Txt>
      ) : null}
      {children ? <View style={{ alignSelf: 'stretch', gap: 12, marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}

// What a list shows while it loads, when loading failed (with a way to try again), or when it is empty.
// Returns null when there is content to show.
export function ListState({ loading, error, empty, onRetry, icon, title, text, rows = 3, rowHeight = 64 }) {
  const t = useTheme();
  if (error) {
    return (
      <View style={{ gap: 12 }}>
        <EmptyState icon="wifi-off" title="Couldn’t load this" text={error} />
        {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (loading) {
    return (
      <View style={{ gap: 10 }}>
        {Array.from({ length: rows }, (_, n) => (
          <Skeleton key={n} height={rowHeight} radius={t.radius.control} />
        ))}
      </View>
    );
  }
  if (empty) return <EmptyState icon={icon} title={title} text={text} />;
  return null;
}

// A coloured note inside a screen: why something is disabled, a rule worth knowing.
export function Notice({ icon = 'information-outline', tone = 'neutral', title, text, children }) {
  const t = useTheme();
  const colours = { neutral: ['pressed', 'textSecondary'], primary: ['primaryTint', 'primary'], warning: ['warningTint', 'warningText'], error: ['errorTint', 'error'], success: ['successTint', 'successText'] }[tone];
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.c[colours[0]] }}>
      <Icon name={icon} size={20} color={colours[1]} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Txt size={14} weight={700} color={tone === 'neutral' ? 'text' : colours[1]}>
            {title}
          </Txt>
        ) : null}
        {text ? (
          <Txt size={13} color={tone === 'neutral' ? 'textSecondary' : colours[1]}>
            {text}
          </Txt>
        ) : null}
        {children}
      </View>
    </View>
  );
}
