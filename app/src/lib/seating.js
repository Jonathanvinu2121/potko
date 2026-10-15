// Seating a party: the waiter takes a free table (or tables joined for one party) and its order
// is started. Used from the Tables screen and from the screens that end with "Seat new guests".
import { send } from './ws';
import { useDraft } from '../store/draft';
import { toast } from '../store/toast';
import { tableName } from './format';
import { groupLabel } from './units';

// Resolves the table as the server now has it (its lead table, when it was joined to another).
// Throws with the server's message when someone else got there first.
// guests: how many people are being seated (asked on the Tables screen); kept on the order.
export async function seatAt(table, router, guests = null) {
  const locked = await send('table.lock', { tableId: table.id });
  const label = groupLabel(locked);
  const draft = useDraft.getState();
  const resuming = draft.type === 'dine_in' && draft.table?.id === locked.id && draft.lines.length > 0;
  if (!resuming) draft.start('dine_in', { guests, table: { id: locked.id, label, seats: locked.seats + (locked.joined || []).reduce((n, j) => n + j.seats, 0) } });
  else if (guests) useDraft.setState({ guests });
  toast(resuming ? `Back to ${tableName(label)}` : `${tableName(label)} is yours`, { tone: 'success' });
  router.push('/new-order/menu');
  return locked;
}
