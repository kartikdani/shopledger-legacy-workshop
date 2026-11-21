var assert = require('node:assert/strict');
var test = require('node:test');
var invoice = require('../lib/invoice');
var pricing = require('../lib/pricing');
var reports = require('../lib/reports');

function billedOrder(items, coupon) {
  var billed = pricing.computeTotals(items, coupon);

  // Checkout stores these summary figures alongside the original line items.
  return {
    id: 1001,
    date: '01/11/2021',
    items: items,
    coupon: coupon || '',
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  };
}

function discountedOrder() {
  return billedOrder([
    { id: 1, name: 'Rice', sku: 'RICE', hsn: '1006', price: 500, qty: 2 },
    { id: 2, name: 'Ghee', sku: 'GHEE', hsn: '0405', price: 1000, qty: 1 }
  ], 'SAVE10');
}

test('invoice uses checkout HSN rates when lines have no saved rate', function () {
  var order = billedOrder([
    { id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 2 },
    { id: 2, name: 'Ghee', hsn: '0405', price: 100, qty: 1 }
  ]);
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 22);
  assert.equal(order.total, 322);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.hsn, row.gstPercent, row.lineTax];
  }), [['1006', 5, 10], ['0405', 12, 12]]);
  assert.equal(figures.tax, 22);
  assert.equal(figures.cgst, 11);
  assert.equal(figures.sgst, 11);
  assert.equal(figures.total, 322);
});

test('invoice shows the billed capped discount and GST on discounted lines', function () {
  var order = discountedOrder();
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.subtotal, 2000);
  assert.equal(order.discount, 150);
  assert.equal(order.tax, 157.25);
  assert.equal(order.total, 2007.25);

  assert.equal(figures.subtotal, 2000);
  assert.equal(figures.discount, 150);
  assert.equal(figures.tax, 157.25);
  assert.equal(figures.cgst, 78.63);
  assert.equal(figures.sgst, 78.62);
  assert.equal(figures.total, 2007.25);
});

test('invoice uses checkout rate rules for percentage, decimal, and zero rates', function () {
  var items = [
    { name: 'Rice', hsn: '1006', price: 100, qty: 1, gstRate: 12 },
    { name: 'Tea', hsn: '0902', price: 100, qty: 1, gstRate: 0.05 },
    { name: 'Ghee', hsn: '0405', price: 100, qty: 1, gstRate: 0 }
  ];
  var figures = invoice.computeInvoiceFigures({ items: items });

  assert.deepEqual(pricing.computeTotals(items).lines.map(function (line) {
    return [line.gstPercent, line.tax];
  }), [[12, 12], [5, 5], [0, 0]]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[12, 12], [5, 5], [0, 0]]);
  assert.equal(figures.tax, 17);
  assert.equal(figures.total, 317);
});

test('invoice GST sums the same rounded line taxes as checkout', function () {
  var order = billedOrder([
    { name: 'Item A', price: 0.03, qty: 1 },
    { name: 'Item B', price: 0.03, qty: 1 }
  ]);
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(order.tax, 0.02);
  assert.equal(order.total, 0.08);
  assert.equal(figures.rows[0].lineTax, 0.01);
  assert.equal(figures.rows[1].lineTax, 0.01);
  assert.equal(figures.tax, 0.02);
  assert.equal(figures.cgst, 0.01);
  assert.equal(figures.sgst, 0.01);
  assert.equal(figures.total, 0.08);
});

test('printable invoice shows billed totals and discounted line GST', function () {
  var html = invoice.render(discountedOrder());

  assert.match(html, /<td class="r">5%<\/td><td class="r">₹46\.25<\/td>/);
  assert.ok(html.includes('CGST + SGST (Total GST)</td><td class="r">₹157.25'));
  assert.ok(html.includes('Invoice Total</td><td class="r">₹2007.25'));
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('GST reconciliation reports the billed order as matched', function () {
  var result = reports.getGstReconciliation({ orders: [discountedOrder()] });

  assert.deepEqual(result, {
    totalChecked: 1,
    mismatchCount: 0,
    totalDelta: 0,
    rows: [{
      orderId: 1001,
      date: '01/11/2021',
      customer: 'Walk-in',
      coupon: 'SAVE10',
      ledgerSubtotal: 2000,
      ledgerDiscount: 150,
      ledgerTax: 157.25,
      ledgerTotal: 2007.25,
      invoiceDiscount: 150,
      invoiceTax: 157.25,
      invoiceTotal: 2007.25,
      delta: 0,
      matched: true
    }]
  });
});

test('invoice total and GST breakdown match a billed order with mixed GST rates and a capped coupon', function () {
  var order = discountedOrder();
  var figures = invoice.computeInvoiceFigures(order);

  assert.equal(figures.total, order.total);
  assert.equal(figures.discount, order.discount);
  assert.equal(figures.tax, order.tax);
  assert.deepEqual([figures.cgst, figures.sgst], [78.63, 78.62]);
  assert.deepEqual(figures.rows.map(function (row) {
    return [row.gstPercent, row.lineTax];
  }), [[5, 46.25], [12, 111]]);
});
