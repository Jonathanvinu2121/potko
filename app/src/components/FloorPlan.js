import { useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { TABLE_STATUS } from '../lib/orders';
import { money, elapsed } from '../lib/format';
import { minutesSince } from '../lib/useNow';
import { Txt } from './Txt';
import { Icon } from './Icon';
import { TableGraphic } from './TableGraphic';

const SIDE = { small: 64, medium: 76, large: 92 };
const clamp = (v) => Math.max(0, Math.min(1, v));
const partNumber = (label) => Number(String(label).slice(String(label).lastIndexOf('.') + 1)) || 0;

// Tables with no place on the plan yet are laid out in rows of three, so a new area is usable at once.
export function autoPlace(tables) {
  const loose = tables.filter((t) => t.pos_x == null || t.pos_y == null);
  const rows = Math.max(1, Math.ceil(tables.length / 3));
  const spots = [];
  for (let r = 0; r < rows + 2; r += 1) for (let c = 0; c < 3; c += 1) spots.push({ x: 0.18 + c * 0.32, y: Math.min(0.94, 0.12 + r * (0.8 / Math.max(rows, 3))) });
  const taken = (s) => tables.some((t) => t.pos_x != null && Math.abs(t.pos_x - s.x) < 0.2 && Math.abs(t.pos_y - s.y) < 0.12);
  const free = spots.filter((s) => !taken(s));
  const placed = new Map();
  loose.forEach((t, i) => placed.set(t.id, free[i] ?? { x: 0.18 + (i % 3) * 0.32, y: 0.94 }));
  return tables.map((t) => (placed.has(t.id) ? { ...t, pos_x: placed.get(t.id).x, pos_y: placed.get(t.id).y, unplaced: true } : t));
}

function tileSize(table) {
  const side = SIDE[table.size] ?? SIDE.medium;
  return table.shape === 'rectangle' || table.shape === 'booth' ? { w: Math.round(side * 1.45), h: side } : { w: side, h: side };
}

// The plan of one dining area: every table where it stands in the room, drawn with its chairs.
//   Service view  tables are coloured by what is happening there and can be tapped. A split
//                 table is drawn cut into its parts; tables joined for one party share a colour
//                 and carry a link mark. onPress(table) gets the whole table that was tapped,
//                 onLongPress(table) the one that was held.
//   Edit view     (editable) tables are plain and can be dragged; onMove(id, x, y) gets the new
//                 place as 0..1 of the plan's width and height.
// tables: the area's tables. Parts of a split table are found among them and drawn inside their table.
export function FloorPlan({ tables, now, onPress, onLongPress, editable, onMove, selectedId, showAmount = true }) {
  const t = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const whole = tables.filter((x) => !x.parent_table_id);
  const placed = autoPlace(whole);
  const partsOf = (table) => tables.filter((x) => x.parent_table_id === table.id).sort((a, b) => partNumber(a.label) - partNumber(b.label));
  const leadOf = (table) => (table.joined_to_id ? tables.find((x) => x.id === table.joined_to_id) : null);

  return (
    <View
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.width * 1.12 })}
      style={{ height: box.h || 360, borderRadius: t.radius.card, borderWidth: t.borderWidth, borderColor: t.c.border, backgroundColor: t.c.card, overflow: 'hidden' }}
    >
      {/* A faint grid, so the plan reads as a floor and tables have something to line up with. */}
      {box.w > 0
        ? [1, 2, 3, 4, 5].map((n) => (
            <View key={`v${n}`} pointerEvents="none" style={{ position: 'absolute', left: (box.w * n) / 6, top: 0, bottom: 0, width: 1, backgroundColor: t.c.background }} />
          ))
        : null}
      {box.w > 0
        ? [1, 2, 3, 4, 5, 6].map((n) => (
            <View key={`h${n}`} pointerEvents="none" style={{ position: 'absolute', top: (box.h * n) / 7, left: 0, right: 0, height: 1, backgroundColor: t.c.background }} />
          ))
        : null}
      {box.w > 0
        ? placed.map((table) => (
            <Tile
              key={table.id}
              table={table}
              parts={editable ? [] : partsOf(table)}
              lead={editable ? null : leadOf(table)}
              box={box}
              now={now}
              editable={editable}
              selected={selectedId === table.id}
              showAmount={showAmount}
              onPress={onPress ? () => onPress(table) : undefined}
              onLongPress={onLongPress ? () => onLongPress(table) : undefined}
              onMove={onMove}
            />
          ))
        : null}
    </View>
  );
}

function Tile({ table, parts, lead, box, now, editable, selected, showAmount, onPress, onLongPress, onMove }) {
  const t = useTheme();
  const size = tileSize(table);
  const [drag, setDrag] = useState(null); // { dx, dy } while a finger is moving the tile
  const live = useRef({});
  live.current = { table, box, size, onMove, onPress };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderMove: (_, g) => setDrag({ dx: g.dx, dy: g.dy }),
      onPanResponderRelease: (_, g) => {
        const { table: tb, box: bx, size: sz, onMove: move, onPress: press } = live.current;
        setDrag(null);
        if (Math.abs(g.dx) < 4 && Math.abs(g.dy) < 4) return press?.();
        // Keep the whole tile inside the plan and snap to a fine grid so tables line up.
        const snap = (v) => Math.round(v * 50) / 50;
        const x = clamp((tb.pos_x * bx.w + g.dx) / bx.w);
        const y = clamp((tb.pos_y * bx.h + g.dy) / bx.h);
        const minX = sz.w / 2 / bx.w;
        const minY = sz.h / 2 / bx.h;
        move?.(tb.id, snap(Math.max(minX, Math.min(1 - minX, x))), snap(Math.max(minY, Math.min(1 - minY, y))));
      },
      onPanResponderTerminate: () => setDrag(null),
    })
  ).current;

  // What the table shows: its parts when split, its lead's state when joined to another table.
  const shown = lead ?? table;
  const status = TABLE_STATUS[shown.status] ?? TABLE_STATUS.free;
  const split = parts.length > 0;
  const linked = !!lead || (table.joined || []).length > 0;
  const pieces = split
    ? parts.map((p) => ({ key: p.id, seats: p.seats, status: p.status, label: p.label, short: `.${partNumber(p.label)}` }))
    : [{ key: table.id, seats: table.seats, status: shown.status, label: table.label, short: table.label }];
  const left = Math.max(0, Math.min(box.w - size.w, table.pos_x * box.w - size.w / 2)) + (drag?.dx ?? 0);
  const top = Math.max(0, Math.min(box.h - size.h - 14, table.pos_y * box.h - size.h / 2)) + (drag?.dy ?? 0);
  const minutes = !split && shown.order_created_at ? minutesSince(shown.order_created_at, now) : null;
  const caption = editable || split ? null : [minutes === null ? null : elapsed(minutes), showAmount && !lead && shown.order_total > 0 ? money(shown.order_total) : null].filter(Boolean).join(' · ');
  const said = split
    ? `${table.label}, split into ${parts.map((p) => `${p.label} ${(TABLE_STATUS[p.status] ?? TABLE_STATUS.free).label}`).join(', ')}`
    : `${table.label}, ${table.seats} seats${editable ? '' : `, ${status.label}`}${lead ? `, joined to ${lead.label}` : ''}`;

  const body = (
    <View style={{ width: size.w, alignItems: 'center', opacity: table.active ? 1 : 0.45, ...(drag ? { transform: [{ scale: 1.06 }] } : null) }}>
      <TableGraphic width={size.w} height={size.h} shape={split ? 'rectangle' : table.shape} pieces={pieces} plain={editable} selectedKey={editable && (selected || drag) ? table.id : undefined} labelSize={size.h >= 76 ? 14 : 13} />
      {linked && !editable ? (
        <View style={{ position: 'absolute', right: -2, top: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.card, borderWidth: t.borderWidth, borderColor: t.c.border }}>
          <Icon name="link-variant" size={12} color="textSecondary" />
        </View>
      ) : null}
      {caption ? (
        <Txt size={10} weight={600} color="textSecondary" tabular numberOfLines={1} style={{ marginTop: 2 }}>
          {caption}
        </Txt>
      ) : null}
    </View>
  );

  if (editable) {
    return (
      <View {...responder.panHandlers} accessibilityRole="button" accessibilityLabel={`${said}. Drag to move.`} style={{ position: 'absolute', left, top, zIndex: drag ? 5 : 1 }}>
        {body}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={said} hitSlop={4} style={({ pressed }) => ({ position: 'absolute', left, top, opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}

// The colours of the plan, with their names: never colour alone.
export function FloorLegend({ keys = ['free', 'occupied', 'preparing', 'ready', 'needs_payment'] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {keys.map((key) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, borderWidth: 2, borderColor: key === 'free' ? t.c.disabled : t.c[TABLE_STATUS[key].line], backgroundColor: t.c[TABLE_STATUS[key].tint] }} />
          <Txt size={12} color="textSecondary">
            {TABLE_STATUS[key].label}
          </Txt>
        </View>
      ))}
    </View>
  );
}
