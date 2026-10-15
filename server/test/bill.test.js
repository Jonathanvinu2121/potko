// Bill maths: the rules every screen, receipt and report depends on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeBill, discountPct, share } = require('../src/bill');

const line = (qty, unit_price, tax_rate = 5, tax_mode = 'exclusive') => ({ qty, unit_price, tax_rate, tax_mode });

test('tax added on top, shown as equal CGST and SGST', () => {
  const bill = computeBill([line(2, 340), line(4, 60), line(1, 320), line(1, 180), line(3, 60)]);
  assert.equal(bill.subtotal, 1600);
  assert.equal(bill.taxable, 1600);
  assert.deepEqual(bill.tax_lines, [{ label: 'CGST 2.5%', rate: 2.5, amount: 40 }, { label: 'SGST 2.5%', rate: 2.5, amount: 40 }]);
  assert.equal(bill.total, 1680);
});

test('a percentage discount comes off before tax', () => {
  const bill = computeBill([line(1, 1600)], { discountType: 'pct', discountValue: 20 });
  assert.equal(bill.discount_amount, 320);
  assert.equal(bill.taxable, 1280);
  assert.equal(bill.tax_total, 64);
  assert.equal(bill.total, 1344);
});

test('a fixed discount can never exceed the bill', () => {
  const bill = computeBill([line(1, 200)], { discountType: 'amount', discountValue: 500 });
  assert.equal(bill.discount_amount, 200);
  assert.equal(bill.total, 0);
});

test('a price that includes tax is not taxed again', () => {
  const bill = computeBill([line(1, 105, 5, 'inclusive')], { roundOff: false });
  assert.equal(bill.subtotal, 105);
  assert.equal(bill.tax_total, 5);
  assert.equal(bill.taxable, 100);
  assert.equal(bill.total, 105);
});

test('each tax rate is listed on its own; untaxed lines add no tax', () => {
  const bill = computeBill([line(1, 100, 5), line(1, 100, 18), line(1, 100, 0)], { taxSplit: false });
  assert.deepEqual(bill.tax_lines.map((l) => [l.label, l.amount]), [['GST 5%', 5], ['GST 18%', 18]]);
  assert.equal(bill.total, 323);
});

test('service charge is added after discount and is taxed', () => {
  const bill = computeBill([line(1, 1000)], { discountType: 'pct', discountValue: 10, serviceChargePct: 10, serviceTaxRate: 5 });
  assert.equal(bill.service_charge, 90);
  assert.equal(bill.taxable, 990);
  assert.equal(bill.tax_total, 49.5);
  assert.equal(bill.total, 1040); // 1039.50 rounded to the rupee
  assert.equal(bill.round_off, 0.5);
});

test('rounding to the rupee can be switched off', () => {
  const bill = computeBill([line(1, 99)], { roundOff: false });
  assert.equal(bill.total, 103.96); // 4.95 of tax becomes two equal halves of 2.48
  assert.equal(bill.round_off, 0);
});

test('what is shown always adds up to the total', () => {
  for (let n = 1; n < 400; n += 1) {
    const lines = [line(1 + (n % 3), 37 + n * 1.5), line(2, 19.99, 12), line(1, 250, 5, 'inclusive')];
    const bill = computeBill(lines, { discountType: n % 2 ? 'pct' : 'amount', discountValue: n % 2 ? n % 31 : n, serviceChargePct: n % 4 ? 0 : 5, serviceTaxRate: 5 });
    const shown = bill.taxable + bill.tax_total + bill.round_off;
    assert.ok(Math.abs(shown - bill.total) < 0.005, `case ${n}: ${shown} vs ${bill.total}`);
    assert.equal(bill.tax_lines.reduce((sum, l) => sum + l.amount * 100, 0).toFixed(0), (bill.tax_total * 100).toFixed(0));
    assert.equal(bill.total, Math.round(bill.total)); // whole rupees
  }
});

test('sharing an amount never loses or invents a paisa', () => {
  assert.deepEqual(share(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(share(12345, [5, 3, 2, 7]).reduce((a, b) => a + b, 0), 12345);
  assert.deepEqual(share(50, [0, 0]), [0, 0]);
});

test('a fixed discount is compared with a limit as a percentage of the bill', () => {
  assert.equal(discountPct('amount', 50, 1000), 5);
  assert.equal(discountPct('pct', 7.5, 1000), 7.5);
  assert.equal(discountPct('amount', 50, 0), 0);
});
