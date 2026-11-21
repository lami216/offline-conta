import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { convertMobileBackup } from '../lib/mobile-backup.ts';
import { BACKUP_COLLECTIONS, createNativeBackup, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from '../lib/backup.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { execute } from '../app/api/command/route.ts';
import { sqliteHarness } from './sqlite-harness.mjs';
import { mobileBackupV23, mobileBackupV23Expected as expected } from './fixtures/mobile-backup-v23.mjs';

const sourceRecord = (source, id) => source.state.records.find(row => row.id === id);
const importedRecord = (backup, id) => backup.collections.documents.find(row => row.id === `mobile23:record:${id}`);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceArchive = backup => backup.collections.appSettings.find(row => row.inertSourceArchive === true);
const filters = (type, extra = {}) => ({ ...parseReportFilters(new URL(`http://local/?type=${type}&allTime=true&unpaged=true`)), ...extra });

async function restored(t, source = mobileBackupV23()) {
  const h = await sqliteHarness(), previous = process.env.ALKARNA_USER_DATA;
  process.env.ALKARNA_USER_DATA = h.directory;
  t.after(async () => { await h.close(); if (previous === undefined) delete process.env.ALKARNA_USER_DATA; else process.env.ALKARNA_USER_DATA = previous; });
  await h.db.dropDatabase();
  const converted = parseAndValidateBackup(JSON.stringify(source));
  await h.db.transaction(session => restoreNativeBackup(h.db, converted, session));
  const command = body => h.db.transaction(session => execute(h.db, session, body));
  const report = (type, extra) => buildReport(h.db, filters(type, extra));
  return { ...h, converted, command, report };
}

test('Mobile23 becomes all seventeen canonical collections without activating source credentials or mutating its original archive', () => {
  const source = mobileBackupV23(), before = structuredClone(source), result = convertMobileBackup(source);
  assert.deepEqual(source, before);
  assert.deepEqual(Object.keys(result.collections).sort(), [...BACKUP_COLLECTIONS].sort());
  for (const name of BACKUP_COLLECTIONS) assert.equal(result.counts[name], result.collections[name].length, name);
  assert.deepEqual(result.mobileImport, { sourceFormat: 'alkarna-web-backup', schemaVersion: 1 });
  assert.deepEqual(result.collections.users, []);
  assert.deepEqual(sourceArchive(result).originalBackup, before);
  assert.equal(sourceArchive(result).sourceSha256, hash(before));
  assert.deepEqual(convertMobileBackup(source), result, 'Repeated preview creates the same identities and effects');
  assert.deepEqual(result.collections.products.map(row => [row.id, row.sku, row.barcode]), [[expected.productId, 'M23-1', '001'], [expected.secondProductId, 'M23-2', '002']]);
  for (const row of result.collections.products) assert.match(row.mobileImportedCostBasis, /^[a-f0-9]{64}$/);
  const title = result.collections.appSettings.find(row => row._id === 'invoice-branding');
  assert.equal(title.storeName, source.state.branding);
  assert.equal(result.collections.appSettings.find(row => row._id === 'currency-settings').code, 'MRU');
});

test('actual native restore and re-export preserve Mobile balances, stock, COGS, P&L, party orientations and canceled documents', async t => {
  const f = await restored(t), overview = await f.report('overview'), sales = await f.report('sales');
  assert.deepEqual([overview.summary.sales, overview.summary.salesCost, overview.summary.salesProfit, overview.summary.purchases, overview.summary.expenses, overview.summary.netOperatingResult], [72, 35, 37, 60, 20, 17]);
  assert.deepEqual([overview.summary.currentAccountsBalance, overview.summary.currentInventoryValue, overview.summary.currentReceivable, overview.summary.currentPayable], [1197, 160, 120, 190]);
  assert.deepEqual([sales.summary.netSales, sales.summary.cost, sales.summary.profit, sales.summary.costKnown], [72, 35, 37, true]);
  const first = await createNativeBackup(f.db), documents = first.collections.documents;
  assert.equal(documents.find(row => row.id === expected.voidedSaleId).status, 'voided');
  assert.equal(first.collections.financialMovements.some(row => row.documentId === expected.voidedSaleId), false);
  assert.equal(first.collections.stockMovements.some(row => row.documentId === expected.voidedSaleId), false);
  const purchase = documents.find(row => row.id === 'mobile23:record:101');
  assert.deepEqual([purchase.revision, purchase.total, purchase.lines[0].quantity, purchase.lines[0].unitPrice], [1, 40, 4, 10]);
  assert.equal(first.collections.stockMovements.filter(row => row.documentId === purchase.id).length, 1);
  assert.equal(first.collections.financialMovements.filter(row => row.documentId === purchase.id).length, 1);
  assert.equal(sourceArchive(first).originalBackup.state.records.find(row => row.id === 101).revisions[0].total, 30);
  assert.equal(first.collections.stockMovements.every(row => !Object.hasOwn(row, 'balanceBefore') && !Object.hasOwn(row, 'balanceAfter')), true, 'Source history never becomes fabricated native before/after proof');
  const encoded = parseAndValidateBackup(stringifyBackup(first));
  await f.db.transaction(session => restoreNativeBackup(f.db, encoded, session));
  const second = await createNativeBackup(f.db);
  for (const name of ['products', 'parties', 'paymentAccounts', 'documents', 'stockMovements', 'financialMovements', 'accountTransfers', 'appSettings']) assert.deepEqual(second.collections[name], first.collections[name], name);
  assert.deepEqual((await f.report('overview')).summary, overview.summary);
});

test('every editable imported current record inverses exactly once through actual native commands', async t => {
  const cases = [
    [117, { type: 'sale.void' }, { cash: 970, bank: 215, customer: 120, supplier: 190, p1: 10, p2: 5 }],
    [101, { type: 'purchase.void' }, { cash: 1022, bank: 215, customer: 120, supplier: 190, p1: 6, p2: 4 }],
    [114, { type: 'purchase.void' }, { cash: 982, bank: 215, customer: 120, supplier: 170, p1: 8, p2: 4 }],
    [105, { type: 'expense.void' }, { cash: 1002, bank: 215, customer: 120, supplier: 190, p1: 10, p2: 4 }],
    [103, { type: 'party-cash.void' }, { cash: 952, bank: 215, customer: 150, supplier: 190, p1: 10, p2: 4 }],
    [104, { type: 'party-cash.void' }, { cash: 992, bank: 215, customer: 110, supplier: 190, p1: 10, p2: 4 }],
    [115, { type: 'party-cash.void' }, { cash: 982, bank: 205, customer: 120, supplier: 180, p1: 10, p2: 4 }],
    [116, { type: 'party-cash.void' }, { cash: 982, bank: 235, customer: 120, supplier: 210, p1: 10, p2: 4 }],
    [106, { type: 'account-adjustment.void' }, { cash: 932, bank: 215, customer: 120, supplier: 190, p1: 10, p2: 4 }],
    [107, { type: 'account-adjustment.void' }, { cash: 997, bank: 215, customer: 120, supplier: 190, p1: 10, p2: 4 }],
    [108, { type: 'account-transfer.void' }, { cash: 1007, bank: 190, customer: 120, supplier: 190, p1: 10, p2: 4 }],
    [109, { type: 'transfer.void' }, { cash: 982, bank: 215, customer: 120, supplier: 190, p1: 12, p2: 4 }],
    [110, { type: 'adjustment.void' }, { cash: 982, bank: 215, customer: 120, supplier: 190, p1: 11, p2: 4 }],
  ];
  for (const [sourceId, command, want] of cases) await t.test(`${sourceId} ${command.type}`, async t => {
    const f = await restored(t), documentId = `mobile23:record:${sourceId}`;
    const document = await f.db.collection('documents').findOne({ id: documentId });
    await f.command({ ...command, documentId, expectedRevision: document.revision });
    const state = await createNativeBackup(f.db), warehouse = state.collections.warehouses.find(row => row.name === 'الرئيسي')._id;
    const by = (name, id) => state.collections[name].find(row => row.id === id);
    assert.deepEqual({ cash: by('paymentAccounts', expected.accountId).balance, bank: by('paymentAccounts', expected.bankId).balance,
      customer: by('parties', expected.customerId).receivable - by('parties', expected.customerId).payable,
      supplier: by('parties', expected.supplierId).payable - by('parties', expected.supplierId).receivable,
      p1: by('products', expected.productId).stocks[warehouse], p2: by('products', expected.secondProductId).stocks[warehouse] }, want);
    assert.equal(by('documents', documentId).status, 'voided');
    const stable = await createNativeBackup(f.db);
    await assert.rejects(f.command({ ...command, documentId, expectedRevision: document.revision }));
    const afterDuplicate = await createNativeBackup(f.db);
    for (const name of ['products', 'parties', 'paymentAccounts', 'documents', 'stockMovements', 'financialMovements']) assert.deepEqual(afterDuplicate.collections[name], stable.collections[name], name);
    parseAndValidateBackup(stringifyBackup(afterDuplicate));
  });
});

test('header-only native edits retain fractional Mobile prices, saved costs and current-effective imported revision', async t => {
  const source = mobileBackupV23(), sale = sourceRecord(source, 117);
  sale.total = sale.paid = 12.5; sale.lines[0].price = 12.5; sale.profit = 7.5; source.state.accounts[0].balance += 0.5;
  const f = await restored(t, source), before = await f.db.collection('documents').findOne({ id: expected.saleId });
  await f.command({ type: 'sale.update', documentId: before.id, expectedRevision: before.revision, warehouseId: before.warehouseId, paymentMethod: before.paymentMethod,
    lines: [{ productId: expected.secondProductId, quantity: 1, piecePrice: 12.5 }] });
  const after = await f.db.collection('documents').findOne({ id: before.id });
  assert.deepEqual([after.total, after.lines[0].unitPrice, after.lines[0].costAtSale, after.lines[0].lineTotalMode], [12.5, 12.5, 5, 'exact']);
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: expected.accountId })).balance, 982.5);
  assert.equal((await f.report('sales')).summary.profit, 37.5);
});

test('an offset remains a linked noncash historical pair and cannot be half-reversed', async t => {
  const f = await restored(t), backup = await createNativeBackup(f.db), id = 'mobile23:record:111';
  const a = backup.collections.documents.find(row => row.id === id), b = backup.collections.documents.find(row => row.id === `${id}:counterparty`);
  assert.deepEqual([a.kind, b.kind, a.partyBalanceDelta, b.partyBalanceDelta, a.mobileOffsetPeerId, b.mobileOffsetPeerId], ['settlement', 'settlement', -20, 20, b.id, a.id]);
  assert.equal(backup.collections.financialMovements.some(row => [a.id, b.id].includes(row.documentId)), false);
  for (const doc of [a, b]) await assert.rejects(f.command({ type: 'legacy-party-document.void', documentId: doc.id, expectedRevision: doc.revision }), /للعرض فقط/);
  const after = await createNativeBackup(f.db);
  for (const name of ['parties', 'documents', 'paymentAccounts', 'financialMovements']) assert.deepEqual(after.collections[name], backup.collections[name], name);
});

test('optional blank barcodes and wholesale null preserve native usability, currency, branding and original notes', () => {
  const source = mobileBackupV23();
  for (const p of source.state.products) { p.sku = ''; p.wholesale = null; }
  source.state.products[0].note = 'ملاحظة منتج\nTexte littéral';
  source.state.currency = { code: 'EUR', availableCodes: ['EUR', 'MRU'] };
  Object.assign(source.state.brandInfo, { phone: '000000', address: 'عنوان تجريبي', footer: 'Fin littérale', nameFont: 'arial', nameFontSize: 20, nameFontWeight: 600 });
  const result = convertMobileBackup(source);
  assert.deepEqual(result.collections.products.map(row => [row.sku, row.barcode, row.wholesalePrice]), [['M23-1', null, 20], ['M23-2', null, 12]]);
  assert.equal(result.collections.products[0].note, source.state.products[0].note);
  const branding = result.collections.appSettings.find(row => row._id === 'invoice-branding');
  assert.deepEqual([branding.storeName, branding.storePhone, branding.storeAddress, branding.footerNote, branding.nameFont, branding.nameFontSize, branding.nameFontWeight], [source.state.branding, '000000', 'عنوان تجريبي', 'Fin littérale', 'arial', 20, 600]);
  assert.equal(result.collections.appSettings.find(row => row._id === 'currency-settings').code, 'EUR');
  source.state.products[0].sku = source.state.products[1].sku = 'duplicate';
  assert.throws(() => convertMobileBackup(source), /باركود مكرر/);
});

test('one missing saved cost derives only from the original invoice profit, not a stale acquisition or current card', async t => {
  const source = mobileBackupV23(), sale = sourceRecord(source, 102);
  delete sale.lines[0].costAtSale; sale.profit = 21;
  const original = structuredClone(source), converted = convertMobileBackup(source), line = importedRecord(converted, 102).lines[0];
  assert.deepEqual(source, original);
  assert.deepEqual(sourceArchive(converted).originalBackup, original);
  assert.equal(sourceArchive(converted).sourceSha256, hash(original));
  assert.equal(line.costAtSale, 13);
  assert.equal(line.mobileDerivedCost.method, 'only-unpriced-line-from-saved-total-profit');
  assert.equal(importedRecord(converted, 101).lines[0].unitPrice, 10);
  assert.equal(converted.collections.products[0].mobileImportedCurrentCost, 10);
  const f = await restored(t, source), report = await f.report('sales');
  assert.deepEqual([report.summary.netSales, report.summary.cost, report.summary.profit, report.summary.costKnown], [72, 44, 28, true]);
});

test('all-but-one priced lines prove the remaining cost; multiple unknown lines fail closed without changing input', () => {
  const source = mobileBackupV23(), sale = sourceRecord(source, 102);
  sale.lines.push({ product: 2, name: 'رصيد تجريبي', qty: 1, price: 12, costAtSale: 5 });
  sale.total = sale.due = 72; sale.profit = 37; source.state.parties[0].balance += 12;
  source.state.products[1].stocks['الرئيسي']--; source.state.products[1].qty--;
  delete sale.lines[0].costAtSale;
  assert.deepEqual(importedRecord(convertMobileBackup(source), 102).lines.map(row => row.costAtSale), [10, 5]);
  delete sale.lines[1].costAtSale;
  const before = structuredClone(source);
  assert.throws(() => convertMobileBackup(source), /تكلفة البيع التاريخية.*102/);
  assert.deepEqual(source, before);
});

test('canceled and previous snapshots retain unknown costs, old warehouses and valid receive-to-pay history as inert evidence', () => {
  const source = mobileBackupV23(), previous = sourceRecord(source, 101).revisions[0];
  previous.warehouse = 'اسم مخزن قديم'; previous.lines[0].product = 999;
  const canceled = sourceRecord(source, 113); delete canceled.lines[0].costAtSale;
  canceled.lines.push({ product: 2, qty: 1, price: 12 }); canceled.total = canceled.paid = 32; canceled.profit = 17;
  const cash = sourceRecord(source, 104); cash.revision = 1;
  cash.revisions = [{ ...structuredClone(cash), kind: 'receive', revision: 0, revisions: [] }];
  const result = convertMobileBackup(source);
  assert.equal(importedRecord(result, 113).lines.every(row => row.costAtSale === null), true);
  assert.deepEqual(sourceArchive(result).originalBackup, source);
  assert.equal(result.collections.financialMovements.filter(row => row.documentId === 'mobile23:record:104').length, 1);
  assert.equal(importedRecord(result, 104).partyCashDirection, 'pay');
});

test('valid Mobile cent-rounded lines keep original price and total readonly, and conflicting known profit is never confirmed silently', () => {
  const source = mobileBackupV23(), sale = sourceRecord(source, 117);
  sale.lines[0].price = 12.004;
  const result = convertMobileBackup(source), doc = importedRecord(result, 117);
  assert.deepEqual([doc.total, doc.lines[0].unitPrice, doc.lines[0].costAtSale], [12, 12.004, 5]);
  assert.ok(doc.legacyKey);
  assert.equal(doc.lines[0].lineTotalMode, undefined);
  sale.lines[0].price = 12; sale.lines[0].costAtSale = 5.004;
  assert.throws(() => convertMobileBackup(source), /تقريب الربح التاريخي.*117/);
});

test('opening-account corrections retain the current basis but contribute their real cash delta only once', async t => {
  const source = mobileBackupV23();
  source.state.records.unshift({ id: 118, kind: 'deposit', date: '2026-11-18', time: '11:00', total: 100, paid: 100, due: 0, account: 1, lines: [], openingAccountCorrection: true, openingBalanceBefore: 1000, openingBalanceAfter: 1100, note: 'تصحيح مصدر محفوظ' });
  source.state.accounts[0].openingBalance = 1100; source.state.accounts[0].balance = 1082;
  const f = await restored(t, source), backup = await createNativeBackup(f.db), account = backup.collections.paymentAccounts.find(row => row.id === expected.accountId);
  assert.deepEqual([account.balance, account.openingBalance, account.mobileSource.baselineOpeningBalance], [1082, 1100, 1000]);
  const rows = backup.collections.financialMovements.filter(row => row.paymentMethod === expected.accountId);
  assert.equal(rows.filter(row => row.type === 'opening-balance').reduce((sum, row) => sum + row.amount, 0), 1000);
  assert.equal(rows.filter(row => row.type === 'opening-balance-correction').reduce((sum, row) => sum + row.amount, 0), 100);
  assert.equal(rows.reduce((sum, row) => sum + (row.direction === 'in' ? 1 : -1) * row.amount, 0), 1082);
  assert.equal((await f.report('overview')).summary.netOperatingResult, 17);
  parseAndValidateBackup(stringifyBackup(backup));
});

test('signed residual opening cash is represented without coercion or an invented cash adjustment', () => {
  const source = mobileBackupV23();
  source.state.opening.accounts[1] = -1000; delete source.state.accounts[0].openingBalance;
  sourceRecord(source, 106).total = sourceRecord(source, 106).paid = 2050;
  const result = convertMobileBackup(source), account = result.collections.paymentAccounts.find(row => row.id === expected.accountId);
  assert.deepEqual([account.openingBalance, account.balance], [-1000, 982]);
  const rows = result.collections.financialMovements.filter(row => row.paymentMethod === expected.accountId);
  assert.equal(rows.find(row => row.type === 'opening-balance').direction, 'out');
  assert.equal(rows.reduce((sum, row) => sum + (row.direction === 'in' ? 1 : -1) * row.amount, 0), 982);
});

test('a source opening relocation retains both warehouse legs and cannot be reversed as a single-warehouse native count', async t => {
  const source = mobileBackupV23(), product = source.state.products[1];
  source.state.records.unshift({ id: 118, kind: 'adjustment', date: '2026-11-18', time: '11:00', total: 0, paid: 0, due: 0,
    warehouse: 'الفرعي', openingCorrection: true, openingProduct: 2, openingTotalBefore: 5, openingTotalAfter: 5,
    openingCostBefore: 5, openingCostAfter: 5, openingWarehouseBefore: 'الرئيسي', openingWarehouseAfter: 'الفرعي',
    lines: [{ product: 2, qty: 4, price: 5, delta: -4, warehouse: 'الرئيسي' }, { product: 2, qty: 4, price: 5, delta: 4, warehouse: 'الفرعي' }] });
  product.stocks['الرئيسي'] = 0; product.stocks['الفرعي'] = 4; product.qty = 0; product.openingWarehouse = 'الفرعي';
  const converted = convertMobileBackup(source), doc = importedRecord(converted, 118);
  assert.equal(doc.openingCorrection, true);
  assert.equal(doc.mobileOpening.openingWarehouseBefore, 'الرئيسي');
  const byId = new Map(converted.collections.warehouses.map(row => [row._id, row.name]));
  assert.deepEqual(doc.lines.map(row => [byId.get(row.warehouseId), row.quantity]), [['الرئيسي', -4], ['الفرعي', 4]]);
  assert.deepEqual(converted.collections.stockMovements.filter(row => row.documentId === doc.id).map(row => [byId.get(row.warehouseId), row.quantityDelta]), [['الرئيسي', -4], ['الفرعي', 4]]);
  const f = await restored(t, source), before = await createNativeBackup(f.db);
  await assert.rejects(f.command({ type: 'adjustment.void', documentId: doc.id, expectedRevision: 0 }));
  const after = await createNativeBackup(f.db);
  for (const name of ['products', 'documents', 'stockMovements', 'financialMovements']) assert.deepEqual(after.collections[name], before.collections[name], name);
  const overview = await f.report('overview');
  assert.deepEqual([overview.summary.currentInventoryValue, overview.summary.currentAccountsBalance, overview.summary.netOperatingResult], [160, 1197, 17]);
});

test('unsupported effects, broken identities and tiny rounded-away cash discrepancies reject before conversion', () => {
  const cases = [
    source => { source.state.products[0].stocks['الرئيسي']++; source.state.products[0].qty++; },
    source => { source.state.accounts[0].balance++; },
    source => { source.state.parties[1].balance++; },
    source => { sourceRecord(source, 102).party = 2; },
    source => { sourceRecord(source, 108).to = 1; },
    source => { sourceRecord(source, 117).kind = 'employee-payment'; },
    source => { sourceRecord(source, 102).discountAmount = 1; },
    source => { source.state.salesWarehouse = 'missing'; },
    source => { source.state.products[0].price = NaN; },
    source => { source.state.records.push({ id: 118, kind: 'expense', date: '2026-11-18', time: '11:00', total: 0.004, paid: 0.004, due: 0, account: 1, lines: [] }); },
  ];
  for (const change of cases) { const source = mobileBackupV23(); change(source); assert.throws(() => convertMobileBackup(source), /نسخة Mobile غير متوافقة/); }
});

test('a supported prior Desktop source remains evidence rather than overwriting current phone changes; richer unmapped commitments reject', () => {
  const source = mobileBackupV23();
  source.state.desktopOriginal = { format: 'conta-backup', schemaVersion: 1, collections: { products: [], parties: [], warehouses: [], documents: [], paymentAccounts: [], financialMovements: [], expenseCategories: [{ id: 'old-category', name: 'فئة أصلية', kind: 'nonrecurring', revision: 0 }] } };
  sourceRecord(source, 105).desktop = { expenseCategoryId: 'old-category' };
  const result = convertMobileBackup(source), expense = importedRecord(result, 105);
  assert.equal(result.collections.paymentAccounts.find(row => row.id === expected.accountId).balance, 982);
  assert.equal(result.collections.expenseCategories.find(row => row.id === expense.expenseCategoryId).name, 'فئة أصلية');
  assert.deepEqual(sourceArchive(result).originalBackup.state.desktopOriginal, source.state.desktopOriginal);
  source.state.desktopOriginal.collections.employees = [{ id: 'unrepresented-worker' }];
  assert.throws(() => convertMobileBackup(source), /التزامات موظفين/);
});
