import { useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { useTheme } from '../theme';
import { Icon } from './Icon';

// A list whose rows are put in order by dragging the ⠿ handle at their left (the "finals" menu
// design). Only the handle starts a drag, so the rest of the row still taps and scrolls normally.
// While a row is dragged the rows it passes slide out of its way; letting go saves the new order.
// Screen readers get "move up" and "move down" actions on the handle instead of dragging.
//   data       the rows, top to bottom
//   keyOf      row => a unique key
//   renderRow  (row, handle) => the row; place `handle` where the ⠿ goes
//   onReorder  (rows in their new order) => void
export function DragList({ data, keyOf, renderRow, onReorder, gap = 8, disabled }) {
  const t = useTheme();
  const [drag, setDrag] = useState(null); // { from, to } while a row is being dragged
  const dy = useRef(new Animated.Value(0)).current;
  const heights = useRef({});
  const live = useRef({ from: -1, to: -1 });
  live.current.data = data;
  live.current.disabled = disabled;

  const step = () => {
    const values = Object.values(heights.current);
    return (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 64) + gap;
  };
  const finish = (from, to) => {
    const rows = [...live.current.data];
    if (to !== from && from >= 0) {
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      onReorder(rows);
    }
    live.current = { from: -1, to: -1, data: live.current.data, disabled: live.current.disabled };
    dy.setValue(0);
    setDrag(null);
  };

  // One responder per position, made once: a drag keeps working while the list re-renders around it.
  const made = useRef({});
  const responder = (index) =>
    made.current[index] ??= PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        live.current = { ...live.current, from: index, to: index };
        setDrag({ from: index, to: index });
      },
      onPanResponderMove: (_, g) => {
        dy.setValue(g.dy);
        const count = live.current.data.length;
        const to = Math.max(0, Math.min(count - 1, live.current.from + Math.round(g.dy / step())));
        if (to !== live.current.to) {
          live.current.to = to;
          setDrag({ from: live.current.from, to });
        }
      },
      onPanResponderRelease: () => finish(live.current.from, live.current.to),
      onPanResponderTerminate: () => finish(live.current.from, live.current.from),
    });

  // How far a row that is not being dragged moves to make room.
  const shift = (index) => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -step();
    if (drag.from > drag.to && index < drag.from && index >= drag.to) return step();
    return 0;
  };

  return (
    <View style={{ gap }}>
      {data.map((row, index) => {
        const dragging = drag?.from === index;
        const handle = (
          <View
            {...responder(index).panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Drag to change the order"
            accessibilityActions={[{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }]}
            onAccessibilityAction={(e) => {
              const to = e.nativeEvent.actionName === 'increment' ? index + 1 : index - 1;
              if (to >= 0 && to < data.length) {
                live.current = { ...live.current, from: index, to };
                finish(index, to);
              }
            }}
            hitSlop={8}
            style={{ width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'auto' : 'grab' }}
          >
            <Icon name="drag-vertical" size={22} color={disabled ? 'disabled' : 'textSecondary'} />
          </View>
        );
        return (
          <Animated.View
            key={keyOf(row)}
            onLayout={(e) => { heights.current[keyOf(row)] = e.nativeEvent.layout.height; }}
            style={{
              zIndex: dragging ? 10 : 0,
              transform: [{ translateY: dragging ? dy : shift(index) }],
              shadowColor: t.c.text,
              shadowOpacity: dragging ? 0.18 : 0,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: dragging ? 6 : 0,
              borderRadius: t.radius.card,
            }}
          >
            {renderRow(row, handle)}
          </Animated.View>
        );
      })}
    </View>
  );
}
