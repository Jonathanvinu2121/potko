import { View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';

// Shown wherever a list has nothing in it yet, e.g. "Nothing ready yet".
export function EmptyState({ icon = 'bell-outline', title, text }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: t.radius.pill,
          backgroundColor: t.c.successTint,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        <Icon name={icon} size={32} color="successText" />
      </View>
      <Txt size={17} weight={700} center>
        {title}
      </Txt>
      {text ? (
        <Txt color="textSecondary" center style={{ maxWidth: 300 }}>
          {text}
        </Txt>
      ) : null}
    </View>
  );
}
