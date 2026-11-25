import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { sqliteHarness } from './sqlite-harness.mjs';

const line = (id, productId, quantity, unitPrice, extra = {}) => ({
  id, productId, description: `Saved ${productId}`, quantity, unitPrice,
  lineTotal: quantity * unitPrice, costAtSale: 1, ...extra,
});
const document = (id, kind, day, lines, extra = {}) => ({
  id, number: `SYN-${id}`, kind, status: 'posted', revision: 0,
  occurredAt: `${day}T12:00:00.000Z`, paymentMethod: 'cash', lines,
  total: lines.reduce((sum, item) => sum + item.lineTotal, 0), paidTotal: 0, dueTotal: 0,
  ...extra,
});
const filters = (extra = {}) => parseReportFilters(new URL('http://local/api/reports?' +
  new URLSearchParams({ type: 'sales', from: '2026-08-01', to: '2026-08-31',
    groupBy: 'product', page: '1', pageSize: '100', ...extra })));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

async function fixture(t) {
  const harness = await sqliteHarness();
  t.after(() => harness.close());
  await harness.reset();
  const db = harness.db;
  await db.collection('products').insertMany([
    { id: 'a', name: 'Alpha', sku: 'A', categoryId: 'category-a', piecePrice: 999, stocks: { w: 999 } },
    { id: 'b', name: 'Beta', sku: 'B', categoryId: 'category-b', piecePrice: 888, stocks: { w: 888 } },
    { id: 'c', name: 'Gamma', sku: 'C', categoryId: 'category-a', stocks: {} },
    { id: 'd', name: 'Delta', sku: 'D', categoryId: 'category-b', stocks: {} },
  ]);
  return { db, report: extra => buildReport(db, filters(extra)) };
}

test('sales grouping is opt-in and accepts the three product summary sort fields', () => {
  assert.equal(parseReportFilters(new URL('http://local/api/reports?type=sales&allTime=true')).groupBy, 'invoice');
  for (const sortKey of ['product', 'quantity', 'revenue']) {
    const parsed = filters({ sortKey, sortDirection: 'desc' });
    assert.equal(parsed.groupBy, 'product');
    assert.equal(parsed.sortKey, sortKey);
  }
  assert.throws(() => filters({ groupBy: 'warehouse' }), /الفلتر groupBy/);
  assert.throws(() => filters({ sortKey: 'returnedQuantity' }), /حقل ترتيب/);
});

test('product rows sum every saved line at different prices and include credit and unknown-cost sales', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertMany([
    document('first', 'sale', '2026-08-10', [line('a1', 'a', 2, 10), line('a2', 'a', 1, 13), line('b1', 'b', 1, 20)], { paidTotal: 53 }),
    document('credit', 'sale', '2026-08-11', [line('a3', 'a', 0.5, 8, { costAtSale: null }), line('b2', 'b', 2, 7)], { paymentMethod: 'note', dueTotal: 18 }),
    document('void', 'sale', '2026-08-12', [line('void-line', 'a', 999, 999)], { status: 'voided' }),
    document('draft', 'sale', '2026-08-12', [line('draft-line', 'a', 999, 999)], { status: 'draft' }),
    document('expense', 'expense', '2026-08-12', [], { total: 99 }),
  ]);
  const report = await f.report();
  assert.deepEqual(report.rows.map(({ productId, product, quantity, revenue }) => ({ productId, product, quantity, revenue })), [
    { productId: 'a', product: 'Alpha', quantity: 3.5, revenue: 37 },
    { productId: 'b', product: 'Beta', quantity: 3, revenue: 34 },
  ]);
  assert.deepEqual([report.summary.soldProducts, report.summary.soldQuantity, report.summary.netSales], [2, 6.5, 71]);
  assert.deepEqual([report.summary.count, report.summary.paid, report.summary.due], [2, 53, 18]);
  assert.equal(report.summary.costKnown, false);
  assert.equal(report.meta.totalRows, 2);
  for (const row of report.rows) for (const field of ['unitPrice', 'averagePrice', 'returnedQuantity', 'currentQuantity']) assert.equal(field in row, false);
  assert.equal(report.rows.some(row => row.productId === 'c'), false, 'unsold master data is not a sold product');
});

test('date, category, product and payment-account filters intersect after whole-invoice discount allocation', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertMany([
    document('discount', 'sale', '2026-08-10', [line('a', 'a', 1, 100), line('b', 'b', 1, 50)], { total: 120, paidTotal: 120 }),
    document('bank', 'sale', '2026-08-11', [line('bank-a', 'a', 2, 10)], { paymentMethod: 'bank' }),
    document('old', 'sale', '2026-07-31', [line('old-a', 'a', 1, 90)]),
    document('last-instant', 'sale', '2026-08-31', [line('last-a', 'a', 1, 5)], { occurredAt: '2026-08-31T23:59:59.999Z' }),
    document('next-day', 'sale', '2026-09-01', [line('next-a', 'a', 1, 1000)], { occurredAt: '2026-09-01T00:00:00.000Z' }),
  ]);
  const all = await f.report(), category = await f.report({ categoryId: 'category-a', paymentAccountId: 'cash' });
  assert.deepEqual([category.rows[0].quantity, category.rows[0].revenue], [2, 85]);
  assert.deepEqual([category.summary.soldProducts, category.summary.soldQuantity, category.summary.netSales], [1, 2, 85]);
  const product = await f.report({ productId: 'a', paymentAccountId: 'cash' });
  assert.deepEqual(product.rows, category.rows);
  assert.equal((await f.report({ productId: 'a', paymentAccountId: 'bank' })).summary.netSales, 20);
  assert.equal((await f.report({ productId: 'a', categoryId: 'category-b' })).rows.length, 0);
  assert.equal(all.summary.netSales, 145);
  const invoice = await f.report({ groupBy: 'invoice', categoryId: 'category-a', paymentAccountId: 'cash' });
  close(invoice.summary.netSales, category.summary.netSales);
  assert.equal((await f.report({ allTime: 'true' })).summary.netSales, 1235);
});

test('legacy net adjustments retain their existing signs without introducing a return column or replaying edits', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertMany([
    document('sale', 'sale', '2026-08-10', [line('current-a', 'a', 3, 30)], {
      revision: 2, revisions: [{ lines: [line('old-a', 'a', 50, 900)] }],
    }),
    document('legacy-adjustment', 'return', '2026-08-11', [line('return-a', 'a', 1, 30)], { parentDocumentId: 'sale' }),
    document('purchase', 'purchase', '2026-07-10', [line('purchase-b', 'b', 10, 5)]),
    document('supplier-adjustment', 'return', '2026-08-11', [line('supplier-b', 'b', 2, 5)], { parentDocumentId: 'purchase' }),
    document('void-adjustment', 'return', '2026-08-11', [line('void-return', 'a', 1, 30)], { parentDocumentId: 'sale', status: 'voided' }),
    document('payment', 'payment', '2026-08-11', [], { total: 100 }),
  ]);
  const grouped = await f.report(), invoices = await f.report({ groupBy: 'invoice' });
  assert.deepEqual(grouped.rows.map(row => [row.productId, row.quantity, row.revenue]), [['a', 2, 60]]);
  assert.deepEqual([grouped.summary.soldProducts, grouped.summary.soldQuantity, grouped.summary.netSales], [1, 2, 60]);
  assert.equal(grouped.summary.netSales, invoices.summary.netSales);
  assert.equal('returns' in grouped.rows[0], false);
  assert.equal('returnedQuantity' in grouped.rows[0], false);
});

test('product sorting and pagination operate globally while summaries and unpaged exports remain complete', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertOne(document('sale', 'sale', '2026-08-10', [
    line('a', 'a', 1, 50), line('b', 'b', 10, 2), line('c', 'c', 3, 10), line('d', 'd', 2, 20),
  ]));
  const first = await f.report({ sortKey: 'revenue', sortDirection: 'desc', pageSize: '2' });
  const second = await f.report({ sortKey: 'revenue', sortDirection: 'desc', pageSize: '2', page: '2' });
  assert.deepEqual(first.rows.map(row => row.productId), ['a', 'd']);
  assert.deepEqual(second.rows.map(row => row.productId), ['c', 'b']);
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual([first.summary.soldProducts, first.summary.soldQuantity, first.summary.netSales], [4, 16, 140]);
  assert.deepEqual([first.meta.totalRows, first.meta.totalPages], [4, 2]);
  const quantity = await f.report({ sortKey: 'quantity', sortDirection: 'desc' });
  assert.deepEqual(quantity.rows.map(row => row.productId), ['b', 'c', 'd', 'a']);
  const names = await f.report({ sortKey: 'product', sortDirection: 'asc' });
  assert.deepEqual(names.rows.map(row => row.product), ['Alpha', 'Beta', 'Delta', 'Gamma']);
  const emptyPage = await f.report({ page: '9', pageSize: '2' });
  assert.deepEqual(emptyPage.rows, []);
  assert.deepEqual(emptyPage.summary, first.summary);
  const exported = await f.report({ page: '9', pageSize: '1', unpaged: 'true', sortKey: 'revenue', sortDirection: 'desc' });
  assert.deepEqual(exported.rows.map(row => row.productId), ['a', 'd', 'c', 'b']);
  assert.deepEqual([exported.meta.page, exported.meta.totalRows, exported.meta.totalPages], [1, 4, 1]);
  assert.deepEqual(exported.summary, first.summary);
});

test('saved exact and legacy-rounded totals are used without multiplying current or historical unit prices again', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertMany([
    document('legacy-rounded', 'sale', '2026-08-10', [line('legacy-a', 'a', 3, 100.2, { lineTotal: 301 })]),
    document('exact', 'sale', '2026-08-11', [line('exact-a', 'a', 3, 400 / 3, { lineTotal: 400, lineTotalMode: 'exact' })]),
    document('fraction', 'sale', '2026-08-12', [line('fraction-b', 'b', 0.5, 0.2, { lineTotal: 0.1, lineTotalMode: 'exact' })]),
  ]);
  const report = await f.report();
  assert.deepEqual(report.rows.find(row => row.productId === 'a').quantity, 6);
  assert.equal(report.rows.find(row => row.productId === 'a').revenue, 701);
  assert.equal(report.rows.find(row => row.productId === 'b').revenue, 0.1);
  close(report.summary.netSales, 701.1);
  close(report.summary.soldQuantity, 6.5);
});

test('archived and missing historical products remain visible by identity while duplicate names stay separate', async t => {
  const f = await fixture(t);
  await f.db.collection('products').updateOne({ id: 'a' }, { $set: { name: 'Same name', isArchived: true } });
  await f.db.collection('products').updateOne({ id: 'b' }, { $set: { name: 'Same name' } });
  await f.db.collection('documents').insertOne(document('historical', 'sale', '2026-08-10', [
    line('a', 'a', 1, 10), line('b', 'b', 2, 20),
    line('gone', 'gone', 1, 7, { description: 'Historical product' }),
    line('missing', 'missing', 1, 3, { description: '' }),
  ]));
  const report = await f.report();
  assert.equal(report.rows.length, 4);
  assert.equal(report.rows.filter(row => row.product === 'Same name').length, 2);
  assert.equal(report.rows.find(row => row.productId === 'gone').product, 'Historical product');
  assert.equal(report.rows.find(row => row.productId === 'missing').productMissing, true);
  assert.deepEqual([report.summary.soldProducts, report.summary.soldQuantity, report.summary.netSales], [4, 5, 60]);
});

test('zero-net discounted sales remain counted and every report is read-only with an unchanged default invoice view', async t => {
  const f = await fixture(t);
  await f.db.collection('documents').insertOne(document('free-historical', 'sale', '2026-08-10', [line('a', 'a', 2, 50)], { total: 0 }));
  await f.db.collection('stockMovements').insertOne({ id: 'stock', documentId: 'free-historical', productId: 'a', quantityDelta: -2 });
  await f.db.collection('financialMovements').insertOne({ id: 'money', documentId: 'control', amount: 15, direction: 'in' });
  const snapshot = async () => Object.fromEntries(await Promise.all(['documents', 'products', 'stockMovements', 'financialMovements']
    .map(async name => [name, await f.db.collection(name).find().toArray()])));
  const before = await snapshot();
  const defaultFilters = filters();
  delete defaultFilters.groupBy;
  const oldView = await buildReport(f.db, defaultFilters), explicitInvoice = await f.report({ groupBy: 'invoice' });
  assert.deepEqual(oldView, explicitInvoice);
  assert.equal('soldProducts' in oldView.summary, false);
  const grouped = await f.report();
  assert.deepEqual([grouped.rows[0].quantity, grouped.rows[0].revenue], [2, 0]);
  assert.deepEqual([grouped.summary.soldProducts, grouped.summary.soldQuantity, grouped.summary.netSales], [1, 2, 0]);
  for (const key of Object.keys(oldView.summary)) assert.deepEqual(grouped.summary[key], oldView.summary[key], key);
  assert.deepEqual(await snapshot(), before);
});
