import { View } from 'react-native';
import { useTheme } from '../theme';
import { money2, plural } from '../lib/format';
import { itemCount } from '../lib/orders';
import { Line } from './Lists';

// The money on a bill, top to bottom, exactly as the server worked it out:
// items total, discount, service charge, taxable value, each tax line, round off, total.
// Every amount is written with two decimals, so the column lines up on the decimal point.
// `bill` is an order, or a preview with the same fields.
export function BillSummary({ bill, items, totalLabel = 'Total Amount' }) {
  const t = useTheme();
  const n = items ?? (bill.items ? itemCount(bill) : null);
  const hasDiscount = bill.discount_amount > 0;
  // "Discount (10%)" for a percentage; a fixed amount also says what share of the items it is.
  const share = bill.subtotal > 0 ? Math.round((bill.discount_amount / bill.subtotal) * 1000) / 10 : 0;
  const discountLabel = !hasDiscount ? 'Discount' : bill.discount_type !== 'amount' && bill.discount_value ? `Discount (${bill.discount_value}%)` : `Discount (fixed · ${share}% of items)`;
  const showTaxable = hasDiscount || bill.service_charge > 0 || bill.taxable !== bill.subtotal;
  return (
    <View style={{ gap: 8 }}>
      <Line label={n === null ? 'Items total' : `Items total (${plural(n, 'item')})`} value={money2(bill.subtotal)} muted />
      {hasDiscount ? <Line label={discountLabel} value={`− ${money2(bill.discount_amount)}`} tone="error" muted /> : null}
      {bill.service_charge > 0 ? <Line label="Service charge" value={money2(bill.service_charge)} muted /> : null}
      {showTaxable ? <Line label="Taxable value" value={money2(bill.taxable)} /> : null}
      {(bill.tax_lines || []).map((line) => (
        <Line key={line.label} label={line.label} value={money2(line.amount)} muted />
      ))}
      {bill.round_off ? <Line label="Round off" value={`${bill.round_off > 0 ? '+ ' : '− '}${money2(Math.abs(bill.round_off))}`} muted /> : null}
      <View style={{ marginTop: 4, paddingTop: 10, borderTopWidth: t.borderWidth, borderTopColor: t.c.border }}>
        <Line label={totalLabel} value={money2(bill.total)} strong />
      </View>
    </View>
  );
}
