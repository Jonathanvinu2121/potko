// The customer's bill, as a page to print and as plain text to send.
// It is built only from what the server saved on the order (the prices, tax and totals of the
// day it was sold), so printing an old bill again always gives the same bill.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { money, money2, orderLabel } from './format';
import { liveItems, methodLabel, goodPayments, TYPE_LABEL } from './orders';
import { api } from './api';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (iso) => new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function parts(order, restaurant) {
  const profile = restaurant?.profile || {};
  const items = liveItems(order).map((i) => ({
    qty: i.qty,
    name: `${i.name_snapshot}${i.size ? ` (${i.size})` : ''}`,
    extras: (i.addons || []).map((a) => a.name).join(', '),
    rate: money(i.unit_price),
    amount: money(Math.round(i.qty * i.unit_price * 100) / 100),
  }));
  const totals = [['Items total', money(order.subtotal)]];
  if (order.discount_amount > 0) totals.push([order.discount_type !== 'amount' && order.discount_value ? `Discount (${order.discount_value}%)` : 'Discount', `- ${money(order.discount_amount)}`]);
  if (order.service_charge > 0) totals.push(['Service charge', money2(order.service_charge)]);
  if (order.discount_amount > 0 || order.service_charge > 0 || order.taxable !== order.subtotal) totals.push(['Taxable value', money2(order.taxable)]);
  for (const line of order.tax_lines || []) totals.push([line.label, money2(line.amount)]);
  if (order.round_off) totals.push(['Round off', `${order.round_off > 0 ? '+' : '-'} ${money2(Math.abs(order.round_off))}`]);
  const paid = goodPayments(order).map((p) => [`${p.kind === 'refund' ? 'Refund' : 'Paid'} by ${methodLabel(p.method)}${p.reference ? ` (${p.reference})` : ''}`, `${p.kind === 'refund' ? '- ' : ''}${money(p.amount)}`]);
  return {
    name: restaurant?.name || 'Restaurant',
    profile,
    head: [
      ['Bill no.', `#${order.number}`],
      ['Date', when(order.paid_at || order.created_at)],
      [order.type === 'dine_in' ? 'Table' : TYPE_LABEL[order.type], order.type === 'dine_in' ? `${order.table_label}${order.area_name ? ` · ${order.area_name}` : ''}` : orderLabel(order)],
      ['Served by', order.waiter_name],
    ],
    items,
    totals,
    total: money(order.total),
    paid,
  };
}

// A narrow page that fits a receipt printer and still looks right on A4.
export function receiptHtml(order, restaurant) {
  const r = parts(order, restaurant);
  const row = ([a, b]) => `<tr><td>${esc(a)}</td><td class="r">${esc(b)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bill #${esc(order.number)}</title>
<style>
  @page { margin: 8mm; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; margin: 0 auto; max-width: 80mm; font-size: 12px; line-height: 1.35; }
  h1 { font-size: 17px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; } .m { color: #555; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: 2px 0; vertical-align: top; }
  th { text-align: left; font-weight: 600; border-bottom: 1px solid #111; }
  hr { border: 0; border-top: 1px dashed #777; margin: 6px 0; }
  .total td { font-size: 15px; font-weight: 700; border-top: 1px solid #111; padding-top: 5px; }
  .x { font-size: 11px; color: #555; }
</style></head><body>
<h1>${esc(r.name)}</h1>
${r.profile.address ? `<div class="c m">${esc(r.profile.address)}</div>` : ''}
${r.profile.phone ? `<div class="c m">Phone: ${esc(r.profile.phone)}</div>` : ''}
${r.profile.gstin ? `<div class="c m">GSTIN: ${esc(r.profile.gstin)}</div>` : ''}
<hr><table>${r.head.map(row).join('')}</table><hr>
<table><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>
${r.items.map((i) => `<tr><td>${esc(i.name)}${i.extras ? `<div class="x">${esc(i.extras)}</div>` : ''}</td><td class="r">${i.qty}</td><td class="r">${esc(i.rate)}</td><td class="r">${esc(i.amount)}</td></tr>`).join('')}
</table><hr>
<table>${r.totals.map(row).join('')}<tr class="total"><td>Total</td><td class="r">${esc(r.total)}</td></tr></table>
${r.paid.length ? `<hr><table>${r.paid.map(row).join('')}</table>` : ''}
<hr><div class="c">${esc(r.profile.footer || 'Thank you. Visit again!')}</div>
</body></html>`;
}

export function receiptText(order, restaurant) {
  const r = parts(order, restaurant);
  const line = ([a, b]) => `${a}: ${b}`;
  return [
    r.name,
    r.profile.address,
    r.profile.gstin ? `GSTIN: ${r.profile.gstin}` : null,
    '',
    ...r.head.map(line),
    '',
    ...r.items.map((i) => `${i.qty} x ${i.name}${i.extras ? ` + ${i.extras}` : ''}  ${i.amount}`),
    '',
    ...r.totals.map(line),
    `TOTAL: ${r.total}`,
    ...r.paid.map(line),
    '',
    r.profile.footer || 'Thank you. Visit again!',
  ].filter((l) => l !== null && l !== undefined).join('\n');
}

// Every bill given out is put on record (who, when, which order). It never holds up the printing.
const record = (order, kind) => api(`/orders/${order.id}/receipt`, { method: 'POST', body: { kind } }).catch(() => {});

// Opens the phone's or the browser's print dialog with the bill. Any printer the device knows
// can be chosen there (a receipt printer set up in Android's print settings included).
export async function printReceipt(order, restaurant) {
  const html = receiptHtml(order, restaurant);
  if (Platform.OS === 'web') {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    await new Promise((resolve) => setTimeout(resolve, 150));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
    record(order, 'print');
    return;
  }
  await Print.printAsync({ html });
  record(order, 'print');
}

// Sends the bill to the guest: a PDF through the phone's share sheet, or the text in a browser.
export async function shareReceipt(order, restaurant) {
  if (Platform.OS === 'web') {
    const text = receiptText(order, restaurant);
    record(order, 'share');
    if (navigator.share) return navigator.share({ title: `Bill #${order.number}`, text });
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(order, restaurant) });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Bill #${order.number}`, UTI: 'com.adobe.pdf' });
  record(order, 'share');
  return 'shared';
}
