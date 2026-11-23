import test from 'node:test';
import assert from 'node:assert/strict';
import { convertMobileBackup } from '../lib/mobile-backup.ts';
import { createNativeBackup, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from '../lib/backup.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { sqliteHarness } from './sqlite-harness.mjs';

// Independently generated capacity fixture. No customer file, records or credentials.
function scaleFixture() {
  const records = [], cycles = 900, price = 7, retail = 13;
  let cash = 100000, debt = 0, stock = 0;
  const line = quantity => ({ product: 1, name: 'Synthetic item', qty: quantity, price, costAtSale: price });
  for (let i = 0; i < cycles; i++) {
    const purchaseId = 20000 + i * 2, saleId = purchaseId + 1, credit = i % 2 === 0;
    const base = { date: '2026-08-01', time: '09:00', revision: 0, warehouse: 'Synthetic warehouse' };
    records.push({ ...base, id: purchaseId, kind: 'purchase', number: `SYN-P-${i + 1}`, sequence: i + 1,
      total: 3 * price, paid: 3 * price, due: 0, party: 2, account: 1,
      lines: i < 4 ? [line(1), line(2)] : [line(3)] });
    records.push({ ...base, id: saleId, kind: 'sale', number: `SYN-S-${i + 1}`, sequence: i + 1,
      total: retail, paid: credit ? 0 : retail, due: credit ? retail : 0, party: 1, account: credit ? null : 1,
      profit: retail - price, lines: [{ ...line(1), price: retail }] });
    cash += -3 * price + (credit ? 0 : retail); debt += credit ? retail : 0; stock += 2;
  }
  return { format: 'alkarna-web-backup', schemaVersion: 1, createdAt: '2026-11-20T10:00:00.000Z', users: [], state: {
    branding: 'Synthetic capacity fixture', brandInfo: {}, warehouse: 'Synthetic warehouse', warehouses: ['Synthetic warehouse'],
    products: [{ id: 1, name: 'Synthetic item', sku: '', cost: price, price: retail, stocks: { 'Synthetic warehouse': stock }, qty: stock }],
    parties: [{ id: 1, name: 'Synthetic customer', type: 'customer', balance: debt }, { id: 2, name: 'Synthetic supplier', type: 'supplier', balance: 0 }],
    accounts: [{ id: 1, name: 'Synthetic account', balance: cash, openingBalance: 100000 }], records: records.reverse(), users: [],
    opening: { accounts: { 1: 100000 }, parties: { 1: 0, 2: 0 }, stocks: { 1: { 'Synthetic warehouse': 0 } } },
  } };
}

test('1800 synthetic Mobile records retain four repeated purchase pairs, balances and native round-trip totals', async t => {
  const source = scaleFixture(), original = structuredClone(source), converted = convertMobileBackup(source);
  assert.deepEqual(source, original, 'Conversion must not rewrite the source or archived raw lines');
  assert.equal(source.state.records.length, 1800);
  assert.equal(converted.collections.documents.length, 1800);
  assert.equal(converted.collections.stockMovements.length, 1804);
  const repeated = converted.collections.documents.filter(row => row.legacyKey);
  assert.equal(repeated.length, 4, 'Only repeated commercial documents become read-only');
  for (const doc of repeated) {
    assert.equal(doc.kind, 'purchase'); assert.equal(doc.legacyKey, doc.id); assert.ok(doc.mobileReadOnlyReason);
    assert.deepEqual(doc.lines.map(row => [row.quantity, row.unitPrice]), [[1, 7], [2, 7]]);
    assert.deepEqual(doc.lines.map(row => row.id), [`${doc.id}:line:1`, `${doc.id}:line:2`]);
  }
  const parsed = parseAndValidateBackup(stringifyBackup(converted)), h = await sqliteHarness(), previous = process.env.ALKARNA_USER_DATA;
  process.env.ALKARNA_USER_DATA = h.directory;
  t.after(async () => { await h.close(); if (previous === undefined) delete process.env.ALKARNA_USER_DATA; else process.env.ALKARNA_USER_DATA = previous; });
  await h.db.dropDatabase();
  await h.db.transaction(session => restoreNativeBackup(h.db, parsed, session));
  const report = type => buildReport(h.db, parseReportFilters(new URL(`http://local/?type=${type}&allTime=true&unpaged=true`)));
  const sales = await report('sales'), overview = await report('overview');
  assert.deepEqual([sales.rows.length, sales.summary.netSales, sales.summary.cost, sales.summary.profit, sales.summary.costKnown], [900, 11700, 6300, 5400, true]);
  assert.equal(sales.summary.unknownRevenue, 0);
  assert.deepEqual([overview.summary.purchases, overview.summary.currentAccountsBalance, overview.summary.currentInventoryValue,
    overview.summary.currentReceivable, overview.summary.currentPayable, overview.summary.netOperatingResult], [18900, 86950, 12600, 5850, 0, 5400]);
  const first = await createNativeBackup(h.db), warehouse = first.collections.warehouses[0]._id;
  assert.equal(first.collections.products[0].stocks[warehouse], 1800);
  assert.deepEqual(first.collections.appSettings.find(row => row.inertSourceArchive).originalBackup, original);
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(stringifyBackup(first)), session));
  const second = await createNativeBackup(h.db);
  for (const key of ['products', 'parties', 'paymentAccounts', 'documents', 'stockMovements', 'financialMovements', 'appSettings']) {
    assert.deepEqual(second.collections[key], first.collections[key], key);
  }
  assert.deepEqual((await report('overview')).summary, overview.summary);
  assert.deepEqual(source, original);
});
