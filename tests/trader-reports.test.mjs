import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteDatabase, ensureDatabaseSchema } from '../lib/sqlite.ts';
import { execute } from '../app/api/command/route.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { buildPartyLedger } from '../lib/party-ledger.ts';
import { buildReportFooterMetrics } from '../app/report-footer.ts';
import { translate } from '../app/i18n/messages.ts';

const document = (id, partyId, kind, day, values = {}) => ({ id, number: `SYN-${id}`, partyId, kind,
  status: 'posted', occurredAt: `${day}T12:00:00.000Z`, revision: 0, total: 0, paidTotal: 0, dueTotal: 0, lines: [], ...values });
const opening = (id, partyId, signed, day = '2026-08-01') => document(id, partyId, 'party-opening', day, {
  total: Math.abs(signed), partyOpeningAmount: Math.abs(signed), partyOpeningDirection: signed > 0 ? 'receivable' : 'payable', partyBalanceDelta: signed,
});
async function fixture(t) {
  const db = new SqliteDatabase(new Database(':memory:')); t.after(() => db.close()); ensureDatabaseSchema(db); await db.dropDatabase();
  await db.collection('warehouses').insertOne({ _id: 'w', name: 'Synthetic warehouse', isSalesDefault: true });
  await db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', balance: 1000, openingBalance: 1000, isActive: true });
  const command = body => db.transaction(session => execute(db, session, body));
  const report = (type = 'party-ledger', values = {}) => buildReport(db, parseReportFilters(new URL('http://local/api/reports?' +
    new URLSearchParams({ type, partyType: 'trader', allTime: 'true', unpaged: 'true', ...values }))));
  const snapshot = () => Promise.all(['parties', 'employees', 'products', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'auditEvents', 'counters']
    .map(name => db.collection(name).find().sort({ id: 1 }).toArray()));
  return { db, command, report, snapshot };
}
const values = summary => [summary.salesTotal, summary.purchasesTotal, summary.receivedTotal, summary.paidTotal, summary.closingReceivable, summary.closingPayable];

async function native(t) {
  const f = await fixture(t);
  const categoryId = await f.command({ type: 'product-category.create', name: 'Synthetic trader goods' });
  const productId = await f.command({ type: 'product.create', name: 'Synthetic trader product', categoryId, piecePrice: 20, pieceCost: 10, openingStock: 20, openingWarehouseId: 'w' });
  const a = await f.command({ type: 'trader.create', name: 'Synthetic trader A' }), b = await f.command({ type: 'trader.create', name: 'Synthetic trader B' });
  await f.command({ type: 'party-opening.post', partyId: a, direction: 'receivable', amount: 100, occurredAt: '2026-08-01' });
  await f.command({ type: 'party-opening.post', partyId: b, direction: 'payable', amount: 60, occurredAt: '2026-08-01' });
  const sale = (partyId, quantity, piecePrice, paymentMethod) => f.command({ type: 'sale.post', partyId, warehouseId: 'w', paymentMethod, lines: [{ productId, quantity, piecePrice }] });
  const purchase = (partyId, quantity, paymentMethod) => f.command({ type: 'purchase.post', partyId, warehouseId: 'w', paymentMethod, lines: [{ productId, quantity, unitPrice: 10 }] });
  const aCashSale = await sale(a, 2, 20, 'cash');
  const aPurchase = await purchase(a, 3, 'note');
  const aCreditSale = await sale(a, 1, 25, 'note');
  const aReceive = await f.command({ type: 'party-cash.post', partyId: a, direction: 'receive', amount: 50, paymentMethod: 'cash', note: 'Trader receipt literal' });
  const aPay = await f.command({ type: 'party-cash.post', partyId: a, direction: 'pay', amount: 20, paymentMethod: 'cash', note: 'Trader refund literal' });
  await purchase(b, 1, 'cash'); await sale(b, 1, 15, 'note');
  await f.command({ type: 'party-cash.post', partyId: b, direction: 'pay', amount: 5, paymentMethod: 'cash' });
  await f.command({ type: 'party-cash.post', partyId: b, direction: 'receive', amount: 10, paymentMethod: 'cash' });
  return { ...f, a, b, productId, aCashSale, aPurchase, aCreditSale, aReceive, aPay };
}

test('trader is a distinct report role and its footer never substitutes trade volume for one net debt position', () => {
  const filters = parseReportFilters(new URL('http://local/api/reports?type=party-ledger&partyType=trader&allTime=true'));
  assert.equal(filters.partyType, 'trader');
  const result = { report: 'party-ledger', summary: { partyType: 'trader', tradeTotal: 99999, salesTotal: 120, purchasesTotal: 80,
    receivedTotal: 25, paidTotal: 10, closingReceivable: 40, closingPayable: 12 }, rows: [], meta: { page: 1, pageSize: 100, totalRows: 0, totalPages: 1 } };
  const before = structuredClone(result), footer = buildReportFooterMetrics({ type: 'party-ledger', result });
  assert.deepEqual(footer.map(item => [item.key, item.value]), [['salesTotal', 120], ['purchasesTotal', 80], ['receivedTotal', 25], ['paidTotal', 10], ['closingReceivable', 40], ['closingPayable', 12]]);
  assert.deepEqual(footer.map(item => item.tone), ['positive', 'neutral', 'positive', 'negative', 'positive', 'negative']);
  assert.deepEqual(footer.map(item => item.label), ['صافي المبيعات', 'صافي المشتريات', 'تحصيلات الحساب', 'دفعات الحساب', 'لنا بنهاية الفترة', 'علينا بنهاية الفترة']);
  const french = buildReportFooterMetrics({ type: 'party-ledger', result, translate: key => translate('fr', key) });
  assert.deepEqual(french.map(item => item.label), ['Ventes nettes', 'Achats nets', 'Encaissements du compte', 'Paiements du compte', 'À recevoir en fin de période', 'À payer en fin de période']);
  assert.deepEqual(french.map(item => [item.key, item.value, item.tone]), footer.map(item => [item.key, item.value, item.tone]));
  assert.deepEqual(result, before);
});

test('native trader sales and purchases share one account; cash invoices and bank movements are not counted as extra receipts', async t => {
  const f = await native(t), before = await f.snapshot(), all = await f.report(), single = await f.report('party-ledger', { partyId: f.a });
  assert.deepEqual(values(all.summary), [80, 40, 60, 25, 65, 50]);
  assert.deepEqual([all.summary.partyCount, all.summary.transactionCount, all.summary.tradeTotal, all.summary.currentBalance, all.summary.reconciliationDifference, all.summary.unreconciledAccounts], [2, 11, 0, 15, 0, 0]);
  assert.deepEqual(values(single.summary), [65, 30, 50, 20, 65, 0]);
  const rows = new Map(single.rows.map(row => [row.documentId, row]));
  const savedPurchase = await f.db.collection('documents').findOne({ id: f.aPurchase });
  assert.deepEqual([savedPurchase.lines[0].unitPrice, savedPurchase.lines[0].lineTotal], [10, 30]);
  assert.deepEqual([rows.get(f.aCashSale).balanceChange, rows.get(f.aPurchase).balanceChange, rows.get(f.aCreditSale).balanceChange], [0, -30, 25]);
  assert.equal(rows.get(f.aReceive).movementType, 'استلام من التاجر'); assert.equal(rows.get(f.aPay).movementType, 'دفع للتاجر');
  assert.equal(rows.get(f.aReceive).description, 'Trader receipt literal');
  for (const row of all.rows) { assert.equal(row.partyType, 'trader'); assert.equal(row.balanceBefore + row.balanceChange, row.balanceAfter); }
  assert.equal((await f.db.collection('paymentAccounts').findOne({ id: 'cash' })).balance, 1065);
  assert.equal((await f.db.collection('products').findOne({ id: f.productId })).stocks.w, 20);
  assert.deepEqual(await f.snapshot(), before);
});

test('trader debts and overview classify each canonical trader once and leave customer/supplier groups separate', async t => {
  const f = await native(t);
  const customer = await f.command({ type: 'party.create', partyType: 'customer', name: 'Synthetic separate customer' });
  const supplier = await f.command({ type: 'party.create', partyType: 'supplier', name: 'Synthetic separate supplier' });
  await f.command({ type: 'party-opening.post', partyId: customer, direction: 'receivable', amount: 999, occurredAt: '2026-08-01' });
  await f.command({ type: 'party-opening.post', partyId: supplier, direction: 'payable', amount: 888, occurredAt: '2026-08-01' });
  const before = await f.snapshot(), debts = await f.report('debts'), allDebts = await f.report('debts', { partyType: '' }), overview = await f.report('overview', { partyType: '' });
  assert.deepEqual([debts.summary.count, debts.summary.receivable, debts.summary.payable, debts.summary.net], [2, 65, 50, 15]);
  assert(debts.rows.every(row => row.partyType === 'trader' && row.accountType === 'تاجر'));
  assert.deepEqual([allDebts.summary.count, allDebts.summary.receivable, allDebts.summary.payable], [4, 1064, 938]);
  assert.deepEqual([overview.summary.traderCount, overview.summary.customerCount, overview.summary.supplierCount, overview.summary.currentReceivable, overview.summary.currentPayable], [2, 1, 1, 1064, 938]);
  assert.deepEqual(overview.parties.filter(row => row.partyType === 'trader').map(row => row.partyId).sort(), [f.a, f.b].sort());
  assert.equal(overview.parties.filter(row => row.partyId === f.a).length, 1);
  assert.deepEqual([overview.summary.sales, overview.summary.purchases, overview.summary.salesCost, overview.summary.salesProfit, overview.summary.currentInventoryValue], [80, 40, 40, 40, 200]);
  const payable = await f.report('debts', { debtSide: 'payable' }); assert.deepEqual(payable.rows.map(row => row.partyId), [f.b]);
  await assert.rejects(f.report('party-ledger', { partyType: 'supplier', partyId: f.a }), /نوع الطرف غير مطابق/);
  assert.deepEqual(await f.snapshot(), before);
});

test('native trader receipt edits and true invoice/cash voids retain one effective contribution and saved COGS', async t => {
  const f = await native(t), receipt = await f.db.collection('documents').findOne({ id: f.aReceive });
  await f.command({ type: 'party-cash.update', documentId: f.aReceive, expectedRevision: receipt.revision, direction: 'receive', amount: 60, paymentMethod: 'cash', note: 'Edited trader receipt' });
  let ledger = await f.report('party-ledger', { partyId: f.a }); assert.deepEqual(values(ledger.summary), [65, 30, 60, 20, 55, 0]);
  assert.equal(ledger.rows.filter(row => row.documentId === f.aReceive).length, 1);
  const creditSale = await f.db.collection('documents').findOne({ id: f.aCreditSale }), savedCost = creditSale.lines[0].costAtSale;
  await f.command({ type: 'sale.void', documentId: creditSale.id, expectedRevision: creditSale.revision, reason: 'Synthetic trader sale void' });
  const purchase = await f.db.collection('documents').findOne({ id: f.aPurchase });
  await f.command({ type: 'purchase.void', documentId: purchase.id, expectedRevision: purchase.revision, reason: 'Synthetic trader purchase void' });
  const editedReceipt = await f.db.collection('documents').findOne({ id: f.aReceive });
  await f.command({ type: 'party-cash.void', documentId: editedReceipt.id, expectedRevision: editedReceipt.revision, reason: 'Synthetic trader receipt void' });
  ledger = await f.report('party-ledger', { partyId: f.a }); assert.deepEqual(values(ledger.summary), [40, 0, 0, 20, 120, 0]);
  assert.equal(ledger.summary.unreconciledAccounts, 0);
  assert(!ledger.rows.some(row => [f.aCreditSale, f.aPurchase, f.aReceive].includes(row.documentId)));
  assert.equal((await f.db.collection('documents').findOne({ id: f.aCreditSale })).lines[0].costAtSale, savedCost);
  const before = await f.snapshot(); await f.report(); assert.deepEqual(await f.snapshot(), before);
});

test('historical trader returns use the parent kind outside the period, preserve settlement/offset facts and never invent two role accounts', async t => {
  const f = await fixture(t);
  await f.db.collection('parties').insertMany([
    { id: 't', name: 'Synthetic historical trader', partyType: 'trader', receivable: 55, payable: 0 },
    { id: 'other', name: 'Synthetic other trader', partyType: 'trader', receivable: 0, payable: 45, isArchived: true },
    { id: 'customer', name: 'Synthetic unrelated customer', partyType: 'customer', receivable: 900, payable: 0 },
  ]);
  await f.db.collection('documents').insertMany([
    opening('open', 't', 100), opening('open-other', 'other', -45), opening('open-customer', 'customer', 900),
    document('sale', 't', 'sale', '2026-08-02', { total: 200, dueTotal: 80, paidTotal: 120 }),
    document('purchase', 't', 'purchase', '2026-08-03', { total: 150, dueTotal: 90, paidTotal: 60 }),
    document('sale-return', 't', 'return', '2026-08-10', { total: 30, paidTotal: 10, parentDocumentId: 'sale' }),
    document('purchase-return', 't', 'return', '2026-08-11', { total: 40, paidTotal: 15, parentDocumentId: 'purchase' }),
    document('receive', 't', 'payment', '2026-08-12', { total: 25, paidTotal: 25, cashAmount: 25, partyCashDirection: 'receive', partyBalanceDelta: -25 }),
    document('pay', 't', 'payment', '2026-08-13', { total: 10, paidTotal: 10, cashAmount: 10, partyCashDirection: 'pay', partyBalanceDelta: 10 }),
    document('settlement', 't', 'settlement', '2026-08-14', { total: 20, settledReceivable: 20, settledPayable: 0 }),
    document('offset', 't', 'offset', '2026-08-15', { total: 5, partyBalanceDelta: -5 }),
    document('void-sale', 't', 'sale', '2026-08-15', { total: 999, dueTotal: 999, status: 'voided' }),
  ]);
  const before = await f.snapshot(), period = await f.report('party-ledger', { allTime: 'false', from: '2026-08-10', to: '2026-08-31' });
  assert.deepEqual(values(period.summary), [-30, -40, 25, 10, 55, 45]);
  assert.deepEqual([period.summary.partyCount, period.summary.openingBalance, period.summary.closingBalance, period.summary.tradeTotal, period.summary.unreconciledAccounts], [2, 45, 10, 0, 0]);
  const rows = new Map(period.rows.map(row => [row.documentId, row]));
  assert.deepEqual([rows.get('sale-return').balanceBefore, rows.get('sale-return').balanceChange, rows.get('sale-return').balanceAfter], [90, -20, 70]);
  assert.deepEqual([rows.get('purchase-return').balanceBefore, rows.get('purchase-return').balanceChange, rows.get('purchase-return').balanceAfter], [70, 25, 95]);
  assert.deepEqual([rows.get('settlement').balanceChange, rows.get('offset').balanceChange], [-20, -5]);
  const all = await f.report(); assert.deepEqual(values(all.summary), [170, 110, 25, 10, 55, 45]);
  const paged = await f.report('party-ledger', { allTime: 'false', from: '2026-08-10', to: '2026-08-31', unpaged: 'false', page: '2', pageSize: '2', sortKey: 'balanceAfter', sortDirection: 'asc' });
  assert.equal(paged.rows.length, 2); assert.deepEqual(paged.summary, period.summary);
  for (const row of paged.rows) assert.deepEqual([row.balanceBefore, row.balanceChange, row.balanceAfter], [rows.get(row.documentId).balanceBefore, rows.get(row.documentId).balanceChange, rows.get(row.documentId).balanceAfter]);
  assert.deepEqual(await f.snapshot(), before);
});

test('trader saved legacy contributions survive missing return classification while customer/supplier summary contracts remain unchanged', () => {
  const trader = { id: 't', name: 'Synthetic trader', partyType: 'trader', receivable: 5, payable: 0 };
  const saved = [opening('open', 't', 10), document('unknown-return', 't', 'return', '2026-08-10', { total: 99, partyBalanceDelta: -5 })];
  const before = structuredClone(saved), report = buildPartyLedger(trader, saved, new Map());
  assert.deepEqual([report.summary.salesTotal, report.summary.purchasesTotal, report.summary.tradeTotal, report.summary.closingBalance, report.summary.reconciliationDifference], [0, 0, 0, 5, 0]);
  assert.equal(report.rows.find(row => row.documentId === 'unknown-return').balanceChange, -5); assert.deepEqual(saved, before);
  for (const partyType of ['customer', 'supplier']) {
    const old = buildPartyLedger({ id: 'p', partyType, name: 'Original role', receivable: 0, payable: 0 }, [], new Map());
    assert.equal('salesTotal' in old.summary, false); assert.equal('purchasesTotal' in old.summary, false);
    assert.deepEqual(buildReportFooterMetrics({ type: 'party-ledger', result: { summary: old.summary } }).map(row => row.key), ['tradeTotal', partyType === 'customer' ? 'receivedTotal' : 'paidTotal', 'closingReceivable', 'closingPayable']);
  }
});
