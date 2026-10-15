import { View } from 'react-native';
import { useTheme } from '../theme';
import { TABLE_STATUS } from '../lib/orders';
import { Txt } from './Txt';
import { Icon } from './Icon';

const CHAIR = 6; // how deep a chair is drawn
const GAP = 3; // between a chair and the table top

// Where each chair stands around a table of this shape, in the drawing's own pixels.
function chairSpots(shape, seats, w, h) {
  const n = Math.max(0, Math.min(seats, 16));
  const inset = CHAIR + GAP;
  if (shape === 'round') {
    const r = (Math.min(w, h) - inset * 2) / 2 + GAP + CHAIR / 2;
    return Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n;
      return { x: w / 2 + r * Math.cos(a), y: h / 2 + r * Math.sin(a), round: true };
    });
  }
  const top = Math.ceil(n / 2);
  const row = (count, y) => Array.from({ length: count }, (_, i) => ({ x: inset + ((w - inset * 2) * (i + 0.5)) / count, y, wide: Math.min(18, (w - inset * 2) / count - 4) }));
  return [...row(top, CHAIR / 2), ...row(n - top, h - CHAIR / 2)];
}

// A table seen from above, with its chairs. One drawing serves every state of a table:
//   whole   one piece
//   split   pieces: the table top is cut into parts, each as wide as its share of the seats and
//           coloured by what is happening there; every chair takes the colour of its part
//   joined  pieces with linked: the tables of one party, drawn touching, in one colour
// pieces: [{ key, seats, status, label, short }]   (short is used when a piece is narrow)
//   plain  no state colours (the layout editor, a preview before saving)
export function TableGraphic({ width, height, shape = 'square', pieces, linked, plain, selectedKey, labelSize = 14 }) {
  const t = useTheme();
  if (!width || !height) return <View style={{ height: height || 56 }} />;
  const round = shape === 'round' && !linked && pieces.length === 1;
  const seats = pieces.reduce((n, p) => n + p.seats, 0);
  const spots = chairSpots(round ? 'round' : 'rect', seats, width, height).sort((a, b) => a.x - b.x || a.y - b.y);
  const inset = CHAIR + GAP;
  const topW = round ? Math.min(width, height) - inset * 2 : width - inset * 2;
  const topH = round ? topW : height - inset * 2;

  const look = (piece) => {
    const status = TABLE_STATUS[piece.status] ?? TABLE_STATUS.free;
    const picked = selectedKey != null && selectedKey === piece.key;
    if (plain) return { fill: picked ? t.c.primaryTint : t.c.background, line: picked ? t.c.primary : t.c.disabled, chair: picked ? t.c.primary : t.c.disabled };
    const free = piece.status === 'free';
    return { fill: t.c[status.tint], line: free ? t.c.disabled : t.c[status.line], chair: free ? t.c.disabled : t.c[status.line] };
  };

  // Chairs go to the pieces left to right, as many as each piece has seats.
  let seat = 0;
  const chairs = pieces.flatMap((piece) => {
    const mine = spots.slice(seat, seat + piece.seats);
    seat += piece.seats;
    return mine.map((spot, i) => ({ ...spot, key: `${piece.key}-${i}`, color: look(piece).chair }));
  });

  return (
    <View style={{ width, height }} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      {chairs.map((c) => (
        <View
          key={c.key}
          style={{
            position: 'absolute',
            left: c.x - (c.round ? CHAIR : c.wide) / 2,
            top: c.y - CHAIR / 2,
            width: c.round ? CHAIR : c.wide,
            height: CHAIR,
            borderRadius: 3,
            backgroundColor: c.color,
          }}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          left: (width - topW) / 2,
          top: (height - topH) / 2,
          width: topW,
          height: topH,
          flexDirection: 'row',
          gap: linked || pieces.length === 1 ? 0 : 3, // a cut between the parts of a split table
          borderRadius: round ? topW / 2 : shape === 'booth' ? 14 : 10,
          overflow: 'hidden',
        }}
      >
        {pieces.map((piece, index) => {
          const c = look(piece);
          const share = (topW * piece.seats) / Math.max(1, seats);
          return (
            <View
              key={piece.key}
              style={{
                flex: piece.seats,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 2,
                backgroundColor: c.fill,
                borderWidth: 2,
                borderColor: c.line,
                borderLeftWidth: linked && index > 0 ? 0 : 2,
                borderRadius: pieces.length === 1 ? (round ? topW / 2 : shape === 'booth' ? 14 : 10) : 0,
              }}
            >
              {linked && index > 0 && share >= 48 ? <Icon name="link-variant" size={12} color="textSecondary" /> : null}
              <Txt size={share < 40 ? Math.min(labelSize, 12) : labelSize} weight={700} tabular numberOfLines={1}>
                {share < 46 ? piece.short : piece.label}
              </Txt>
            </View>
          );
        })}
      </View>
    </View>
  );
}
