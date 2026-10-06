import { View } from 'react-native';
import { useTheme } from '../theme';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { Chip } from './Chip';

// One ordered dish, drawn the same way on waiter and chef screens:
// big orange quantity, name, Veg / Non-veg chip, size chip, customisation chips,
// the waiter's note in italic grey and a red allergy row when there is one.
//   right  anything to show at the right of the name (a price, a status pill)
//   done   strikes the name through (the chef has finished this dish)
export function ItemRow({ qty, name, veg, size, customisations = [], note, allergyNote, right, done, children }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Txt size={20} weight={700} color="primary" tabular style={{ minWidth: 38 }}>
        {qty}×
      </Txt>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Txt size={17} weight={600} color={done ? 'textSecondary' : 'text'} style={[{ flex: 1 }, done && { textDecorationLine: 'line-through' }]}>
            {name}
          </Txt>
          {right}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label={veg ? 'Veg' : 'Non-veg'} tone={veg ? 'success' : 'error'} />
          {size ? <Chip label={size} /> : null}
          {customisations.map((c) => (
            <Chip key={c} label={c} tone="primary" />
          ))}
        </View>
        {note ? (
          <Txt size={13} italic color="textSecondary">
            {note}
          </Txt>
        ) : null}
        {allergyNote ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              padding: 8,
              borderRadius: t.radius.control,
              backgroundColor: t.c.errorTint,
            }}
          >
            <Icon name="alert-outline" size={16} color="error" />
            <Txt size={13} weight={600} color="error" style={{ flex: 1 }}>
              Allergy: {allergyNote}
            </Txt>
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}
