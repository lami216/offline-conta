import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { convertMobileBackup } from '../lib/mobile-backup.ts';
import { createNativeBackup, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from '../lib/backup.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { execute } from '../app/api/command/route.ts';
import { sqliteHarness } from './sqlite-harness.mjs';
import { mobileBackupV23, mobileBackupV23Expected as expected } from './fixtures/mobile-backup-v23.mjs';

const sourceRecord = (source, id) => source.state.records.find(row => row.id === id);
const document = (backup, id) => backup.collections.documents.find(row => row.id === `mobile23:record:${id}`);
const repeatedSource = () => mobileBackupV23({ repeatedCommercialLines: true });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const filters = type => parseReportFilters(new URL(`http://local/?type=${type}&allTime=true&unpaged=true`));

async function setup(t, source = repeatedSource()) {
  const h = await sqliteHarness(), priorProfile = process.env.ALKARNA_USER_DATA;
  process.env.ALKARNA_USER_DATA = h.directory;
  t.after(async () => { await h.close(); if (priorProfile === undefined) delete process.env.ALKARNA_USER_DATA; else process.env.ALKARNA_USER_DATA = priorProfile; });
  await h.reset();
  const backup = parseAndValidateBackup(JSON.stringify(source));
  await h.db.transaction(session => restoreNativeBackup(h.db, backup, session));
  const command = body => h.db.transaction(session => execute(h.db, session, body));
  const report = type => buildReport(h.db, filters(type));
  const snapshot = async () => (await createNativeBackup(h.db)).collections;
  return { ...h, backup, command, report, snapshot };
}

test('repeated commercial lines keep their exact order and independent identities, values and source archive', () => {
  const source = repeatedSource(), before = structuredClone(source), result = convertMobileBackup(source);
  for (const id of [102, 114]) {
    const original = sourceRecord(source, id), doc = document(result, id);
    assert.equal(doc.legacyKey, doc.id); assert.match(doc.mobileReadOnlyReason, /Repeated product lines/);
    assert.equal(doc.lines.length, original.lines.length);
    assert.deepEqual(doc.lines.map((line, index) => [line.id, line.productId, line.quantity, line.unitPrice, line.lineTotal]),
      original.lines.map((line, index) => [`${doc.id}:line:${index + 1}`, `mobile23:product:${line.product}`, line.qty, line.price, line.qty * line.price]));
    const stock = result.collections.stockMovements.filter(row => row.documentId === doc.id);
    assert.deepEqual(stock.map(row => row.id), original.lines.map((line, index) => `${doc.id}:stock:${index + 1}`));
    assert.deepEqual(stock.map(row => row.quantityDelta), original.lines.map(line => (id === 102 ? -1 : 1) * line.qty));
  }
  assert.deepEqual(document(result, 102).lines.map(line => line.costAtSale), [10, 10]);
  assert.equal(document(result, 101).legacyKey, undefined, 'Unrelated imported invoices retain their existing native lifecycle');
  assert.equal(document(result, 117).legacyKey, undefined);
  const archive = result.collections.appSettings.find(row => row.inertSourceArchive);
  assert.equal(archive.sourceSha256, hash(before)); assert.deepEqual(archive.originalBackup, before); assert.deepEqual(source, before);
});

test('different prices and historical sale costs remain distinct rather than being averaged or repriced', async t => {
  const source = repeatedSource(), sale = sourceRecord(source, 102), purchase = sourceRecord(source, 114);
  sale.lines[0].price = 18; sale.lines[0].costAtSale = 8;
  sale.lines[1].price = 21; sale.lines[1].costAtSale = 11;
  purchase.lines[0].price = 7; purchase.lines[0].costAtSale = 2;
  purchase.lines[1].price = 13; purchase.lines[1].costAtSale = 99;
  const before = structuredClone(source), f = await setup(t, source), native = await createNativeBackup(f.db);
  assert.deepEqual(document(native, 102).lines.map(line => [line.quantity, line.unitPrice, line.costAtSale, line.grossProfit]), [[1, 18, 8, 10], [2, 21, 11, 20]]);
  assert.deepEqual(document(native, 114).lines.map(line => [line.quantity, line.unitPrice, line.lineTotal]), [[1, 7, 7], [1, 13, 13]]);
  const sales = await f.report('sales'), overview = await f.report('overview');
  assert.deepEqual([sales.summary.netSales, sales.summary.cost, sales.summary.profit, sales.summary.costKnown], [72, 35, 37, true]);
  assert.deepEqual([overview.summary.purchases, overview.summary.currentInventoryValue, overview.summary.currentAccountsBalance, overview.summary.currentReceivable, overview.summary.currentPayable], [60, 160, 1197, 120, 190]);
  assert.deepEqual(source, before);
});

test('native restore and repeated native backup round trips retain reports, separate snapshots and the read-only marker', async t => {
  const f = await setup(t), initialReport = await f.report('overview');
  const first = await createNativeBackup(f.db);
  for (let round = 0; round < 2; round++) {
    const backup = parseAndValidateBackup(stringifyBackup(await createNativeBackup(f.db)));
    await f.db.transaction(session => restoreNativeBackup(f.db, backup, session));
    const after = await createNativeBackup(f.db);
    for (const name of ['documents', 'stockMovements', 'financialMovements', 'parties', 'paymentAccounts', 'appSettings']) assert.deepEqual(after.collections[name], first.collections[name], `${name}, round ${round}`);
    assert.equal(document(after, 102).legacyKey, 'mobile23:record:102'); assert.equal(document(after, 114).lines.length, 2);
    assert.deepEqual((await f.report('overview')).summary, initialReport.summary);
  }
});

test('native edit and void reject only flagged originals and leave every source, stock, cash and audit row unchanged', async t => {
  const f = await setup(t);
  for (const [id, kind] of [[102, 'sale'], [114, 'purchase']]) {
    const original = await f.db.collection('documents').findOne({ id: `mobile23:record:${id}` });
    for (const action of ['update', 'void']) {
      const before = await f.snapshot();
      await assert.rejects(f.command({ type: `${kind}.${action}`, documentId: original.id, expectedRevision: original.revision,
        warehouseId: original.warehouseId, partyId: original.partyId, paymentMethod: original.paymentMethod,
        lines: original.lines.map(line => ({ productId: line.productId, quantity: line.quantity, piecePrice: line.unitPrice, unitPrice: line.unitPrice })) }),
      error => error.status === 409 && /الفواتير المرحلة متاحة للعرض فقط/.test(error.message));
      assert.deepEqual(await f.snapshot(), before, `${kind}.${action}`);
    }
  }
});

test('a normal future sale and void still use the imported current cost and preserve all repeated historical lines', async t => {
  const f = await setup(t), warehouse = f.backup.collections.warehouses.find(row => row.name === 'الرئيسي')._id;
  const restored = await createNativeBackup(f.db), originals = [102, 114].map(id => document(restored, id));
  const id = await f.command({ type: 'sale.post', warehouseId: warehouse, paymentMethod: expected.accountId,
    lines: [{ productId: expected.productId, quantity: 1, piecePrice: 25 }] });
  const sale = await f.db.collection('documents').findOne({ id });
  assert.equal(sale.lines[0].costAtSale, 10); assert.equal(sale.total, 25);
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: expected.accountId })).balance, 1007);
  assert.equal((await f.db.collection('products').findOne({ id: expected.productId })).stocks[warehouse], 9);
  await f.command({ type: 'sale.void', documentId: id, expectedRevision: sale.revision });
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: expected.accountId })).balance, 982);
  assert.equal((await f.db.collection('products').findOne({ id: expected.productId })).stocks[warehouse], 10);
  const report = await f.report('sales'); assert.deepEqual([report.summary.netSales, report.summary.cost, report.summary.profit], [72, 35, 37]);
  const current = await createNativeBackup(f.db);
  for (const original of originals) assert.deepEqual(document(current, original.mobileSource.id), original);
  const normal = document(current, 117);
  await f.command({ type: 'sale.update', documentId: normal.id, expectedRevision: normal.revision, warehouseId: normal.warehouseId,
    paymentMethod: normal.paymentMethod, lines: [{ productId: expected.secondProductId, quantity: 1, piecePrice: 12 }] });
  const edited = await f.db.collection('documents').findOne({ id: normal.id });
  await f.command({ type: 'sale.void', documentId: edited.id, expectedRevision: edited.revision });
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: expected.accountId })).balance, 970);
  assert.equal((await f.db.collection('products').findOne({ id: expected.secondProductId })).stocks[warehouse], 5);
});

test('voided repeated commercial lines retain their separate cost history without creating active movements', () => {
  const source = repeatedSource(), canceled = sourceRecord(source, 113);
  canceled.lines = [{ ...canceled.lines[0], qty: 0.5, costAtSale: 7 }, { ...canceled.lines[0], qty: 0.5, costAtSale: 13 }];
  const result = convertMobileBackup(source), doc = document(result, 113);
  assert.equal(doc.status, 'voided'); assert.equal(doc.legacyKey, doc.id);
  assert.deepEqual(doc.lines.map(line => [line.id, line.quantity, line.costAtSale]), [[`${doc.id}:line:1`, 0.5, 7], [`${doc.id}:line:2`, 0.5, 13]]);
  for (const name of ['stockMovements', 'financialMovements']) assert.equal(result.collections[name].some(row => row.documentId === doc.id), false);
});

test('missing references and unsupported noncommercial duplicates still reject with precise nonpersonal identifiers', () => {
  const missing = repeatedSource(); sourceRecord(missing, 102).lines[1].product = 991;
  const before = structuredClone(missing);
  assert.throws(() => convertMobileBackup(missing), /مرجع منتج مفقود.*102.*البند 2.*المنتج 991/); assert.deepEqual(missing, before);
  for (const id of [109, 110]) {
    const source = mobileBackupV23(), row = sourceRecord(source, id), line = row.lines[0];
    row.lines = [{ ...line, qty: line.qty / 2, ...(row.kind === 'adjustment' ? { delta: line.delta / 2 } : {}) }, { ...line, qty: line.qty / 2, ...(row.kind === 'adjustment' ? { delta: line.delta / 2 } : {}) }];
    assert.throws(() => convertMobileBackup(source), new RegExp(`تكرار منتج غير مدعوم.*${id}.*البند 2.*المنتج 1`));
  }
});

test('commercial repeated-line diagnostics retain the existing cent-rounded read-only reason', () => {
  const source = repeatedSource(), sale = sourceRecord(source, 102);
  sale.lines[0].price = 20.004;
  const result = convertMobileBackup(source), doc = document(result, 102);
  assert.match(doc.mobileReadOnlyReason, /Historical cent-rounded/); assert.match(doc.mobileReadOnlyReason, /Repeated product lines/);
  assert.equal(doc.lines[0].unitPrice, 20.004); assert.equal(doc.total, 60); assert.equal(doc.legacyKey, doc.id);
});
