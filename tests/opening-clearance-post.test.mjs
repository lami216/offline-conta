import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// The release workflow runs only these two counterfactual proofs against the
// exact old runtime, then restores the fixed source before the ordinary suite.
const legacyDefect = process.env.CLEARANCE_EXPECT_LEGACY_DEFECT === '1';
const origin = 'http://127.0.0.1:3267';
const environment = new Map();
let directory, sqlite, db, POST, auth, backup, deriveOpeningStockState, restorePOST, previewPOST, ownerPasswordHash;

const headers = () => ({ Origin: origin, Host: '127.0.0.1:3267', 'Content-Type': 'application/json', Cookie: `conta_session=${auth.createSession({ principalType: 'owner' })}` });
const post = async (body, key = randomUUID()) => {
  const response = await POST(new Request(origin + '/api/command', { method: 'POST', headers: { ...headers(), 'Idempotency-Key': key }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};
const ok = async (body, key) => { const result = await post(body, key); assert.equal(result.status, 200, JSON.stringify(result)); return result.body.id; };
const product = id => db.collection('products').findOne({ id });
const document = id => db.collection('documents').findOne({ id });
const cash = async () => (await db.collection('paymentAccounts').findOne({ id: 'cash' })).balance;
const party = async () => (await db.collection('parties').findOne({ id: 'customer' })).net;
const state = () => Promise.all(['products', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'parties', 'auditEvents', 'commandReceipts', 'counters'].map(name => db.collection(name).find().toArray()));
const clearances = productId => db.collection('documents').find({ productArchiveStockClearance: true, 'lines.productId': productId }).toArray();
const opening = productId => db.collection('documents').findOne({ title: 'رصيد بداية', 'lines.productId': productId });
const create = (quantity = 10) => ok({ type: 'product.create', name: 'Synthetic opening product', pieceCost: 50, piecePrice: 100, openingStock: quantity, openingWarehouseId: 'a' });
const sale = (productId, quantity = 4, warehouseId = 'a', paymentMethod = 'note') => ok({ type: 'sale.post', warehouseId, partyId: 'customer', paymentMethod, lines: [{ productId, quantity, piecePrice: 100 }] });
const archive = productId => ok({ type: 'product.delete', id: productId, zeroStock: true });
const restore = productId => ok({ type: 'product.restore', id: productId });
const assertOpening = async (productId, remaining, consumed) => {
  const saved = await product(productId), derived = await deriveOpeningStockState(db, undefined, saved);
  assert.equal(derived.remaining, remaining); assert.equal(derived.consumed, consumed);
  for (const [warehouseId, quantity] of Object.entries(derived.allocations)) assert(quantity <= Number(saved.stocks[warehouseId] ?? 0), 'Opening allocation cannot exceed actual warehouse stock');
};
const assertNoFinance = async () => { assert.equal(await cash(), 10000); assert.equal(await party(), 0); };

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'alkarna-opening-clearance-post-'));
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', ALKARNA_DESKTOP: '1', ALKARNA_USER_DATA: join(directory, 'profile'), ALKARNA_DATABASE_PATH: join(directory, 'database.sqlite'), ALKARNA_LICENSE_STATE_PATH: join(directory, 'license-state.json'), ALKARNA_LICENSE_DISABLE_REGISTRY: '1', ALKARNA_TEST_LICENSE_BYPASS: '1' })) {
    environment.set(key, process.env[key]); process.env[key] = value;
  }
  sqlite = await import('../lib/sqlite.ts'); sqlite.closeDatabase(); db = sqlite.initializeDatabase();
  ({ POST } = await import('../app/api/command/route.ts')); auth = await import('../lib/auth.ts'); backup = await import('../lib/backup.ts');
  ownerPasswordHash = await auth.hashPassword('Synthetic clearance fixture password only');
  ({ deriveOpeningStockState } = await import('../lib/opening-stock.ts'));
  ({ POST: restorePOST } = await import('../app/api/settings/restore/route.ts')); ({ POST: previewPOST } = await import('../app/api/settings/restore/preview/route.ts'));
});
after(async () => {
  sqlite?.closeDatabase();
  for (const [key, value] of environment) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory) {
    const target = resolve(directory), parent = resolve(tmpdir()) + sep;
    assert(isAbsolute(target) && target.startsWith(parent) && target.split(sep).at(-1).startsWith('alkarna-opening-clearance-post-'));
    await rm(target, { recursive: true, force: true });
  }
});
beforeEach(async () => {
  await db.dropDatabase();
  await db.collection('warehouses').insertMany([{ _id: 'a', name: 'Synthetic A', isSalesDefault: true }, { _id: 'b', name: 'Synthetic B', isSalesDefault: false }]);
  await db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', isActive: true, balance: 10000, openingBalance: 10000 });
  await db.collection('parties').insertOne({ id: 'customer', name: 'Synthetic customer', partyType: 'customer', receivable: 0, payable: 0, net: 0 });
  await db.collection('users').insertOne({ id: 'owner', username: 'owner', usernameNormalized: 'owner', name: 'Synthetic owner', isActive: true, owner: true, permissions: [], passwordHash: ownerPasswordHash });
});

const archivedAfterSale = async () => {
  const id = await create(), saleId = await sale(id), savedSale = await document(saleId);
  await archive(id); const [clearance] = await clearances(id);
  return { id, saleId, savedSale, clearance };
};
const twoGroups = async () => {
  const fixture = await archivedAfterSale();
  await ok({ type: 'sale.void', documentId: fixture.saleId });
  await ok({ type: 'product.stock-zero', id: fixture.id });
  const documents = await clearances(fixture.id), second = documents.find(item => item.id !== fixture.clearance.id);
  assert(second); assert.notEqual(second.productArchiveStockClearanceGroupId, fixture.clearance.productArchiveStockClearanceGroupId);
  return { ...fixture, second };
};

if (legacyDefect) {
  test('counterfactual old runtime: restoring clearance after a sale return rejects409 and leaves the entire state unchanged', async () => {
    const f = await archivedAfterSale(); await ok({ type: 'sale.void', documentId: f.saleId });
    assert.equal((await product(f.id)).stocks.a, 4); assert.equal((await product(f.id)).isArchived, true);
    const beforeState = await state(), response = await post({ type: 'product.restore', id: f.id });
    assert.equal(response.status, 409); assert.match(response.body.error, /مخزون|التصفير/); assert.deepEqual(await state(), beforeState);
    await assertNoFinance(); assert.equal((await document(f.clearance.id)).status, 'posted');
  });
  test('counterfactual old runtime: zeroing an already empty archived product replaces its group pointer and breaks restore', async () => {
    const id = await create(); await archive(id); const original = await product(id), [clearance] = await clearances(id);
    assert.equal(original.stocks.a, 0); await ok({ type: 'product.stock-zero', id });
    assert.notEqual((await product(id)).archiveStockClearanceGroupId, original.archiveStockClearanceGroupId);
    assert.equal((await clearances(id)).length, 1);
    const beforeState = await state(), response = await post({ type: 'product.restore', id });
    assert.equal(response.status, 409); assert.deepEqual(await state(), beforeState); assert.equal((await document(clearance.id)).status, 'posted');
  });
} else {
  test('actual POST returns opening10 after sale4/archive6/salevoid, preserves saved costs and then allows opening deletion', async () => {
    const unauthorizedState = await state(), unauthorized = await POST(new Request(origin + '/api/command', { method: 'POST', headers: { Origin: origin, Host: '127.0.0.1:3267', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ type: 'product.create', name: 'Synthetic denied product', piecePrice: 100 }) }));
    assert.equal(unauthorized.status, 401); assert.deepEqual(await state(), unauthorizedState);
    const f = await archivedAfterSale(); assert.equal(await party(), 400); assert.equal((await product(f.id)).stocks.a, 0);
    await ok({ type: 'sale.void', documentId: f.saleId }); await assertNoFinance();
    await restore(f.id); const restored = await product(f.id);
    assert.equal(restored.isArchived, false); assert.equal(restored.stocks.a, 10); assert.equal(restored.openingCost, 50); assert.equal(restored.lastPurchaseCost, 50);
    assert.deepEqual((await document(f.saleId)).lines, f.savedSale.lines); assert.equal((await document(f.clearance.id)).status, 'voided');
    await assertOpening(f.id, 10, 0);
    await ok({ type: 'opening-stock-initial.void', documentId: (await opening(f.id)).id });
    assert.equal((await product(f.id)).stocks.a, 0); assert.equal((await product(f.id)).openingStock, 0); assert.equal((await product(f.id)).openingCost, null); await assertNoFinance();
  });

  test('zero-on-zero is a true product/clearance no-op and keeps the original restore path, including idempotent retry', async () => {
    const id = await create(); await archive(id); const original = await product(id), docs = await clearances(id), moves = await db.collection('stockMovements').find({ productId: id }).toArray();
    const key = randomUUID(), body = { type: 'product.stock-zero', id }, posted = await post(body, key); assert.equal(posted.status, 200, JSON.stringify(posted));
    assert.deepEqual(await product(id), original); assert.deepEqual(await clearances(id), docs); assert.deepEqual(await db.collection('stockMovements').find({ productId: id }).toArray(), moves);
    const stable = await state(); assert.deepEqual(await post(body, key), posted); assert.deepEqual(await state(), stable);
    await restore(id); assert.equal((await product(id)).stocks.a, 10); await assertOpening(id, 10, 0); await assertNoFinance();
  });

  test('whole-product restore reverses all pending re-zero groups exactly once; a repeated receipt does not add stock or cash', async () => {
    const f = await twoGroups(), body = { type: 'product.restore', id: f.id }, key = randomUUID();
    await db.collection('products').updateOne({ id: f.id }, { $set: { archiveStockClearanceGroupId: 'synthetic-stale-group' } });
    const result = await post(body, key); assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal((await product(f.id)).stocks.a, 10); assert.equal((await product(f.id)).isArchived, false); assert.equal((await product(f.id)).archiveStockClearanceGroupId, null);
    assert.deepEqual((await clearances(f.id)).map(item => item.status), ['voided', 'voided']);
    await assertOpening(f.id, 10, 0); await assertNoFinance(); const stable = await state();
    assert.deepEqual(await post(body, key), result); assert.deepEqual(await state(), stable);
    assert.equal((await post({ type: 'adjustment.void', documentId: f.clearance.id })).status, 404); assert.deepEqual(await state(), stable);
    await ok({ type: 'opening-stock-initial.void', documentId: (await opening(f.id)).id }); assert.equal((await product(f.id)).stocks.a, 0);
  });

  for (const order of ['oldest-first', 'newest-first']) test(`explicit group void supports ${order} without stranding the other group`, async () => {
    const f = await twoGroups(), [first, second] = order === 'oldest-first' ? [f.clearance, f.second] : [f.second, f.clearance];
    await ok({ type: 'adjustment.void', documentId: first.id });
    assert.equal((await product(f.id)).stocks.a, -first.lines[0].quantity); assert.equal((await product(f.id)).isArchived, true);
    assert.equal((await product(f.id)).archiveStockClearanceGroupId, second.productArchiveStockClearanceGroupId); assert.equal((await document(second.id)).status, 'posted');
    await ok({ type: 'adjustment.void', documentId: second.id });
    assert.equal((await product(f.id)).stocks.a, 10); assert.equal((await product(f.id)).isArchived, false); await assertOpening(f.id, 10, 0); await assertNoFinance();
  });

  test('two-warehouse restore adds only cleared quantities beside subsequent sale reversals and preserves cash/debt/source costs', async () => {
    const id = await create(); await ok({ type: 'transfer.post', fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ productId: id, quantity: 4 }] });
    const cashSale = await sale(id, 2, 'a', 'cash'), noteSale = await sale(id, 1, 'b', 'note'), sold = [await document(cashSale), await document(noteSale)];
    assert.equal(await cash(), 10200); assert.equal(await party(), 100); await archive(id);
    assert.deepEqual((await product(id)).stocks, { a: 0, b: 0 }); assert.equal((await clearances(id)).length, 2);
    await ok({ type: 'sale.void', documentId: cashSale }); await ok({ type: 'sale.void', documentId: noteSale });
    assert.deepEqual((await product(id)).stocks, { a: 2, b: 1 }); await restore(id);
    assert.deepEqual((await product(id)).stocks, { a: 6, b: 4 }); await assertOpening(id, 10, 0); await assertNoFinance();
    assert.deepEqual((await document(cashSale)).lines, sold[0].lines); assert.deepEqual((await document(noteSale)).lines, sold[1].lines);
    await ok({ type: 'opening-stock-initial.void', documentId: (await opening(id)).id }); assert.deepEqual((await product(id)).stocks, { a: 0, b: 0 });
  });

  const restoreFile = async file => {
    const text = backup.stringifyBackup(file), preview = await previewPOST(new Request(origin + '/api/settings/restore/preview', { method: 'POST', headers: headers(), body: text }));
    assert.equal(preview.status, 200, JSON.stringify(await preview.json()));
    const restored = await restorePOST(new Request(origin + '/api/settings/restore', { method: 'POST', headers: headers(), body: text }));
    const result = await restored.json(); assert.equal(restored.status, 200, JSON.stringify(result)); assert.equal(result.restored, true); assert.equal(result.sessionReset, true); assert.match(restored.headers.get('set-cookie'), /Max-Age=0/);
  };

  test('old schema1 backup with an active product and a stranded posted clearance restores without rewriting history and can reverse that source', async () => {
    const f = await twoGroups(), file = await backup.createNativeBackup(db), p = file.collections.products.find(row => row.id === f.id), cleared = file.collections.documents.find(row => row.id === f.second.id);
    // Reproduce the persisted output of the previous release's partial restore,
    // rather than asking the corrected command to create broken historical data.
    Object.assign(p, { stocks: { a: 4 }, isArchived: false, archivedAt: null, archiveStockClearanceGroupId: null });
    Object.assign(cleared, { status: 'voided', revision: 1, productArchiveStockClearanceRestored: true, voidedAt: new Date().toISOString() });
    file.collections.stockMovements.push({ id: 'synthetic-old-partial-restore', documentId: cleared.id, documentNumber: cleared.number, documentRevision: 1, productId: f.id, productName: p.name, warehouseId: 'a', warehouseName: 'Synthetic A', type: 'adjustment-void', quantityDelta: 4, balanceBefore: 0, balanceAfter: 4, occurredAt: new Date().toISOString() });
    file.counts.stockMovements = file.collections.stockMovements.length; file.appVersion = '0.1.17'; delete file.build; delete file.collections.employees; delete file.counts.employees;
    const raw = backup.stringifyBackup(file); await restoreFile(file);
    assert.equal((await product(f.id)).isArchived, false); assert.equal((await product(f.id)).stocks.a, 4); assert.equal((await document(f.clearance.id)).status, 'posted');
    assert.deepEqual((await document(f.saleId)).lines, f.savedSale.lines); await assertNoFinance();
    const beforeCash = await db.collection('financialMovements').find().toArray(); await ok({ type: 'adjustment.void', documentId: f.clearance.id });
    assert.equal((await product(f.id)).stocks.a, 10); assert.equal((await product(f.id)).isArchived, false); await assertOpening(f.id, 10, 0);
    assert.deepEqual(await db.collection('financialMovements').find().toArray(), beforeCash); assert.equal(backup.stringifyBackup(file), raw, 'Restoring must not mutate the supplied backup object');
    const repaired = await backup.createNativeBackup(db); await restoreFile(repaired); assert.equal((await product(f.id)).stocks.a, 10); assert.equal((await clearances(f.id)).filter(row => row.status === 'posted').length, 0);
  });

  test('old ungrouped multi-warehouse clearance remains reversible when its historical stock movement was not retained', async () => {
    const id = await create(); await ok({ type: 'transfer.post', fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ productId: id, quantity: 6 }] }); await archive(id);
    const file = await backup.createNativeBackup(db), docs = file.collections.documents.filter(row => row.productArchiveStockClearance), ids = new Set(docs.map(row => row.id));
    for (const row of docs) { delete row.productArchiveStockClearanceGroupId; row.occurredAt = '2026-11-01T10:00:00.000Z'; }
    delete file.collections.products.find(row => row.id === id).archiveStockClearanceGroupId;
    file.collections.stockMovements = file.collections.stockMovements.filter(row => !ids.has(row.documentId)); file.counts.stockMovements = file.collections.stockMovements.length; file.appVersion = '0.1.10'; delete file.build;
    await restoreFile(file); const cashRows = await db.collection('financialMovements').find().toArray(); await ok({ type: 'adjustment.void', documentId: docs[0].id });
    assert.deepEqual((await product(id)).stocks, { a: 4, b: 6 }); assert.equal((await product(id)).isArchived, false); assert.equal((await clearances(id)).filter(row => row.status === 'posted').length, 0);
    assert.deepEqual(await db.collection('financialMovements').find().toArray(), cashRows); await assertNoFinance();
  });

  test('malformed second clearance rejects before changes, releases its receipt, and permits a repaired same-key retry', async () => {
    const id = await create(); await ok({ type: 'transfer.post', fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ productId: id, quantity: 6 }] }); await archive(id);
    const invalid = (await clearances(id)).find(row => row.warehouseId === 'b'), originalLines = structuredClone(invalid.lines);
    await db.collection('documents').updateOne({ id: invalid.id }, { $set: { lines: [{ ...invalid.lines[0], balanceBefore: 7 }] } });
    const key = randomUUID(), body = { type: 'product.restore', id }, beforeState = await state(), rejected = await post(body, key);
    assert.equal(rejected.status, 409, JSON.stringify(rejected)); assert.deepEqual(await state(), beforeState); assert.equal(await db.collection('commandReceipts').findOne({ _id: key }), null);
    await db.collection('documents').updateOne({ id: invalid.id }, { $set: { lines: originalLines } }); await ok(body, key);
    assert.deepEqual((await product(id)).stocks, { a: 4, b: 6 }); await assertNoFinance();
  });

  test('a late second-warehouse write failure rolls back stock, documents, audits and receipt; identical retry restores once', async () => {
    const id = await create(); await ok({ type: 'transfer.post', fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ productId: id, quantity: 6 }] }); await archive(id);
    const key = randomUUID(), body = { type: 'product.restore', id }, beforeState = await state();
    db.native.exec("CREATE TRIGGER synthetic_clearance_late_failure BEFORE INSERT ON stock_movements WHEN json_extract(NEW.data_json,'$.type')='adjustment-void' AND json_extract(NEW.data_json,'$.warehouseId')='b' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CLEARANCE_LATE_FAILURE'); END");
    try { const rejected = await post(body, key); assert.equal(rejected.status, 500); assert.deepEqual(await state(), beforeState); assert.equal(await db.collection('commandReceipts').findOne({ _id: key }), null); }
    finally { db.native.exec('DROP TRIGGER synthetic_clearance_late_failure'); }
    const accepted = await post(body, key); assert.equal(accepted.status, 200, JSON.stringify(accepted)); assert.deepEqual((await product(id)).stocks, { a: 4, b: 6 });
    const stable = await state(); assert.deepEqual(await post(body, key), accepted); assert.deepEqual(await state(), stable); await assertNoFinance();
  });

  test('a posted source with an already recorded reversal cannot restore twice even when historical status is stale', async () => {
    const id = await create(); await archive(id); const [clearance] = await clearances(id);
    await db.collection('stockMovements').insertOne({ id: 'synthetic-prior-reversal', documentId: clearance.id, documentNumber: clearance.number, documentRevision: 1, productId: id, warehouseId: 'a', warehouseName: 'Synthetic A', type: 'adjustment-void', quantityDelta: 10, balanceBefore: 0, balanceAfter: 10, occurredAt: new Date().toISOString() });
    await db.collection('products').updateOne({ id }, { $set: { stocks: { a: 10 } } });
    const beforeState = await state(), rejected = await post({ type: 'product.restore', id }); assert.equal(rejected.status, 409, JSON.stringify(rejected)); assert.deepEqual(await state(), beforeState); await assertNoFinance();
  });

  test('real consumed opening remains protected after clearance reversal and after an unrelated replacement purchase', async () => {
    const f = await archivedAfterSale(); await restore(f.id); assert.equal((await product(f.id)).stocks.a, 6); await assertOpening(f.id, 6, 4);
    const openingId = (await opening(f.id)).id, request = { type: 'opening-stock-initial.void', documentId: openingId }, first = await post(request);
    assert.equal(first.status, 409); assert.equal(first.body.code, 'OPENING_STOCK_BLOCKED'); assert.equal(first.body.consumedOpening, 4); assert(first.body.blockers.some(row => row.documentId === f.saleId));
    await ok({ type: 'purchase.post', warehouseId: 'a', paymentMethod: 'cash', lines: [{ productId: f.id, quantity: 4, unitPrice: 50 }] });
    assert.equal((await product(f.id)).stocks.a, 10); const stable = await state(), second = await post(request);
    assert.equal(second.status, 409); assert.equal(second.body.code, 'OPENING_STOCK_BLOCKED'); assert.deepEqual(await state(), stable); assert.deepEqual((await document(f.saleId)).lines, f.savedSale.lines);
  });
}
