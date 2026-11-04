import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteDatabase, ensureDatabaseSchema } from '../lib/sqlite.ts';
import { recoverHistoricalSaleCosts, SALE_COST_RECOVERY_SETTING } from '../lib/sale-cost-recovery.ts';

const originalAt = '2026-07-01T09:00:00.000Z';
const receiptAt = '2026-07-03T10:00:00.000Z';
const receiptCommitAt = '2026-07-03T10:00:00.005Z';
const editAt = '2026-07-04T11:00:00.000Z';
const editCommitAt = '2026-07-04T11:00:00.005Z';
const headerAt = '2026-07-05T11:00:00.000Z';
const saleLine = { id: 'addition', productId: 'target', quantity: 1, unitPrice: 11500, lineTotal: 11500, costAtSale: null, grossProfit: null };

function movement(id, document, productId, type, before, delta, occurredAt = document.occurredAt, documentRevision = 0) {
  return { id, documentId: document.id, documentNumber: document.number, productId, type, warehouseId: 'w',
    balanceBefore: before, quantityDelta: delta, balanceAfter: before + delta, occurredAt, documentRevision };
}

function audit(id, document, action, createdAt) {
  return { id, entityId: document.id, action, status: 'committed', createdAt };
}

async function fixture(t, mode = 'edit', change = () => {}) {
  const db = new SqliteDatabase(new Database(':memory:'));
  t.after(() => db.close());
  ensureDatabaseSchema(db);
  const edited = mode === 'edit';
  const sale = { id: 'invoice', number: 'SAL-TEST', warehouseId: 'w', kind: 'sale', status: 'posted', revision: edited ? 2 : 0,
    occurredAt: edited ? originalAt : editAt, ...(edited ? { updatedAt: headerAt } : {}), paymentMethod: 'cash', total: 11500, paidTotal: 11500, dueTotal: 0,
    lines: [structuredClone(saleLine)] };
  const source = { id: 'stock-source', number: edited ? 'PUR-TEST' : 'ADJ-TEST', warehouseId: 'w', kind: edited ? 'purchase' : 'adjustment',
    status: 'posted', revision: 0, occurredAt: receiptAt, total: 16000,
    lines: [{ id: 'receipt-line', productId: 'target', quantity: 2, unitPrice: 8000, lineTotal: 16000,
      ...(!edited ? { balanceBefore: 0, balanceAfter: 2 } : {}) }] };
  const movements = [
    ...(edited ? [movement('initial-debit', sale, 'original-item', 'sale', 2, -1)] : []),
    movement('stock-receipt', source, 'target', source.kind, 0, 2),
    ...(edited ? [movement('initial-return', sale, 'original-item', 'sale-edit', 1, 1, editAt, 1)] : []),
    movement('line-debit', sale, 'target', edited ? 'sale-edit' : 'sale', 2, -1, editAt, edited ? 1 : 0),
  ];
  const audits = edited ? [audit('sale-post', sale, 'sale.post', originalAt), audit('purchase-post', source, 'purchase.post', receiptCommitAt),
    audit('sale-edit', sale, 'sale.update', editCommitAt), audit('header-edit', sale, 'sale.update', headerAt)] :
    [audit('sale-post', sale, 'sale.post', editCommitAt)];
  const extraDocuments = [];
  change({ sale, source, movements, audits, extraDocuments });
  await db.collection('products').insertOne({ id: 'target', name: 'Synthetic item', pieceCost: 19999, stocks: { w: 1, other: 30 } });
  await db.collection('documents').insertMany(edited ? [sale, source, ...extraDocuments] : [source, sale, ...extraDocuments]);
  await db.collection('stockMovements').insertMany(movements);
  await db.collection('auditEvents').insertMany(audits);
  return db;
}

const read = db => db.collection('documents').findOne({ id: 'invoice' });
const journal = db => db.collection('auditEvents').find({ action: 'sale-cost-recovery.automatic' }).toArray();
const rows = (db, table) => db.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

test('an edited addition is repaired from its proven receipt across dates without changing stock or invoice history', async t => {
  const db = await fixture(t);
  await db.collection('appSettings').insertOne({ _id: SALE_COST_RECOVERY_SETTING, version: 1, fingerprint: 'old-policy', automaticRecovered: 2 });
  const before = await read(db);
  const stock = rows(db, 'stock_movements'), products = rows(db, 'products'), accounts = rows(db, 'payment_accounts');
  assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 3);
  const after = await read(db);
  assert.equal(after.lines[0].costAtSale, 8000);
  assert.equal(after.lines[0].grossProfit, 3500);
  assert.deepEqual({ ...after, lines: before.lines }, before);
  assert.deepEqual(rows(db, 'stock_movements'), stock);
  assert.deepEqual(rows(db, 'products'), products);
  assert.deepEqual(rows(db, 'payment_accounts'), accounts);
  const [entry] = await journal(db);
  assert.deepEqual(entry.beforeDocument, before);
  assert.deepEqual(entry.afterDocument, after);
  assert.deepEqual(entry.source.proof, { basis: 'edit-introduction', debitMovementId: 'line-debit', debitAt: editAt,
    saleRevision: 1, saleAuditId: 'sale-edit', receiptMovementId: 'stock-receipt', purchaseAuditId: 'purchase-post' });
  const settings = rows(db, 'app_settings');
  assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 3);
  assert.deepEqual(rows(db, 'app_settings'), settings);
  assert.equal((await journal(db)).length, 1);
});

test('a missing native sale cost can use its proven single stock adjustment source', async t => {
  const db = await fixture(t, 'adjustment');
  assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 1);
  assert.equal((await read(db)).lines[0].costAtSale, 8000);
  const [entry] = await journal(db);
  assert.equal(entry.source.proof.basis, 'stock-adjustment');
  assert.equal(entry.source.proof.debitBasis, 'original-debit');
  assert.equal(entry.source.proof.receiptMovementId, 'stock-receipt');
  assert.equal(entry.source.kind, 'adjustment');
});

test('a canceled purchase does not hide the sole counted stock funding a later sale', async t => {
  const db = await fixture(t, 'adjustment', ({ source, movements, extraDocuments }) => {
    const purchase = { id: 'canceled-purchase', number: 'PUR-VOIDED', kind: 'purchase', status: 'voided',
      warehouseId: 'w', occurredAt: originalAt, revision: 1, total: 12000,
      lines: [{ id: 'canceled-line', productId: 'target', quantity: 2, unitPrice: 6000, lineTotal: 12000 }] };
    extraDocuments.push(purchase);
    Object.assign(source.lines[0], { balanceBefore: 2, balanceAfter: 4 });
    Object.assign(movements[0], { balanceBefore: 2, balanceAfter: 4 });
    movements.unshift(movement('purchase-receipt', purchase, 'target', 'purchase', 0, 2));
    movements.splice(2, 0, movement('purchase-reversal', purchase, 'target', 'purchase-void', 4, -2, '2026-07-03T11:00:00.000Z', 1));
  });
  const stock = rows(db, 'stock_movements');
  assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 1);
  assert.equal((await read(db)).lines[0].costAtSale, 8000);
  assert.deepEqual(rows(db, 'stock_movements'), stock);
  const [entry] = await journal(db);
  assert.equal(entry.source.documentId, 'stock-source');
  assert.equal(entry.source.proof.basis, 'stock-adjustment');
});

test('missing receipts, intervening stock, uncertain chronology and older cost conflicts remain untouched', async t => {
  const variants = {
    'missing edit audit': ({ audits }) => audits.splice(2, 1),
    'wrong edit revision': ({ movements }) => { movements.at(-1).documentRevision = 2; },
    'unknown intervening movement': ({ source, movements }) => {
      movements.splice(2, 0, movement('unproven', source, 'target', 'stock-count', 2, 0, editAt));
    },
    'changed purchase': ({ source }) => { source.revision = 1; },
    'imported purchase': ({ source }) => { source.legacyKey = 'imported'; },
    'late receipt commit': ({ audits }) => { audits[1].createdAt = editCommitAt; },
    'competing purchase': ({ source, extraDocuments }) => extraDocuments.push({ ...source, id: 'another-source', number: 'PUR-OTHER',
      occurredAt: originalAt, lines: [{ ...source.lines[0], id: 'other-receipt', unitPrice: 7500, lineTotal: 15000 }], total: 15000 }),
    'zero snapshot': ({ sale }) => { sale.lines[0].costAtSale = 0; },
    'positive snapshot': ({ sale }) => { sale.lines[0].costAtSale = 100; },
    'voided invoice': ({ sale }) => { sale.status = 'voided'; },
  };
  for (const [name, change] of Object.entries(variants)) await t.test(name, async subtest => {
    const db = await fixture(subtest, 'edit', change);
    const before = await read(db);
    assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 0);
    assert.deepEqual(await read(db), before);
    assert.equal((await journal(db)).length, 0);
  });
});

test('an explicitly edited addition cannot fall back to unrelated original-date pricing when its own proof is absent', async t => {
  const db = await fixture(t, 'edit', ({ source, movements, audits }) => {
    source.occurredAt = '2026-07-01T08:00:00.000Z';
    movements[1].occurredAt = source.occurredAt;
    audits.splice(1, 2);
  });
  // Put the purchase earlier in document storage as well, where the old proof would have accepted it.
  const sale = await read(db);
  await db.collection('documents').deleteOne({ id: sale.id });
  await db.collection('documents').insertOne(sale);
  assert.equal(recoverHistoricalSaleCosts(db).automaticRecovered, 0);
  assert.deepEqual(await read(db), sale);
  assert.equal((await journal(db)).length, 0);
});
