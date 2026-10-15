// Bill maths. One place works out every amount on a bill, so the waiter's screen, the manager's
// payment queue, the receipt and the reports can never disagree.
//
// All sums are done in paise (whole numbers) and turned back into rupees at the end.
//
//   Items total     what the menu prices add up to
//   Discount        a percentage or a fixed amount, shared across the lines in proportion
//   Service charge  optional, a percentage of the value after discount
//   Taxable value   what tax is charged on
//   Tax             per line, at the rate and mode saved on the line when it was ordered
//   Round off       to the nearest rupee, when the restaurant wants that
//   Total           what the guest pays

const paise = (rupees) => Math.round(Number(rupees) * 100);
const rupees = (p) => Math.round(p) / 100;
const rateText = (rate) => String(Math.round(rate * 100) / 100);

// Shares `amount` between `weights` in proportion, in whole paise that add up to exactly `amount`.
function share(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / total);
  const parts = exact.map(Math.floor);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  // The paise left over go to the lines with the largest remainders.
  const order = exact.map((x, i) => [x - parts[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k += 1, left -= 1) parts[order[k % order.length][1]] += 1;
  return parts;
}

// lines: [{ qty, unit_price, tax_rate, tax_mode }] — only dishes that count (not removed or cancelled).
// options:
//   discountType 'pct' | 'amount', discountValue
//   serviceChargePct, serviceTaxRate (the rate charged on the service charge)
//   taxSplit    show each rate as CGST + SGST halves
//   roundOff    round the payable amount to the nearest rupee
//   splitAdjust rupees added after rounding, so the bills of a split table add up to the original
function computeBill(lines, options = {}) {
  const {
    discountType = 'pct',
    discountValue = 0,
    serviceChargePct = 0,
    serviceTaxRate = 0,
    taxSplit = true,
    roundOff = true,
    splitAdjust = 0,
  } = options;

  const gross = lines.map((l) => l.qty * paise(l.unit_price));
  const subtotal = gross.reduce((a, b) => a + b, 0);

  const wanted = discountType === 'amount' ? paise(discountValue) : Math.round((subtotal * Number(discountValue || 0)) / 100);
  const discount = Math.max(0, Math.min(subtotal, wanted));
  const cut = share(discount, gross);

  // Tax per rate, inclusive and exclusive lines kept apart: tax inside a price is taken out of it,
  // tax on top is added to it.
  const groups = new Map(); // rate -> { inside, onTop } in fractional paise
  const group = (rate) => {
    if (!groups.has(rate)) groups.set(rate, { inside: 0, onTop: 0 });
    return groups.get(rate);
  };
  let net = 0;
  lines.forEach((line, i) => {
    const value = gross[i] - cut[i];
    net += value;
    const rate = Number(line.tax_rate) || 0;
    if (rate <= 0) return;
    if (line.tax_mode === 'inclusive') group(rate).inside += value - value / (1 + rate / 100);
    else group(rate).onTop += (value * rate) / 100;
  });

  // With CGST + SGST the two halves must be equal, so each amount is rounded as two equal halves.
  const settle = (x) => (taxSplit ? 2 * Math.round(x / 2) : Math.round(x));
  const insideTotal = [...groups.values()].reduce((a, g) => a + settle(g.inside), 0);

  const beforeService = net - insideTotal;
  const serviceCharge = Math.round((beforeService * Number(serviceChargePct || 0)) / 100);
  if (serviceCharge > 0 && serviceTaxRate > 0) group(Number(serviceTaxRate)).onTop += (serviceCharge * serviceTaxRate) / 100;

  const taxLines = [];
  let taxTotal = 0;
  for (const rate of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(rate);
    const amount = settle(g.inside) + settle(g.onTop);
    if (amount <= 0) continue;
    taxTotal += amount;
    if (taxSplit) {
      taxLines.push({ label: `CGST ${rateText(rate / 2)}%`, rate: rate / 2, amount: rupees(amount / 2) });
      taxLines.push({ label: `SGST ${rateText(rate / 2)}%`, rate: rate / 2, amount: rupees(amount / 2) });
    } else {
      taxLines.push({ label: `GST ${rateText(rate)}%`, rate, amount: rupees(amount) });
    }
  }

  const taxable = beforeService + serviceCharge;
  const exact = taxable + taxTotal;
  const rounded = roundOff ? Math.round(exact / 100) * 100 : exact;
  const adjust = paise(splitAdjust);

  return {
    subtotal: rupees(subtotal),
    discount_amount: rupees(discount),
    service_charge: rupees(serviceCharge),
    taxable: rupees(taxable),
    tax_total: rupees(taxTotal),
    tax_lines: taxLines,
    round_off: rupees(rounded - exact + adjust),
    total: rupees(rounded + adjust),
  };
}

// A discount as a percentage of the items total, whichever way it was entered.
// This is what a person's discount limit is compared against.
function discountPct(type, value, subtotal) {
  if (type === 'amount') return subtotal > 0 ? Math.round((Number(value) / subtotal) * 10000) / 100 : 0;
  return Number(value) || 0;
}

module.exports = { computeBill, discountPct, share, paise, rupees };
