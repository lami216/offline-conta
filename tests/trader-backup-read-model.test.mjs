import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sqliteHarness } from './sqlite-harness.mjs';
import { execute } from '../app/api/command/route.ts';
import { createNativeBackup, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from '../lib/backup.ts';
import { calculatePartyFinancialSummaries } from '../app/party-metrics.ts';
import { canReadDocument } from '../lib/document-read-model.ts';
import { createSession, SESSION_COOKIE } from '../lib/auth.ts';
import { GET as bootstrap } from '../app/api/bootstrap/route.ts';
import { GET as history } from '../app/api/history/route.ts';

async function fixture(t) {
  const previous = new Map(['NODE_ENV', 'ALKARNA_DATABASE_PATH', 'ALKARNA_USER_DATA', 'ALKARNA_DESKTOP', 'ALKARNA_LICENSE_STATE_PATH', 'ALKARNA_LICENSE_DISABLE_REGISTRY', 'ALKARNA_TEST_LICENSE_BYPASS'].map(key => [key, process.env[key]]));
  const h = await sqliteHarness();
  Object.assign(process.env, { NODE_ENV: 'test', ALKARNA_USER_DATA: h.directory, ALKARNA_DESKTOP: '1',
    ALKARNA_LICENSE_STATE_PATH: join(h.directory, 'synthetic-license.json'), ALKARNA_LICENSE_DISABLE_REGISTRY: '1', ALKARNA_TEST_LICENSE_BYPASS: '1' });
  t.after(async () => { await h.close(); for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await h.reset();
  await h.db.collection('warehouses').insertOne({ _id: 'w', name: 'Synthetic warehouse', isSalesDefault: true });
  await h.db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', balance: 10000, openingBalance: 10000, isActive: true });
  const command = body => h.db.transaction(session => execute(h.db, session, body));
  const read = async (handler, path, user) => {
    const response = await handler(new Request('http://localhost' + path, { headers: { Cookie: `${SESSION_COOKIE}=${createSession({ principalType: 'user', userId: user })}` } }));
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const seedTrade = async () => {
    const partyId = await command({ type: 'trader.create', name: 'Synthetic independent trader' });
    await h.db.collection('products').insertOne({ id: 'p', sku: '1', name: 'Synthetic item', piecePrice: 11, pieceCost: 7, stocks: { w: 0 } });
    const purchaseId = await command({ type: 'purchase.post', partyId, warehouseId: 'w', paymentMethod: 'note', lines: [{ productId: 'p', quantity: 5, unitPrice: 7 }] });
    const saleId = await command({ type: 'sale.post', partyId, warehouseId: 'w', paymentMethod: 'note', lines: [{ productId: 'p', quantity: 2, piecePrice: 11 }] });
    const paidId = await command({ type: 'party-cash.post', partyId, direction: 'pay', paymentMethod: 'cash', amount: 5 });
    const receivedId = await command({ type: 'party-cash.post', partyId, direction: 'receive', paymentMethod: 'cash', amount: 3 });
    await h.db.collection('parties').updateOne({ id: partyId }, { $set: { isArchived: true } });
    return { partyId, purchaseId, saleId, paidId, receivedId };
  };
  return { ...h, command, read, seedTrade };
}

test('one archived trader survives native round-trip with both trade sides, historical COGS, cash and one net balance intact', async t => {
  const f = await fixture(t), ids = await f.seedTrade(), first = await createNativeBackup(f.db);
  const trader = first.collections.parties.find(row => row.id === ids.partyId);
  assert.equal(first.collections.parties.length, 1);
  assert.deepEqual([trader.partyType, trader.isArchived, trader.receivable, trader.payable], ['trader', true, 0, 11]);
  assert.equal(first.collections.paymentAccounts[0].balance, 9998);
  assert.equal(first.collections.products[0].stocks.w, 3);
  const summary = calculatePartyFinancialSummaries(first.collections.documents, first.collections.financialMovements)[0];
  assert.deepEqual([summary.partyId, summary.customerTradeTotal, summary.supplierTradeTotal, summary.customerGrossProfit, summary.cashIn, summary.cashOut], [ids.partyId, 22, 35, 8, 3, 5]);
  const parsed = parseAndValidateBackup(stringifyBackup(first));
  await f.db.transaction(session => restoreNativeBackup(f.db, parsed, session));
  const second = await createNativeBackup(f.db);
  for (const key of ['parties', 'products', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'auditEvents']) assert.deepEqual(second.collections[key], first.collections[key], key);
  assert.equal(second.collections.documents.filter(row => row.partyId === ids.partyId).length, 4);
  assert.equal(second.collections.documents.find(row => row.id === ids.saleId).lines[0].costAtSale, 7);
  await f.db.transaction(session => restoreNativeBackup(f.db, parseAndValidateBackup(stringifyBackup(second)), session));
  assert.deepEqual((await createNativeBackup(f.db)).collections.parties, first.collections.parties);
});

test('trader validation rejects malformed new account data atomically while old missing-role backups retain their supplier fallback', async t => {
  const f = await fixture(t); await f.seedTrade(); const before = await createNativeBackup(f.db);
  const mutations = [row => { row.receivable = '0'; }, row => { row.payable = NaN; },
    row => { row.receivable = 2; row.payable = 3; }, row => { row.payable = -1; },
    row => { row.isArchived = 'true'; }, row => { row.id = ''; }, row => { row.name = ''; }];
  for (const mutate of mutations) {
    const bad = structuredClone(before); mutate(bad.collections.parties[0]);
    assert.throws(() => parseAndValidateBackup(JSON.stringify(bad)), /بيانات حساب التاجر/);
    await assert.rejects(f.db.transaction(session => restoreNativeBackup(f.db, bad, session)), /بيانات حساب التاجر/);
    assert.deepEqual((await createNativeBackup(f.db)).collections, before.collections);
  }
  const duplicate = structuredClone(before); duplicate.collections.parties.push({ id: duplicate.collections.parties[0].id, name: 'Synthetic duplicate', partyType: 'customer', receivable: 0, payable: 0 });
  assert.throws(() => parseAndValidateBackup(JSON.stringify(duplicate)), /بيانات حساب التاجر/);
  const old = structuredClone(before); old.collections.parties[0].partyType = undefined;
  for (const key of ['employees', 'productCategories', 'expenseCategories', 'importMappings']) delete old.collections[key];
  const parsed = parseAndValidateBackup(JSON.stringify(old));
  await f.db.transaction(session => restoreNativeBackup(f.db, parsed, session));
  const restored = await createNativeBackup(f.db);
  assert.equal(restored.collections.parties[0].partyType, 'supplier');
  for (const key of ['products', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts']) assert.deepEqual(restored.collections[key], before.collections[key], key);
});

test('mixed trader document reads require both party views while invoice sides retain their existing readers', () => {
  const access = permissions => ({ can: key => permissions.includes(key), customerPartyIds: new Set(), supplierPartyIds: new Set(), traderPartyIds: new Set(['t']) });
  for (const [permission, allowedKind, deniedKind] of [['customers.view', 'sale', 'purchase'], ['suppliers.view', 'purchase', 'sale'], ['pos.view', 'sale', 'purchase'], ['purchases.view', 'purchase', 'sale']]) {
    assert.equal(canReadDocument({ partyId: 't', kind: allowedKind }, access([permission])), true);
    assert.equal(canReadDocument({ partyId: 't', kind: deniedKind }, access([permission])), false);
    for (const kind of ['party-opening', 'payment', 'settlement', 'offset', 'return']) {
      assert.equal(canReadDocument({ partyId: 't', kind }, access([permission, 'records.view'])), false);
      assert.equal(canReadDocument({ partyId: 't', kind }, access(['customers.view', 'suppliers.view'])), true);
    }
  }
});

test('bootstrap and history keep trader identity and archived names but do not leak mixed balances or summaries to one-sided readers', async t => {
  const f = await fixture(t), ids = await f.seedTrade();
  const readers = [['customer-reader', ['customers.view'], [ids.saleId]], ['supplier-reader', ['suppliers.view'], [ids.purchaseId]],
    ['both-readers', ['customers.view', 'suppliers.view'], [ids.saleId, ids.purchaseId, ids.paidId, ids.receivedId]], ['report-reader', ['reports.view'], []]];
  for (const [id, permissions] of readers) await f.db.collection('users').insertOne({ id, username: id, name: 'Synthetic reader', isActive: true, permissions });
  for (const [user, , expectedDocuments] of readers.slice(0, 3)) {
    const boot = await f.read(bootstrap, '/api/bootstrap', user), trader = boot.parties.find(row => row.id === ids.partyId);
    assert.deepEqual([trader.id, trader.partyType, trader.isArchived], [ids.partyId, 'trader', true]);
    assert.deepEqual(boot.documents.map(row => row.id).sort(), [...expectedDocuments].sort());
    const rows = await f.read(history, '/api/history?resource=documents', user);
    assert.deepEqual(rows.rows.map(row => row.id).sort(), [...expectedDocuments].sort());
    if (user === 'both-readers') {
      assert.deepEqual([trader.receivable, trader.payable], [0, 11]);
      const summary = boot.partyFinancialSummaries.find(row => row.partyId === ids.partyId);
      assert.deepEqual([summary.customerTradeTotal, summary.supplierTradeTotal], [22, 35]);
    } else {
      assert.deepEqual([trader.receivable, trader.payable], [0, 0]);
      assert.equal(boot.partyFinancialSummaries.some(row => row.partyId === ids.partyId), false);
    }
    for (const doc of [...boot.documents, ...rows.rows]) assert.equal(doc.partyName, 'Synthetic independent trader');
  }
  const direct = await f.read(history, '/api/history?resource=documents&id=' + ids.paidId, 'report-reader');
  assert.equal(direct.rows[0].id, ids.paidId, 'Existing exact-ID report source lookup remains authorized by reports.view');
});
