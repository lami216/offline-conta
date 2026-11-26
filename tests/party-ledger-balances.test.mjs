import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteDatabase, ensureDatabaseSchema } from '../lib/sqlite.ts';
import { buildReport, parseReportFilters } from '../lib/reports.ts';
import { execute } from '../app/api/command/route.ts';

const doc = (id, partyId, kind, day, extra = {}) => ({
  id, number: `SYN-${id}`, partyId, kind, status: 'posted', revision: 0,
  occurredAt: `${day}T12:00:00.000Z`, total: 0, paidTotal: 0, dueTotal: 0, lines: [], ...extra,
});
const opening = (id, partyId, signed, day = '2026-08-01') => doc(id, partyId, 'party-opening', day, {
  total: Math.abs(signed), partyOpeningAmount: Math.abs(signed),
  partyOpeningDirection: signed > 0 ? 'receivable' : 'payable', partyBalanceDelta: signed,
});
const cash = (id, partyId, direction, total, day = '2026-08-10', extra = {}) => doc(id, partyId, 'payment', day, {
  total, cashAmount: total, paidTotal: total, partyCashDirection: direction,
  partyBalanceDelta: direction === 'receive' ? -total : total, ...extra,
});
async function fixture(t) {
  const db = new SqliteDatabase(new Database(':memory:'));
  t.after(() => db.close()); ensureDatabaseSchema(db); await db.dropDatabase();
  await db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', balance: 1000, isActive: true });
  await db.collection('warehouses').insertOne({ _id: 'w', name: 'Synthetic warehouse', isSalesDefault: true });
  const report = (extra = {}) => buildReport(db, parseReportFilters(new URL('http://local/api/reports?' +
    new URLSearchParams({ type: 'party-ledger', partyType: 'customer', allTime: 'true', unpaged: 'true', ...extra }))));
  const party = async (id, role, signed, extra = {}) => db.collection('parties').insertOne({
    id, name: `Synthetic ${id}`, partyType: role, receivable: Math.max(signed, 0), payable: Math.max(-signed, 0), ...extra,
  });
  const snapshot = () => Promise.all(['parties', 'employees', 'documents', 'financialMovements', 'stockMovements', 'paymentAccounts', 'auditEvents', 'counters']
    .map(name => db.collection(name).find().toArray()));
  return { db, report, party, snapshot, command: body => db.transaction(session => execute(db, session, body)) };
}
const sides = summary => [summary.openingBalance, summary.closingBalance, summary.currentBalance, summary.closingReceivable, summary.closingPayable];

test('all-role customer balances replay each account separately before period selection, including accounts without period activity', async t => {
  const f = await fixture(t);
  await f.party('a', 'customer', 70); await f.party('b', 'customer', -40, { isArchived: true }); await f.party('c', 'customer', 70);
  await f.party('supplier', 'supplier', -999);
  await f.db.collection('documents').insertMany([
    opening('open-a', 'a', 100), opening('open-b', 'b', -40), opening('open-c', 'c', 50),
    cash('receive-a', 'a', 'receive', 30), cash('future-c', 'c', 'pay', 20, '2026-09-01'),
    cash('void-a', 'a', 'pay', 900, '2026-08-10', { status: 'voided' }),
  ]);
  const before = await f.snapshot(), report = await f.report({ allTime: 'false', from: '2026-08-10', to: '2026-08-31' });
  assert.equal(report.rows.length, 1);
  assert.deepEqual([report.rows[0].partyId, report.rows[0].party, report.rows[0].balanceBefore, report.rows[0].balanceChange, report.rows[0].balanceAfter],
    ['a', 'Synthetic a', 100, -30, 70]);
  assert.deepEqual(sides(report.summary), [110, 80, 100, 120, 40]);
  assert.deepEqual([report.summary.partyCount, report.summary.receivedTotal, report.summary.paidTotal, report.summary.unreconciledAccounts], [3, 30, 0, 0]);
  assert.deepEqual([report.summary.receivable, report.summary.payable], [140, 40]);
  const empty = await f.report({ allTime: 'false', from: '2026-08-20', to: '2026-08-21' });
  assert.deepEqual(empty.rows, []); assert.deepEqual(sides(empty.summary), [80, 80, 100, 120, 40]);
  assert.deepEqual(await f.snapshot(), before);
});

test('native opening, invoice and receipt edits use one effective contribution and never add the bank row twice', async t => {
  const f = await fixture(t);
  const partyId = await f.command({ type: 'party.create', partyType: 'customer', name: 'Synthetic native customer' });
  await f.command({ type: 'party-opening.post', partyId, direction: 'receivable', amount: 100, occurredAt: '2026-08-01' });
  const receiptId = await f.command({ type: 'party-cash.post', partyId, direction: 'receive', amount: 30, paymentMethod: 'cash', note: 'Literal receipt' });
  await f.command({ type: 'party-cash.post', partyId, direction: 'pay', amount: 10, paymentMethod: 'cash' });
  await f.db.collection('products').insertOne({ id: 'p', name: 'Synthetic product', stocks: { w: 20 }, openingCost: 5, lastPurchaseCost: 5 });
  await f.command({ type: 'sale.post', partyId, warehouseId: 'w', paymentMethod: 'cash', lines: [{ productId: 'p', quantity: 1, piecePrice: 10 }] });
  await f.command({ type: 'sale.post', partyId, warehouseId: 'w', paymentMethod: 'note', lines: [{ productId: 'p', quantity: 1, piecePrice: 20 }] });
  const receipt = await f.db.collection('documents').findOne({ id: receiptId });
  await f.command({ type: 'party-cash.update', documentId: receiptId, expectedRevision: receipt.revision, amount: 40,
    direction: 'receive', paymentMethod: 'cash', note: 'Literal updated receipt' });
  const before = await f.snapshot(), report = await f.report({ partyId });
  assert.deepEqual([report.summary.tradeTotal, report.summary.receivedTotal, report.summary.paidTotal, report.summary.currentBalance], [30, 40, 10, 90]);
  assert.deepEqual([report.summary.closingBalance, report.summary.unreconciledAccounts, report.summary.reconciliationDifference], [90, 0, 0]);
  const row = report.rows.find(item => item.documentId === receiptId);
  assert.equal(row.balanceChange, -40); assert.equal(row.description, 'Literal updated receipt');
  assert.equal(report.rows.filter(item => item.documentId === receiptId).length, 1);
  assert.equal(report.summary.transactionCount, 5);
  for (const item of report.rows) assert.equal(item.balanceBefore + item.balanceChange, item.balanceAfter);
  assert.deepEqual(await f.snapshot(), before);
});

test('legacy structured net facts and current cash movements preserve signs, settlements and notes without double counting', async t => {
  const f = await fixture(t); await f.party('c', 'customer', 80);
  await f.db.collection('documents').insertMany([
    opening('opening', 'c', 100), doc('sale', 'c', 'sale', '2026-08-02', { total: 200, dueTotal: 50, paidTotal: 150, partyBalanceBefore: 900, partyBalanceAfter: 950 }),
    cash('receipt', 'c', 'receive', 30, '2026-08-03', { note: 'Client literal\nDeuxième ligne' }),
    doc('old-cash', 'c', 'payment', '2026-08-04', { total: 10, partyBalanceBefore: 120, partyBalanceAfter: 110, title: 'Old receipt' }),
    doc('settlement', 'c', 'settlement', '2026-08-05', { total: 20, settledReceivable: 20, settledPayable: 0 }),
    doc('offset', 'c', 'offset', '2026-08-06', { total: 999 }),
    doc('return', 'c', 'return', '2026-08-07', { total: 10, parentDocumentId: 'sale' }),
  ]);
  await f.db.collection('financialMovements').insertMany([
    { id: 'receipt-bank', documentId: 'receipt', type: 'party-receipt', direction: 'in', amount: 30, status: 'posted' },
    { id: 'old-bank', documentId: 'old-cash', type: 'party-receipt', direction: 'in', amount: 10, status: 'posted' },
    { id: 'prior-old-bank', documentId: 'old-cash', type: 'party-receipt', direction: 'in', amount: 200, status: 'reversed' },
    { id: 'reverse-old-bank', documentId: 'old-cash', type: 'party-receipt:reversal', direction: 'out', amount: 200, isReversal: true },
    { id: 'invoice-bank', documentId: 'sale', type: 'sale', direction: 'in', amount: 150 },
  ]);
  const report = await f.report({ partyId: 'c' }), byId = new Map(report.rows.map(row => [row.documentId, row]));
  assert.deepEqual([report.summary.tradeTotal, report.summary.receivedTotal, report.summary.paidTotal], [190, 40, 0]);
  assert.deepEqual([report.summary.debitTotal, report.summary.creditTotal, report.summary.closingBalance, report.summary.reconciliationDifference], [150, 70, 80, 0]);
  assert.deepEqual([byId.get('sale').balanceBefore, byId.get('sale').balanceChange, byId.get('sale').balanceAfter], [100, 50, 150],
    'An edit-time snapshot must not replace the chronological current-document replay');
  assert.equal(byId.get('old-cash').balanceChange, -10); assert.equal(byId.get('settlement').balanceChange, -20); assert.equal(byId.get('offset').balanceChange, 0);
  assert.equal(byId.get('receipt').description, 'Client literal\nDeuxième ligne');
});

test('supplier period totals classify old purchase returns using the parent outside the period and keep both debt directions', async t => {
  const f = await fixture(t); await f.party('s1', 'supplier', -45); await f.party('s2', 'supplier', 50, { isArchived: true });
  await f.db.collection('documents').insertMany([
    doc('purchase', 's1', 'purchase', '2026-07-01', { total: 100, dueTotal: 70 }),
    doc('return', 's1', 'return', '2026-08-10', { total: 20, paidTotal: 5, parentDocumentId: 'purchase' }),
    doc('settlement', 's1', 'settlement', '2026-08-12', { total: 10, settledPayable: 10 }),
    opening('supplier-opening', 's2', 50, '2026-07-01'),
  ]);
  const report = await f.report({ partyType: 'supplier', allTime: 'false', from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(sides(report.summary), [-20, 5, 5, 50, 45]);
  assert.deepEqual([report.summary.tradeTotal, report.summary.paidTotal, report.summary.receivedTotal, report.summary.unreconciledAccounts], [-20, 0, 0, 0]);
  const returned = report.rows.find(row => row.documentId === 'return');
  assert.deepEqual([returned.balanceBefore, returned.balanceChange, returned.balanceAfter], [-70, 15, -55]);
});

test('paired imported offsets retain each explicit signed contribution while an old unstructured offset stays net-neutral', async t => {
  const f = await fixture(t); await f.party('customer', 'customer', 60); await f.party('supplier', 'supplier', -60);
  await f.db.collection('documents').insertMany([
    opening('customer-opening', 'customer', 100), opening('supplier-opening', 'supplier', -100),
    doc('offset-customer', 'customer', 'offset', '2026-08-10', { total: 40, partyBalanceDelta: -40, legacyKey: 'offset-customer', mobileOffsetPeerId: 'offset-supplier' }),
    doc('offset-supplier', 'supplier', 'offset', '2026-08-10', { total: 40, partyBalanceDelta: 40, legacyKey: 'offset-supplier', mobileOffsetPeerId: 'offset-customer' }),
    doc('old-net-neutral', 'customer', 'offset', '2026-08-11', { total: 900 }),
  ]);
  const before = await f.snapshot(), customer = await f.report(), supplier = await f.report({ partyType: 'supplier' });
  assert.deepEqual([customer.summary.closingBalance, customer.summary.unreconciledAccounts, supplier.summary.closingBalance, supplier.summary.unreconciledAccounts], [60, 0, -60, 0]);
  assert.deepEqual([customer.rows.find(row => row.documentId === 'offset-customer').balanceChange, supplier.rows.find(row => row.documentId === 'offset-supplier').balanceChange], [-40, 40]);
  assert.equal(customer.rows.find(row => row.documentId === 'old-net-neutral').balanceChange, 0);
  for (const result of [customer, supplier]) assert.deepEqual([result.summary.receivedTotal, result.summary.paidTotal, result.summary.tradeTotal], [0, 0, 0]);
  assert.deepEqual(await f.snapshot(), before);
});

test('opposite legacy reconciliation differences stay visible per account instead of creating or double-applying an opening', async t => {
  const f = await fixture(t);
  await f.party('a', 'customer', 500, { legacyOpeningBalance: { receivable: 500, payable: 0 } });
  await f.party('b', 'customer', -300, { legacyOpeningBalance: { receivable: 0, payable: 300 } });
  await f.db.collection('documents').insertMany([
    doc('sale-a', 'a', 'sale', '2026-08-10', { total: 100, dueTotal: 100 }),
    doc('sale-b', 'b', 'sale', '2026-08-10', { total: 100, dueTotal: 100 }),
  ]);
  const before = await f.snapshot(), report = await f.report();
  assert.equal(report.summary.reconciliationDifference, 0);
  assert.equal(report.summary.unreconciledAccounts, 2);
  assert.deepEqual([report.summary.closingBalance, report.summary.currentBalance, report.summary.closingReceivable, report.summary.closingPayable], [200, 200, 200, 0]);
  assert.deepEqual([report.summary.receivable, report.summary.payable], [500, 300]);
  assert.equal(report.rows.length, 2);
  for (const row of report.rows) assert.deepEqual([row.balanceBefore, row.balanceAfter], [0, 100]);
  assert.equal((await f.report({ partyId: 'a' })).summary.reconciliationDifference, 400);
  assert.equal((await f.report({ partyId: 'b' })).summary.reconciliationDifference, -400);
  assert.deepEqual(await f.snapshot(), before);
});

test('employee opening, withdrawals, deposits and deleted-worker closure preserve each account sign and old history in all mode', async t => {
  const f = await fixture(t);
  await f.db.collection('employees').insertMany([
    { id: 'a', name: 'Worker A', balance: 70 }, { id: 'b', name: 'Worker B', balance: -20, isArchived: true },
    { id: 'deleted', name: 'Historical worker', balance: 0, isArchived: true, isDeleted: true },
    { id: 'empty-deleted', name: 'No history', balance: 0, isArchived: true, isDeleted: true },
  ]);
  const workerDoc = (id, employeeId, kind, day, total, balanceDelta, extra = {}) => ({ ...doc(id, null, kind, day), employeeId,
    businessDate: day, total, balanceDelta, ...extra });
  await f.db.collection('documents').insertMany([
    workerDoc('oa', 'a', 'employee-opening', '2026-08-01', 90, 90, { employeeOpeningDirection: 'payable' }),
    workerDoc('wa', 'a', 'employee-payment', '2026-08-02', 25, -25, { employeePaymentDirection: 'withdraw' }),
    workerDoc('da', 'a', 'employee-payment', '2026-08-03', 5, 5, { employeePaymentDirection: 'deposit' }),
    workerDoc('ob', 'b', 'employee-opening', '2026-08-01', 30, -30, { employeeOpeningDirection: 'receivable' }),
    workerDoc('db', 'b', 'employee-payment', '2026-08-03', 10, 10, { employeePaymentDirection: 'deposit' }),
    workerDoc('od', 'deleted', 'employee-opening', '2026-08-01', 50, 50, { employeeOpeningDirection: 'payable' }),
    workerDoc('wd', 'deleted', 'employee-payment', '2026-08-02', 20, -20, { employeePaymentDirection: 'withdraw' }),
    workerDoc('close', 'deleted', 'employee-closure', '2026-08-04', 30, -30, { salaryReserveReleased: 0 }),
    workerDoc('void', 'a', 'employee-payment', '2026-08-05', 900, -900, { status: 'voided' }),
  ]);
  const before = await f.snapshot(), report = await f.report({ partyType: 'employee' });
  assert.deepEqual([report.summary.partyCount, report.summary.currentBalance, report.summary.closingReceivable, report.summary.closingPayable], [3, -50, 20, 70]);
  assert.deepEqual([report.summary.workersAccrued, report.summary.workersPaid, report.summary.workersDeposited, report.summary.unreconciledAccounts], [0, 45, 15, 0]);
  const a = await f.report({ partyType: 'employee', partyId: 'a' });
  assert.deepEqual(a.rows.map(row => [row.documentId, row.balanceBefore, row.balanceChange, row.balanceAfter]), [['da', -65, -5, -70], ['wa', -90, 25, -65], ['oa', 0, -90, -90]]);
  const period = await f.report({ partyType: 'employee', allTime: 'false', from: '2026-08-02', to: '2026-08-03' });
  assert.deepEqual(sides(period.summary), [-110, -80, -50, 20, 100]);
  const deleted = await f.report({ partyType: 'employee', partyId: 'deleted' });
  assert.equal(deleted.rows[0].movementCode, 'employee-closure'); assert.equal(deleted.summary.currentBalance, 0);
  assert.deepEqual(await f.snapshot(), before);
});

test('global sorting, paging and exports retain immutable per-party chronological balances and full summaries', async t => {
  const f = await fixture(t); await f.party('a', 'customer', 70); await f.party('b', 'customer', -25);
  await f.db.collection('documents').insertMany([
    opening('oa', 'a', 100), opening('ob', 'b', -40), cash('ra', 'a', 'receive', 30), cash('pb', 'b', 'pay', 15),
  ]);
  const before = await f.snapshot(), baseline = await f.report(), byId = new Map(baseline.rows.map(row => [row.documentId, row]));
  for (const sortKey of ['party', 'balanceBefore', 'balanceChange', 'balanceAfter', 'runningBalance']) {
    const pages = [];
    for (let page = 1; page <= 4; page++) {
      const result = await f.report({ sortKey, sortDirection: 'asc', unpaged: 'false', pageSize: '1', page: String(page) });
      assert.deepEqual(result.summary, baseline.summary); assert.equal(result.meta.totalRows, 4);
      assert.deepEqual(result.rows[0], byId.get(result.rows[0].documentId)); pages.push(result.rows[0]);
    }
    const sortedValues = pages.map(row => row[sortKey]);
    assert.deepEqual(sortedValues, [...sortedValues].sort((a, b) => typeof a === 'number' ? a - b : String(a).localeCompare(String(b))));
  }
  const exported = await f.report({ sortKey: 'occurredAt', sortDirection: 'asc', page: '9', pageSize: '1', unpaged: 'true' });
  assert.equal(exported.rows.length, 4); assert.equal(exported.meta.page, 1); assert.deepEqual(exported.summary, baseline.summary);
  assert.deepEqual(await f.snapshot(), before);
});

test('explicit roles disambiguate equal identities and empty role results remain complete without accepting unknown roles', async t => {
  const f = await fixture(t); await f.party('shared', 'customer', 10); await f.party('supplier', 'supplier', -20);
  await f.db.collection('employees').insertOne({ id: 'shared', name: 'Worker', balance: 30 });
  const customer = await f.report({ partyId: 'shared' }), worker = await f.report({ partyType: 'employee', partyId: 'shared' });
  assert.deepEqual([customer.summary.partyType, customer.summary.currentBalance], ['customer', 10]);
  assert.deepEqual([worker.summary.partyType, worker.summary.currentBalance], ['employee', -30]);
  await assert.rejects(f.report({ partyId: 'shared', partyType: 'supplier' }), /نوع الطرف/);
  await assert.rejects(f.report({ partyType: '' }), /يجب اختيار الطرف/);
  await assert.rejects(f.report({ partyType: 'administrator' }), /partyType/);
  await f.db.collection('parties').deleteMany({ partyType: 'supplier' });
  const empty = await f.report({ partyType: 'supplier' });
  assert.deepEqual(empty.rows, []); assert.deepEqual([empty.summary.partyCount, empty.summary.transactionCount, empty.summary.closingReceivable, empty.summary.closingPayable], [0, 0, 0, 0]);
});
