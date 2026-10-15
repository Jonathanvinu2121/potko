import { money } from './format';

// What a request asks for, in one line, and the money it moves.
export function approvalText(a) {
  const p = a.payload || {};
  if (a.type === 'discount') {
    const what = p.type === 'amount' ? `${money(p.value)} off` : `${p.value ?? p.pct}% discount`;
    return { line: `${what} on the bill${p.total_before ? ` (${money(p.total_before)})` : ''}`, amount: p.amount ?? null };
  }
  if (a.type === 'refund') return { line: `Refund of ${money(p.amount)} on a paid bill`, amount: p.amount };
  return { line: `Item: ${a.item_qty ?? ''} × ${a.item_name ?? 'dish'}${a.item_size ? ` (${a.item_size})` : ''}`, amount: p.amount ?? a.item_amount };
}

// The same, as one short sentence for a toast: "20% discount", "Cancel 1 × Paneer Tikka".
export function approvalShort(a) {
  const p = a.payload || {};
  if (a.type === 'discount') return p.type === 'amount' ? `${money(p.value)} discount` : `${p.value ?? p.pct}% discount`;
  if (a.type === 'refund') return `Refund of ${money(p.amount)}`;
  return `${a.type === 'void' ? 'Void' : 'Cancel'} of ${a.item_name ?? 'a dish'}`;
}
