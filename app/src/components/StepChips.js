import { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { Chip } from './Chip';

// The steps of a form across the top, one chip per step with the current one selected. Every
// step form (dish, staff) uses this row, so they look and behave the same. On a narrow screen the
// row scrolls and keeps the current step in view.
//   steps     [{ value, label }], in order
//   value     the current step
//   onChange  (value) => void
//   canOpen   (value, index) => whether a tap opens that step (editing: any; adding: the ones done)
export function StepChips({ steps, value, onChange, canOpen = () => true }) {
  const row = useRef(null);
  const at = useRef({});
  useEffect(() => {
    const x = at.current[value];
    if (x !== undefined) row.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
  }, [value]);

  return (
    <ScrollView ref={row} horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {steps.map((s, n) => (
        <View
          key={s.value}
          onLayout={(e) => {
            at.current[s.value] = e.nativeEvent.layout.x;
            if (s.value === value) row.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 16), animated: false });
          }}
        >
          <Chip label={s.label} selected={s.value === value} onPress={s.value !== value && canOpen(s.value, n) ? () => onChange(s.value) : undefined} />
        </View>
      ))}
    </ScrollView>
  );
}
