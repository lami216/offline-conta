import assert from 'node:assert/strict';
import test, { before, beforeEach, after } from 'node:test';
import { sqliteHarness } from './sqlite-harness.mjs';
import { execute, POST } from '../app/api/command/route.ts';
import { createSession } from '../lib/auth.ts';
import { documentKindLabel, resolvePartyType, supportsPartyRole } from '../app/domain.ts';
import { partyCapabilities } from '../app/party-access.ts';

let harness, db, previousUserData;
before(async () => {
  harness = await sqliteHarness(); db = harness.db;
  previousUserData = process.env.ALKARNA_USER_DATA;
  process.env.ALKARNA_USER_DATA = harness.directory;
});
beforeEach(async () => {
  await harness.reset();
  await db.collection('paymentAccounts').insertOne({ id: 'cash', code: 'cash', name: 'Synthetic cash', isActive: true, balance: 1000 });
  await db.collection('warehouses').insertOne({ _id: 'w', name: 'Synthetic warehouse', isSalesDefault: true });
  await db.collection('products').insertOne({ id: 'p', name: 'Synthetic product', sku: 'SYN-P', stocks: { w: 0 }, pieceCost: 10 });
});
after(async () => {
  await harness.close();
  if (previousUserData === undefined) delete process.env.ALKARNA_USER_DATA;
  else process.env.ALKARNA_USER_DATA = previousUserData;
});
const command = body => db.transaction(session => execute(db, session, body));
const trader = extra => command({ type: 'trader.create', name: 'Synthetic shared trader', phone: 'SYN-100', ...extra });
const party = id => db.collection('parties').findOne({ id });
const balance = async id => { const row = await party(id); return row.receivable - row.payable; };
const cashBalance = async () => (await db.collection('paymentAccounts').findOne({ id: 'cash' })).balance;
const stock = async () => (await db.collection('products').findOne({ id: 'p' })).stocks.w;
const purchase = (partyId, extra = {}) => ({ type: 'purchase.post', partyId, warehouseId: 'w', paymentMethod: 'note', lines: [{ productId: 'p', quantity: 5, unitPrice: 10 }], ...extra });
const sale = (partyId, extra = {}) => ({ type: 'sale.post', partyId, warehouseId: 'w', paymentMethod: 'note', lines: [{ productId: 'p', quantity: 2, piecePrice: 30 }], ...extra });
const snapshot = () => Promise.all(['parties', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'products', 'auditEvents', 'commandReceipts', 'counters']
  .map(name => db.collection(name).find().toArray()));
async function user(id, permissions) {
  await db.collection('users').insertOne({ id, name: `Synthetic ${id}`, username: id, isActive: true, permissions });
}
async function post(body, userId, key) {
  const headers = { Host: 'localhost', Origin: 'http://localhost', 'Content-Type': 'application/json', 'Idempotency-Key': key };
  if (userId) headers.Cookie = `conta_session=${createSession({ principalType: 'user', userId })}`;
  return POST(new Request('http://localhost/api/command', { method: 'POST', headers, body: JSON.stringify(body) }));
}
async function denied(body, userIds, label) {
  const before = await snapshot();
  for (const userId of userIds) {
    const response = await post(body, userId, `${label}-${userId}`);
    assert.equal(response.status, 403, `${label}/${userId}`);
    assert.deepEqual(await snapshot(), before, `${label}: forbidden requests cannot write receipts, balances or audits`);
  }
}

test('trader roles support both invoice slots and shared access always requires the paired capabilities', () => {
  assert.equal(resolvePartyType({ partyType: 'trader' }), 'trader');
  assert.equal(resolvePartyType({}), 'supplier');
  for (const role of ['customer', 'supplier']) assert.equal(supportsPartyRole({ partyType: 'trader' }, role), true);
  assert.equal(supportsPartyRole({ partyType: 'customer' }, 'supplier'), false);
  assert.equal(supportsPartyRole({ partyType: 'supplier' }, 'customer'), false);
  assert.equal(documentKindLabel({ kind: 'payment', partyCashDirection: 'receive' }, 'trader'), 'استلام من التاجر');
  assert.equal(documentKindLabel({ kind: 'payment', partyCashDirection: 'pay' }, 'trader'), 'دفع للتاجر');
  for (const action of ['view', 'create', 'edit', 'delete', 'restore', 'cash-post', 'cash-edit', 'cash-delete']) {
    const paired = partyCapabilities('trader', action);
    assert.deepEqual(paired, [...partyCapabilities('customer', action), ...partyCapabilities('supplier', action)]);
    assert.equal(paired.length, 2);
    paired.pop(); assert.equal(partyCapabilities('trader', action).length, 2);
  }
  assert.deepEqual(partyCapabilities('trader', 'opening'), ['party.opening.manage', 'customers.edit', 'suppliers.edit']);
  assert.deepEqual(partyCapabilities('customer', 'opening'), ['party.opening.manage']);
});

test('dedicated trader creation keeps one canonical zero account and strictly rejects role spoofing or invalid nested openings', async () => {
  const id = await trader(), row = await party(id);
  assert.deepEqual([row.partyType, row.receivable, row.payable, row.net], ['trader', 0, 0, 0]);
  assert.equal(await db.collection('parties').countDocuments(), 1);
  for (const role of ['trader', 'administrator', '', null, false, undefined]) {
    const before = await snapshot();
    await assert.rejects(command({ type: 'party.create', name: 'Must reject', partyType: role }), /نوع الحساب غير صالح/);
    assert.deepEqual(await snapshot(), before);
  }
  for (const role of ['customer', 'supplier', null, false]) {
    const before = await snapshot();
    await assert.rejects(trader({ phone: '', partyType: role }), /نوع الحساب غير صالح/);
    assert.deepEqual(await snapshot(), before);
  }
  let before = await snapshot();
  await assert.rejects(trader({ phone: '', opening: { direction: 'payable', amount: 0 } }), /موجب/);
  assert.deepEqual(await snapshot(), before, 'The party insert rolls back with a failed opening');
  await assert.rejects(trader(), /رقم الهاتف مستخدم/);
  const customer = await command({ type: 'party.create', partyType: 'customer', name: 'Independent ordinary customer', phone: 'SYN-100' });
  assert.equal((await party(customer)).partyType, 'customer', 'Existing distinct-role duplicate-phone policy is unchanged');
  before = await snapshot();
  await command({ type: 'party.update', id, name: 'Renamed shared trader', phone: 'SYN-101', partyType: 'customer' });
  assert.equal((await party(id)).partyType, 'trader', 'Generic identity edit never converts the stored role');
  assert.equal((await snapshot())[1].length, before[1].length);
});

test('purchase, sale, cash, edits and every inverse share the same trader net without recosting an old sale', async () => {
  const id = await trader({ opening: { direction: 'receivable', amount: 100, note: 'Synthetic old debt' } });
  const opening = await db.collection('documents').findOne({ partyId: id, kind: 'party-opening' });
  const buyId = await command(purchase(id)); assert.deepEqual([await balance(id), await stock()], [50, 5]);
  const saleId = await command(sale(id)); assert.deepEqual([await balance(id), await stock()], [110, 3]);
  assert.equal((await db.collection('documents').findOne({ id: saleId })).lines[0].costAtSale, 10);
  const receive = await command({ type: 'party-cash.post', partyId: id, direction: 'receive', amount: 40, paymentMethod: 'cash' });
  const pay = await command({ type: 'party-cash.post', partyId: id, direction: 'pay', amount: 15, paymentMethod: 'cash' });
  assert.deepEqual([await balance(id), await cashBalance()], [85, 1025]);
  await command({ ...sale(id, { lines: [{ productId: 'p', quantity: 3, piecePrice: 30 }] }), type: 'sale.update', documentId: saleId });
  assert.deepEqual([await balance(id), await stock()], [115, 2]);
  await command({ ...purchase(id, { lines: [{ productId: 'p', quantity: 5, unitPrice: 12 }] }), type: 'purchase.update', documentId: buyId });
  assert.deepEqual([await balance(id), await stock()], [105, 2]);
  const savedSale = await db.collection('documents').findOne({ id: saleId });
  assert.deepEqual([savedSale.partyId, savedSale.lines[0].costAtSale, savedSale.lines[0].grossProfit], [id, 10, 60]);
  await command({ type: 'sale.void', documentId: saleId }); assert.deepEqual([await balance(id), await stock()], [15, 5]);
  await command({ type: 'purchase.void', documentId: buyId }); assert.deepEqual([await balance(id), await stock()], [75, 0]);
  await command({ type: 'party-cash.void', documentId: receive });
  await command({ type: 'party-cash.void', documentId: pay });
  assert.deepEqual([await balance(id), await cashBalance()], [100, 1000]);
  await command({ type: 'party-opening.update', documentId: opening.id, expectedRevision: 0, direction: 'receivable', amount: 80, reason: 'Synthetic correction' });
  assert.equal(await balance(id), 80);
  await command({ type: 'party-opening.void', documentId: opening.id, expectedRevision: 1, reason: 'Synthetic cancellation' });
  assert.deepEqual([await balance(id), await cashBalance(), await stock()], [0, 1000, 0]);
  assert.equal(await db.collection('parties').countDocuments(), 1);
  assert.equal((await db.collection('documents').find({ partyId: id }).toArray()).every(document => document.partyId === id), true);
});

test('ordinary role and archived-party guards stay intact while same-source history can still edit and void', async () => {
  const customer = await command({ type: 'party.create', partyType: 'customer', name: 'Customer' });
  const supplier = await command({ type: 'party.create', partyType: 'supplier', name: 'Supplier' });
  let before = await snapshot();
  await assert.rejects(command(purchase(customer, { partyType: 'trader' })), /مورد صالح/);
  await assert.rejects(command(sale(supplier, { partyType: 'trader' })), /عميل صالح/);
  assert.deepEqual(await snapshot(), before);
  const id = await trader(), buyId = await command(purchase(id, { paymentMethod: 'cash' }));
  const saleId = await command(sale(id, { paymentMethod: 'cash', lines: [{ productId: 'p', quantity: 1, piecePrice: 20 }] }));
  assert.deepEqual(await command({ type: 'party.delete', id }), { id, disposition: 'archived' });
  before = await snapshot();
  await assert.rejects(command(sale(id)), /صالح|غير موجود/);
  await assert.rejects(command(purchase(id)), /صالح|غير موجود/);
  assert.deepEqual(await snapshot(), before);
  await command({ ...sale(id, { paymentMethod: 'cash', lines: [{ productId: 'p', quantity: 1, piecePrice: 25 }] }), type: 'sale.update', documentId: saleId });
  assert.equal((await party(id)).isArchived, true);
  await command({ type: 'sale.void', documentId: saleId }); await command({ type: 'purchase.void', documentId: buyId });
  assert.deepEqual([await balance(id), await stock(), await cashBalance()], [0, 0, 1000]);
  const documents = await db.collection('documents').find({ partyId: id }).toArray();
  await command({ type: 'party.restore', id });
  assert.equal((await party(id)).isArchived, false);
  assert.deepEqual(await db.collection('documents').find({ partyId: id }).toArray(), documents);
});

test('HTTP trader creation requires both create permissions and optional opening permission, with atomic idempotent receipts', async () => {
  await user('customer', ['customers.create']); await user('supplier', ['suppliers.create']);
  await user('both', ['customers.create', 'suppliers.create']);
  await user('opening', ['customers.create', 'suppliers.create', 'party.opening.manage']);
  const body = { type: 'trader.create', name: 'HTTP synthetic trader' };
  await denied({ ...body, partyType: 'customer' }, ['customer', 'supplier'], 'create-spoof');
  let before = await snapshot();
  assert.equal((await post(body, null, 'anonymous-trader')).status, 401); assert.deepEqual(await snapshot(), before);
  await denied({ ...body, opening: { direction: 'receivable', amount: 100 } }, ['both'], 'nested-opening');
  for (const malformed of [{ type: 'party.create', partyType: 'trader', name: 'Rejected' }, { ...body, partyType: 'supplier' }]) {
    before = await snapshot(); assert.equal((await post(malformed, 'opening', `malformed-${malformed.type}`)).status, 400); assert.deepEqual(await snapshot(), before);
  }
  const full = { ...body, opening: { direction: 'receivable', amount: 100, note: 'Literal shared opening' } };
  const first = await post(full, 'opening', 'create-once'); assert.equal(first.status, 200); const firstBody = await first.json();
  const stable = await snapshot(), retry = await post(full, 'opening', 'create-once');
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), firstBody); assert.deepEqual(await snapshot(), stable);
  assert.equal(await balance(firstBody.id), 100); assert.equal(await db.collection('parties').countDocuments(), 1);
  assert.equal(await db.collection('documents').countDocuments({ kind: 'party-opening', partyId: firstBody.id }), 1);
  assert.equal(await db.collection('commandReceipts').countDocuments({ commandType: 'trader.create' }), 1);
  assert.equal((await post({ ...full, name: 'Different payload' }, 'opening', 'create-once')).status, 409);
});

test('HTTP trader identity edits, archival and restore use stored-role paired management permissions despite a forged body role', async () => {
  const id = await trader();
  const decoyId = await command({ type: 'party.create', partyType: 'customer', name: 'Synthetic authorization decoy' });
  await db.collection('documents').insertOne({ id: 'historical', kind: 'payment', status: 'voided', partyId: id, lines: [], total: 0 });
  await user('customer', ['customers.edit', 'customers.delete']); await user('supplier', ['suppliers.edit', 'suppliers.delete']);
  await user('both', ['customers.edit', 'suppliers.edit', 'customers.delete', 'suppliers.delete']);
  await denied({ type: 'party.update', id, partyId: decoyId, partyType: 'customer', name: 'Spoofed', phone: '' }, ['customer', 'supplier'], 'identity');
  assert.equal((await post({ type: 'party.update', id, partyType: 'customer', name: 'Same shared identity', phone: '' }, 'both', 'identity-both')).status, 200);
  assert.equal((await party(id)).partyType, 'trader');
  await denied({ type: 'party.delete', id, partyId: decoyId, partyType: 'supplier' }, ['customer', 'supplier'], 'archive');
  assert.equal((await post({ type: 'party.delete', id }, 'both', 'archive-both')).status, 200);
  assert.equal((await party(id)).isArchived, true);
  await denied({ type: 'party.restore', id, partyId: decoyId, partyType: 'customer' }, ['customer', 'supplier'], 'restore');
  assert.equal((await post({ type: 'party.restore', id }, 'both', 'restore-both')).status, 200);
  assert.deepEqual([(await party(id)).isArchived, await balance(id)], [false, 0]);
});

test('HTTP trader cash and legacy inverse permissions cannot be obtained from just one role family', async () => {
  const id = await trader();
  const customer = ['customers.collect', 'customers.collect.edit', 'customers.collect.delete'];
  const supplier = ['suppliers.pay', 'suppliers.pay.edit', 'suppliers.pay.delete'];
  await user('customer', customer); await user('supplier', supplier); await user('both', [...customer, ...supplier]);
  const receipt = { type: 'party-cash.post', partyId: id, partyType: 'customer', direction: 'receive', amount: 10, paymentMethod: 'cash' };
  await denied(receipt, ['customer', 'supplier'], 'cash-create');
  const created = await post(receipt, 'both', 'cash-both'); assert.equal(created.status, 200); const documentId = (await created.json()).id;
  const update = { type: 'party-cash.update', documentId, partyType: 'supplier', partyId: 'forged', direction: 'receive', amount: 20, paymentMethod: 'cash' };
  await denied(update, ['customer', 'supplier'], 'cash-edit'); assert.equal((await post(update, 'both', 'cash-edit-both')).status, 200);
  await denied({ type: 'party-cash.void', documentId, partyType: 'customer' }, ['customer', 'supplier'], 'cash-void');
  assert.equal((await post({ type: 'party-cash.void', documentId }, 'both', 'cash-void-both')).status, 200);
  assert.deepEqual([await balance(id), await cashBalance()], [0, 1000]);
  await db.collection('parties').updateOne({ id }, { $set: { receivable: 5, payable: 0, net: 5 } });
  await db.collection('documents').insertOne({ id: 'legacy-settlement', kind: 'settlement', status: 'posted', partyId: id, total: 5, partyBalanceDelta: 5, lines: [] });
  await denied({ type: 'legacy-party-document.void', documentId: 'legacy-settlement', partyType: 'supplier' }, ['customer', 'supplier'], 'legacy-void');
  assert.equal((await post({ type: 'legacy-party-document.void', documentId: 'legacy-settlement' }, 'both', 'legacy-void-both')).status, 200);
  assert.equal(await balance(id), 0); assert.equal(await cashBalance(), 1000);
});

test('standalone trader opening needs manage plus paired edits, while ordinary invoice permissions remain sufficient for its slots', async () => {
  const id = await trader();
  await user('manage', ['party.opening.manage']); await user('customer-edit', ['party.opening.manage', 'customers.edit']);
  await user('supplier-edit', ['party.opening.manage', 'suppliers.edit']); await user('edits', ['customers.edit', 'suppliers.edit']);
  await user('opening', ['party.opening.manage', 'customers.edit', 'suppliers.edit']);
  await user('pos', ['pos.create', 'pos.edit', 'pos.delete']); await user('purchases', ['purchases.create', 'purchases.edit', 'purchases.delete']);
  const openingBody = { type: 'party-opening.post', partyId: id, partyType: 'customer', direction: 'receivable', amount: 100 };
  await denied(openingBody, ['manage', 'customer-edit', 'supplier-edit', 'edits'], 'opening-post');
  const response = await post(openingBody, 'opening', 'opening-both'); assert.equal(response.status, 200); const openingId = (await response.json()).id;
  const update = { type: 'party-opening.update', documentId: openingId, partyId: 'forged', expectedRevision: 0, direction: 'payable', amount: 80, reason: 'Synthetic correction' };
  await denied(update, ['manage', 'customer-edit', 'supplier-edit', 'edits'], 'opening-edit');
  assert.equal((await post(update, 'opening', 'opening-edit-both')).status, 200);
  await denied({ type: 'party-opening.void', documentId: openingId, expectedRevision: 1 }, ['manage', 'customer-edit', 'supplier-edit', 'edits'], 'opening-void');
  assert.equal((await post({ type: 'party-opening.void', documentId: openingId, expectedRevision: 1 }, 'opening', 'opening-void-both')).status, 200);
  const buyResponse = await post(purchase(id), 'purchases', 'invoice-purchase'); assert.equal(buyResponse.status, 200); const buyId = (await buyResponse.json()).id;
  const saleResponse = await post(sale(id), 'pos', 'invoice-sale'); assert.equal(saleResponse.status, 200); const saleId = (await saleResponse.json()).id;
  assert.equal(await balance(id), 10);
  assert.equal((await post({ type: 'sale.void', documentId: saleId }, 'pos', 'invoice-sale-void')).status, 200);
  assert.equal((await post({ type: 'purchase.void', documentId: buyId }, 'purchases', 'invoice-purchase-void')).status, 200);
  assert.deepEqual([await balance(id), await stock(), await cashBalance()], [0, 0, 1000]);
});
