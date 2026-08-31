import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { execute } from "../app/api/command/route.ts";
import { peekNextDocumentSequence } from "../lib/document-sequences.ts";

let replica, client, db, unavailable;
before(async () => {
  try {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    client = new MongoClient(replica.getUri()); await client.connect(); db = client.db("conta_integration_test");
    assert.match(db.databaseName, /test/, "integration tests must never target production");
  } catch (error) { unavailable = `MongoDB test binary unavailable: ${error.message}`; }
});
after(async () => { await client?.close(); await replica?.stop(); });
beforeEach(async () => {
  if (unavailable) return;
  await db.dropDatabase();
  await db.collection("warehouses").insertMany([{ _id: "wh-main", name: "Main", isSalesDefault: true }, { _id: "wh-b", name: "B" }]);
  await db.collection("products").insertOne({ id: "p1", name: "Tea", sku: "TEA", barcode: "", pieceCost: 50, piecePrice: 100, stocks: {} });
  await db.collection("parties").insertMany([{ id: "party", name: "Customer", phone: "", receivable: 0, payable: 0, net: 0, partyType: "customer" }, { id: "supplier", name: "Supplier", phone: "", receivable: 0, payable: 0, net: 0, partyType: "supplier" }]);
  await db.collection("paymentAccounts").insertOne({ id: "cash-id", code: "cash", name: "Cash", isActive: true, balance: 10000 });
});
async function command(body) {
  let result;
  await client.withSession(s => s.withTransaction(async () => { result = await execute(db, s, body); }));
  return result;
}

test("document sequence previews are kind-specific and never reserve numbers", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("counters").insertMany([{ _id: "documentSequence:sale", value: 550 }, { _id: "documentSequence:purchase", value: 117 }]);
  for (let attempt = 0; attempt < 20; attempt += 1) assert.equal(await peekNextDocumentSequence(db, "sale"), 551);
  assert.equal(await peekNextDocumentSequence(db, "purchase"), 118);
  assert.deepEqual((await db.collection("counters").find().sort({ _id: 1 }).toArray()).map(({ _id, value }) => ({ _id, value })), [
    { _id: "documentSequence:purchase", value: 117 }, { _id: "documentSequence:sale", value: 550 },
  ]);
});

test("first purchase initializes missing stock, movement, and supplier payable atomically", async t => {
  if (unavailable) return t.skip(unavailable);
  await command({ type: "purchase.post", warehouseId: "wh-main", partyId: "supplier", paymentMethod: "note", paidAmount: 500, lines: [{ productId: "p1", quantity: 50, unitPrice: 50 }] });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 50);
  assert.deepEqual(await db.collection("stockMovements").findOne({}, { projection: { _id: 0, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { quantityDelta: 50, balanceBefore: 0, balanceAfter: 50 });
  const doc = await db.collection("documents").findOne({ kind: "purchase" });
  assert.deepEqual([doc.total, doc.paidTotal, doc.dueTotal], [2500, 0, 2500]);
  assert.deepEqual(await db.collection("parties").findOne({ id: "supplier" }, { projection: { _id: 0, payable: 1, net: 1 } }), { payable: 2500, net: -2500 });
});

test("sale decreases stock and insufficient sale rolls every write back", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 100 } });
  await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", paidAmount: 700, lines: [{ productId: "p1", quantity: 27, piecePrice: 100 }] });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 73);
  const beforeCounts = [await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments()];
  await assert.rejects(command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", paidAmount: 0, lines: [{ productId: "p1", quantity: 74, piecePrice: 100 }] }), /المخزون غير كاف/);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 73);
  assert.deepEqual([await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments()], beforeCounts);
  assert.equal((await db.collection("parties").findOne({ id: "party" })).receivable, 2700);
});

test("direct sale command rejects a price below authoritative purchase cost", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 5, lastPurchaseCost: 12000 } });
  await assert.rejects(command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash", lines: [{ productId: "p1", quantity: 1, piecePrice: 10000 }] }), /تحت سعر الشراء/);
  assert.equal(await db.collection("documents").countDocuments({ kind: "sale" }), 0);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 5);
});

test("transfer and adjustment initialize missing destination fields", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 30 } });
  await command({ type: "transfer.post", fromWarehouseId: "wh-main", toWarehouseId: "wh-b", lines: [{ productId: "p1", quantity: 10 }] });
  let product = await db.collection("products").findOne({ id: "p1" }); assert.deepEqual(product.stocks, { "wh-main": 20, "wh-b": 10 });
  await db.collection("products").updateOne({ id: "p1" }, { $unset: { "stocks.wh-b": "" }, $set: { lastPurchaseCost: 50 } });
  await command({ type: "adjustment.post", warehouseId: "wh-b", reason: "count", lines: [{ productId: "p1", actualQuantity: 17 }] });
  product = await db.collection("products").findOne({ id: "p1" }); assert.equal(product.stocks["wh-b"], 17);
  assert.deepEqual(await db.collection("stockMovements").findOne({ type: "adjustment" }, { projection: { _id: 0, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { quantityDelta: 17, balanceBefore: 0, balanceAfter: 17 });
});

test("sale update is the only correction workflow and adjusts stock in both directions", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 10, lastPurchaseCost: 40 } });
  const saleId = await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", lines: [{ productId: "p1", quantity: 5, piecePrice: 100 }] });
  const original = await db.collection("documents").findOne({ id: saleId });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 5);
  await command({ type: "sale.update", documentId: saleId, partyId: "party", paymentMethod: "note", lines: [{ productId: "p1", quantity: 3, piecePrice: 100 }] });
  let edited = await db.collection("documents").findOne({ id: saleId });
  assert.deepEqual([edited.id, edited.number, edited.sequence, edited.total, edited.revision, edited.lines[0].grossProfit], [original.id, original.number, original.sequence, 300, 1, 180]);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 7);
  assert.equal((await db.collection("parties").findOne({ id: "party" })).receivable, 300);
  assert.equal(await db.collection("documents").countDocuments({ kind: "sale" }), 1);
  assert.equal(await db.collection("documents").countDocuments({ kind: "return" }), 0);
  await command({ type: "sale.update", documentId: saleId, partyId: "party", paymentMethod: "note", lines: [{ productId: "p1", quantity: 4, piecePrice: 100 }] });
  edited = await db.collection("documents").findOne({ id: saleId });
  assert.deepEqual([edited.total, edited.revision], [400, 2]);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 6);
  await assert.rejects(command({ type: "sale.return", saleId, lines: [{ productId: "p1", quantity: 1 }] }), /العملية غير مدعومة/);
});

test("payments, offset, settlement, expense and invalid input preserve balance invariant", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("parties").updateOne({ id: "party" }, { $set: { receivable: 10000, payable: 7000, net: 3000 } });
  await command({ type: "offset.post", partyId: "party", amount: 7000 });
  await command({ type: "payment.post", partyId: "party", side: "receivable", amount: 1000, paymentMethod: "cash-id" });
  await command({ type: "settlement.post", partyId: "party", side: "receivable", amount: 500 });
  const party = await db.collection("parties").findOne({ id: "party" }); assert.deepEqual([party.receivable, party.payable, party.net], [1500, 0, 1500]);
  await command({ type: "expense.post", title: "Rent", amount: 100, occurredAt: "2026-08-15", paymentMethod: "cash-id" });
  assert.equal(await db.collection("documents").countDocuments({ kind: "expense" }), 1);
  const count = await db.collection("documents").countDocuments();
  await assert.rejects(command({ type: "purchase.post", warehouseId: "unknown", partyId: "supplier", lines: [{ productId: "p1", quantity: -1, unitPrice: 1 }] }));
  assert.equal(await db.collection("documents").countDocuments(), count);
});

test("product codes are atomic, sequential, unique, and independent from barcodes", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").createIndex({ sku: 1 }, { unique: true });
  await db.collection("products").insertOne({ id: "legacy", name: "Legacy", sku: "9", barcode: "14313143", stocks: {} });
  const firstId = await command({ type: "product.create", name: "Product A" });
  const secondId = await command({ type: "product.create", name: "Product B" });
  const [first, second] = await Promise.all([
    db.collection("products").findOne({ id: firstId }),
    db.collection("products").findOne({ id: secondId }),
  ]);
  assert.deepEqual([first.sku, second.sku], ["10", "11"]);
  assert.deepEqual([first.barcode, first.pieceCost, first.piecePrice], ["", null, null]);
  await assert.rejects(db.collection("products").insertOne({ id: "duplicate", name: "Duplicate", sku: "11", stocks: {} }), /duplicate key/i);
});

test("product deletion always archives, preserves stock and identity, and supports restore", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("counters").insertOne({ _id: "productSequence", value: 20 });
  await command({ type: "product.delete", id: "p1" });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).isArchived, true);
  const next = await command({ type: "product.create", name: "Next" });
  assert.equal((await db.collection("products").findOne({ id: next })).sku, "21");
  await db.collection("products").insertMany([{ id:"history",name:"Historic",sku:"22",barcode:"",stocks:{} },{ id:"stock",name:"Stocked",sku:"23",barcode:"",stocks:{"wh-main":2} }]);
  await db.collection("documents").insertOne({ id:"old",number:"OLD",kind:"sale",lines:[{productId:"history"}] });
  await command({ type:"product.delete", id:"history" });
  assert.equal((await db.collection("products").findOne({id:"history"})).isArchived,true);
  await command({ type:"product.delete",id:"stock" });
  let stocked=await db.collection("products").findOne({id:"stock"});assert.equal(stocked.isArchived,true);assert.equal(stocked.stocks["wh-main"],2);
  await command({type:"product.restore",id:"stock"});stocked=await db.collection("products").findOne({id:"stock"});assert.equal(stocked.isArchived,false);assert.equal(stocked.stocks["wh-main"],2);
  await assert.rejects(command({type:"purchase.post",warehouseId:"wh-main",partyId:"party",paymentMethod:"note",lines:[{productId:"history",quantity:1,unitPrice:1}]}),/غير موجود/);
  assert.ok(await db.collection("documents").findOne({"lines.productId":"history"}),"historical documents remain queryable");
});


test("product opening stock is validated, auditable, and barcode is unique", async t => {
  if (unavailable) return t.skip(unavailable);
  const plainId = await command({ type: "product.create", name: "Name only" });
  assert.ok(await db.collection("products").findOne({ id: plainId }));
  await assert.rejects(command({ type: "product.create", name: "Missing cost", openingStock: 10 }), /سعر الشراء/);
  await assert.rejects(command({ type: "product.create", name: "Missing warehouse", openingStock: 10, pieceCost: 100 }), /مخزن رصيد البداية/);
  const openedId = await command({ type: "product.create", name: "Opened", barcode: "123", openingStock: 10, pieceCost: 100, openingWarehouseId: "wh-b", wholesalePrice: 125 });
  const opened = await db.collection("products").findOne({ id: openedId });
  assert.equal(opened.stocks["wh-b"], 10); assert.equal(opened.stocks["wh-main"], undefined); assert.equal(opened.lastPurchaseCost, 100); assert.equal(opened.wholesalePrice, 125);
  assert.deepEqual(await db.collection("stockMovements").findOne({ productId: openedId }, { projection: { _id: 0, type: 1, balanceBefore: 1, balanceAfter: 1, quantityDelta: 1 } }), { type: "opening", quantityDelta: 10, balanceBefore: 0, balanceAfter: 10 });
  assert.equal((await db.collection("documents").findOne({ "lines.productId": openedId })).title, "رصيد بداية");
  await assert.rejects(command({ type: "product.create", name: "Duplicate", barcode: "123" }), /هذا الباركود مستخدم/);
  const otherId = await command({ type: "product.create", name: "Other", barcode: "456" });
  assert.equal((await db.collection("products").findOne({ id: otherId })).wholesalePrice, null);
  await command({ type: "product.update", id: otherId, name: "Other", wholesalePrice: 90 });
  assert.equal((await db.collection("products").findOne({ id: otherId })).wholesalePrice, 90);
  await assert.rejects(command({ type: "product.update", id: otherId, name: "Other", barcode: "123" }), /هذا الباركود مستخدم/);
});

test("payment-account policy consistently controls every new outflow", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("paymentAccounts").updateOne({id:"cash-id"},{$set:{balance:100,allowNegativeBalance:true}});
  await assert.rejects(command({type:"purchase.post",warehouseId:"wh-main",partyId:"supplier",paymentMethod:"cash-id",lines:[{productId:"p1",quantity:2,unitPrice:100}]}),/الرصيد غير كاف/);
  const bank=await command({type:"payment-account.create",name:"Overdraft",allowNegativeBalance:true});
  await command({type:"account-adjustment.post",accountId:bank,direction:"withdrawal",amount:150});
  assert.equal((await db.collection("paymentAccounts").findOne({id:bank})).balance,-150);
  await command({type:"account-adjustment.post",accountId:bank,direction:"deposit",amount:50});
  await command({type:"expense.post",title:"Large",amount:100,occurredAt:"2026-08-15",paymentMethod:bank});
  await command({type:"account-transfer.post",fromAccountId:bank,toAccountId:"cash-id",amount:100});
  assert.equal((await db.collection("paymentAccounts").findOne({id:bank})).balance,-300);
  await assert.rejects(command({type:"payment-account.update",id:bank,name:"Overdraft",isActive:true,allowNegativeBalance:false}),/لا يمكن إيقاف/);
  await command({type:"account-balance-correction.post",accountId:bank,newBalance:-500,reason:"audit"});
  assert.equal((await db.collection("paymentAccounts").findOne({id:bank})).balance,-500);
  await assert.rejects(command({type:"account-balance-correction.post",accountId:"cash-id",newBalance:-1,reason:"audit"}),/غير صالح/);
  await command({type:"payment-account.update",id:"cash-id",name:"Cash",isActive:true,allowNegativeBalance:true});
  assert.equal((await db.collection("paymentAccounts").findOne({id:"cash-id"})).allowNegativeBalance,false);
});

test("invoice reversal bypasses normal overdraft policy",async t=>{
  if(unavailable)return t.skip(unavailable);
  await db.collection("paymentAccounts").updateOne({id:"cash-id"},{$set:{balance:0,allowNegativeBalance:false}});
  await db.collection("products").updateOne({id:"p1"},{$set:{"stocks.wh-main":1,lastPurchaseCost:10}});
  const sale=await command({type:"sale.post",warehouseId:"wh-main",paymentMethod:"cash-id",lines:[{productId:"p1",quantity:1,piecePrice:100}]});
  await db.collection("paymentAccounts").updateOne({id:"cash-id"},{$set:{balance:20}});
  await command({type:"sale.void",documentId:sale});
  assert.equal((await db.collection("paymentAccounts").findOne({id:"cash-id"})).balance,-80);
});

test("offset has no cash movement, payment has one, and settlement remains compatible", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("parties").updateOne({ id: "party" }, { $set: { receivable: 5000, payable: 3000, net: 2000 } });
  await command({ type: "offset.post", partyId: "party", amount: 1000 });
  assert.equal(await db.collection("financialMovements").countDocuments(), 0);
  await command({ type: "payment.post", partyId: "party", side: "receivable", amount: 500, paymentMethod: "cash-id" });
  assert.equal(await db.collection("financialMovements").countDocuments(), 1);
  await command({ type: "settlement.post", partyId: "party", side: "payable", amount: 500 });
  assert.ok(await db.collection("documents").findOne({ kind: "settlement" }));
});

test("payment accounts create and update without exposing the legacy icon", async t => {
  if (unavailable) return t.skip(unavailable);
  const id = await command({ type: "payment-account.create", name: "Bank", color: "#1677c8" });
  let account = await db.collection("paymentAccounts").findOne({ id });
  assert.equal(account.icon, "wallet");
  await db.collection("paymentAccounts").updateOne({ id }, { $set: { icon: "landmark" } });
  await command({ type: "payment-account.update", id, name: "Bank updated", color: "#123456", isActive: false, allowNegativeBalance: false });
  account = await db.collection("paymentAccounts").findOne({ id });
  assert.deepEqual([account.name, account.color, account.icon, account.isActive], ["Bank updated", "#123456", "landmark", false]);
  assert.ok(await db.collection("paymentAccounts").findOne({ code: "cash" }));
});

test("product expiry and note normalize, persist, edit, and reject invalid dates", async t => {
  if (unavailable) return t.skip(unavailable);
  const blankId = await command({ type: "product.create", name: "Blank expiry", expiryDate: "", note: "  remembered  " });
  let product = await db.collection("products").findOne({ id: blankId });
  assert.equal(product.expiryDate, null); assert.equal(product.note, "remembered"); assert.ok(product.sku);
  await command({ type: "product.update", id: blankId, name: "Blank expiry", expiryDate: "2027-02-28", note: "edited" });
  product = await db.collection("products").findOne({ id: blankId }); assert.deepEqual([product.expiryDate, product.note], ["2027-02-28", "edited"]);
  await assert.rejects(command({ type: "product.create", name: "Bad expiry", expiryDate: "2027-02-30" }), /تاريخ انتهاء/);
});

test("sale permits expiry day, rejects expired stock atomically, and creates no cash expiry movement", async t => {
  if (unavailable) return t.skip(unavailable);
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { expiryDate: today, "stocks.wh-main": 2 } });
  await command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash", lines: [{ productId: "p1", quantity: 1, piecePrice: 100 }] });
  await db.collection("products").updateOne({ id: "p1" }, { $set: { expiryDate: yesterday } });
  const before = [await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments(), await db.collection("financialMovements").countDocuments()];
  await assert.rejects(command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash", lines: [{ productId: "p1", quantity: 1, piecePrice: 100 }] }), /انتهت صلاحية/);
  assert.deepEqual([await db.collection("documents").countDocuments(), await db.collection("stockMovements").countDocuments(), await db.collection("financialMovements").countDocuments()], before);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 1);
});

test("payment accounts use auditable opening balances and manual adjustments", async t => {
  if (unavailable) return t.skip(unavailable);
  const zeroId = await command({ type: "payment-account.create", name: "Zero bank", openingBalance: 0 });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: zeroId })).balance, 0);
  assert.equal(await db.collection("financialMovements").countDocuments({ paymentMethod: zeroId }), 0);

  const openedId = await command({ type: "payment-account.create", name: "Opened bank", openingBalance: 500 });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: openedId })).balance, 500);
  assert.deepEqual(await db.collection("financialMovements").findOne({ paymentMethod: openedId }, { projection: { _id: 0, type: 1, direction: 1, amount: 1 } }), { type: "opening-balance", direction: "in", amount: 500 });

  await command({ type: "account-adjustment.post", accountId: openedId, direction: "deposit", amount: 200, note: "cash desk" });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: openedId })).balance, 700);
  assert.deepEqual(await db.collection("financialMovements").findOne({ paymentMethod: openedId, type: "manual-deposit" }, { projection: { _id: 0, direction: 1, amount: 1, note: 1 } }), { direction: "in", amount: 200, note: "cash desk" });

  await command({ type: "account-adjustment.post", accountId: openedId, direction: "withdrawal", amount: 300 });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: openedId })).balance, 400);
  assert.ok(await db.collection("financialMovements").findOne({ paymentMethod: openedId, type: "manual-withdrawal", direction: "out" }));
  await assert.rejects(command({ type: "account-adjustment.post", accountId: openedId, direction: "withdrawal", amount: 401 }), /الرصيد غير كاف/);
  assert.equal((await db.collection("paymentAccounts").findOne({ id: openedId })).balance, 400);
});

test("sale update preserves identity and historical cost while revising stock, bank and debt", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 20, lastPurchaseCost: 50 } });
  await db.collection("paymentAccounts").insertOne({ id: "bank-b", code: "bank-b", name: "Bank B", isActive: true, balance: 0 });
  const saleId = await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "cash-id", lines: [{ productId: "p1", quantity: 1, piecePrice: 100 }] });
  const original = await db.collection("documents").findOne({ id: saleId });
  await db.collection("products").updateOne({ id: "p1" }, { $set: { lastPurchaseCost: 80 } });
  await command({ type: "sale.update", documentId: saleId, partyId: "party", paymentMethod: "bank-b", lines: [{ productId: "p1", quantity: 3, piecePrice: 120 }] });
  const edited = await db.collection("documents").findOne({ id: saleId });
  assert.deepEqual([edited.id, edited.number, edited.sequence], [original.id, original.number, original.sequence]);
  assert.deepEqual([edited.total, edited.lines[0].costAtSale, edited.lines[0].grossProfit], [360, 50, 210]);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 17, "only two additional units are removed");
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "cash-id" })).balance, 10000);
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "bank-b" })).balance, 360);
  assert.equal(await db.collection("financialMovements").countDocuments({ documentId: saleId, type: "sale" }), 1);

  await command({ type: "sale.update", documentId: saleId, partyId: "party", paymentMethod: "note", lines: [{ productId: "p1", quantity: 2, piecePrice: 120 }] });
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 18);
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "bank-b" })).balance, 0);
  assert.equal((await db.collection("parties").findOne({ id: "party" })).receivable, 240);
  assert.equal((await db.collection("documents").findOne({ id: saleId })).dueTotal, 240);
});

test("sale update changes indebted customer, blocks settled debt and protects linked returns", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 10, lastPurchaseCost: 10 } });
  await db.collection("parties").insertOne({ id: "customer-b", name: "B", phone: "", partyType: "customer", receivable: 0, payable: 0, net: 0 });
  const saleId = await command({ type: "sale.post", warehouseId: "wh-main", partyId: "party", paymentMethod: "note", lines: [{ productId: "p1", quantity: 2, piecePrice: 100 }] });
  await command({ type: "sale.update", documentId: saleId, partyId: "customer-b", paymentMethod: "note", lines: [{ productId: "p1", quantity: 2, piecePrice: 150 }] });
  assert.equal((await db.collection("parties").findOne({ id: "party" })).receivable, 0);
  assert.equal((await db.collection("parties").findOne({ id: "customer-b" })).receivable, 300);
  await command({ type: "payment.post", partyId: "customer-b", side: "receivable", amount: 100, paymentMethod: "cash-id" });
  await assert.rejects(command({ type: "sale.update", documentId: saleId, partyId: "customer-b", paymentMethod: "note", lines: [{ productId: "p1", quantity: 1, piecePrice: 100 }] }), /تمت تسويته/);
  assert.equal((await db.collection("documents").findOne({ id: saleId })).total, 300);
  await db.collection("documents").insertOne({ id: "ret", number: "RET-1", kind: "return", status: "posted", parentDocumentId: saleId, lines: [] });
  await assert.rejects(command({ type: "sale.void", documentId: saleId }), /حركة تاريخية/);
});

test("sale void reverses effects, preserves number and does not rewind sequence", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 5, lastPurchaseCost: 10 } });
  const saleId = await command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash-id", lines: [{ productId: "p1", quantity: 2, piecePrice: 100 }] });
  const number = (await db.collection("documents").findOne({ id: saleId })).sequence;
  await command({ type: "sale.void", documentId: saleId });
  assert.equal((await db.collection("documents").findOne({ id: saleId })).status, "voided");
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 5);
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "cash-id" })).balance, 10000);
  const next = await command({ type: "sale.post", warehouseId: "wh-main", paymentMethod: "cash-id", lines: [{ productId: "p1", quantity: 1, piecePrice: 100 }] });
  assert.equal((await db.collection("documents").findOne({ id: next })).sequence, number + 1);
});

test("purchase update and void revise warehouse, payment, supplier and latest cost safely", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("paymentAccounts").insertOne({ id: "bank-b", code: "bank-b", name: "Bank B", isActive: true, balance: 10000 });
  const purchaseId = await command({ type: "purchase.post", warehouseId: "wh-main", partyId: "supplier", paymentMethod: "cash-id", lines: [{ productId: "p1", quantity: 10, unitPrice: 100 }] });
  const original = await db.collection("documents").findOne({ id: purchaseId });
  await command({ type: "purchase.update", documentId: purchaseId, warehouseId: "wh-b", partyId: "supplier", paymentMethod: "bank-b", lines: [{ productId: "p1", quantity: 7, unitPrice: 120 }] });
  const edited = await db.collection("documents").findOne({ id: purchaseId });
  assert.deepEqual([edited.number, edited.sequence, edited.total], [original.number, original.sequence, 840]);
  assert.deepEqual((await db.collection("products").findOne({ id: "p1" })).stocks, { "wh-main": 0, "wh-b": 7 });
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "cash-id" })).balance, 10000);
  assert.equal((await db.collection("paymentAccounts").findOne({ id: "bank-b" })).balance, 9160);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).lastPurchaseCost, 120);
  await command({ type: "purchase.update", documentId: purchaseId, warehouseId: "wh-b", partyId: "supplier", paymentMethod: "note", lines: [{ productId: "p1", quantity: 8, unitPrice: 125 }] });
  assert.equal((await db.collection("parties").findOne({ id: "supplier" })).payable, 1000);
  await command({ type: "purchase.void", documentId: purchaseId });
  const product = await db.collection("products").findOne({ id: "p1" });
  assert.deepEqual([product.stocks["wh-b"], product.lastPurchaseCost], [0, null]);
  assert.equal((await db.collection("parties").findOne({ id: "supplier" })).payable, 0);
  assert.equal((await db.collection("documents").findOne({ id: purchaseId })).status, "voided");
});

test("purchase revision blocks reversal after purchased inventory was consumed and legacy invoices are read-only", async t => {
  if (unavailable) return t.skip(unavailable);
  const purchaseId = await command({ type: "purchase.post", warehouseId: "wh-main", partyId: "supplier", paymentMethod: "note", lines: [{ productId: "p1", quantity: 10, unitPrice: 100 }] });
  await db.collection("products").updateOne({ id: "p1" }, { $set: { "stocks.wh-main": 2 } });
  await assert.rejects(command({ type: "purchase.update", documentId: purchaseId, warehouseId: "wh-b", partyId: "supplier", paymentMethod: "note", lines: [{ productId: "p1", quantity: 7, unitPrice: 100 }] }), /تم التصرف فيه/);
  assert.equal((await db.collection("documents").findOne({ id: purchaseId })).warehouseId, "wh-main");
  await db.collection("documents").updateOne({ id: purchaseId }, { $set: { legacyKey: "legacy:purchase:1" } });
  await assert.rejects(command({ type: "purchase.void", documentId: purchaseId }), /متاحة للعرض فقط/);
  assert.equal((await db.collection("products").findOne({ id: "p1" })).stocks["wh-main"], 2);
});

test("warehouse safe deletion archives history and blocks stock/default", async t => {
  if (unavailable) return t.skip(unavailable);
  await db.collection("warehouses").insertMany([{_id:"empty",name:"Empty"},{_id:"historic",name:"Historic"},{_id:"stocked",name:"Stocked"}]);
  await db.collection("documents").insertOne({id:"history-doc",warehouseId:"historic",kind:"adjustment",status:"posted",lines:[]});
  await db.collection("products").updateOne({id:"p1"},{$set:{"stocks.stocked":2}});
  await command({type:"warehouse.delete",id:"empty"}); assert.equal(await db.collection("warehouses").findOne({_id:"empty"}),null);
  await command({type:"warehouse.delete",id:"historic"}); assert.equal((await db.collection("warehouses").findOne({_id:"historic"})).isArchived,true); assert.ok(await db.collection("documents").findOne({warehouseId:"historic"}));
  await assert.rejects(command({type:"warehouse.delete",id:"stocked"}),/يحتوي على مخزون/);
  await assert.rejects(command({type:"warehouse.delete",id:"wh-main"}),/افتراضي/);
});

test("editing product may add audited opening stock but zero adds nothing", async t => {
  if (unavailable) return t.skip(unavailable);
  await command({type:"product.update",id:"p1",name:"Tea",pieceCost:50,openingStock:4,openingWarehouseId:"wh-b"});
  assert.equal((await db.collection("products").findOne({id:"p1"})).stocks["wh-b"],4);
  assert.deepEqual(await db.collection("stockMovements").findOne({productId:"p1"},{projection:{_id:0,type:1,quantityDelta:1,balanceBefore:1,balanceAfter:1}}),{type:"opening",quantityDelta:4,balanceBefore:0,balanceAfter:4});
  assert.equal((await db.collection("documents").findOne({"lines.productId":"p1"})).title,"إضافة رصيد افتتاحي");
  const before=await db.collection("stockMovements").countDocuments(); await command({type:"product.update",id:"p1",name:"Tea",pieceCost:50,openingStock:0}); assert.equal(await db.collection("stockMovements").countDocuments(),before);
});


test("payment-account removal blocks balances, archives every kind of history, deletes unused, and restores identity",async t=>{
 if(unavailable)return t.skip(unavailable);
 await assert.rejects(command({type:"payment-account.delete",accountId:"cash-id"}),/النقدية الأساسية/);
 for(const [id,balance] of [["positive",100],["negative",-100]]){await db.collection("paymentAccounts").insertOne({id,code:id,name:id,isActive:true,balance});await assert.rejects(command({type:"payment-account.delete",accountId:id}),/غير صفري/)}
 const unused=await command({type:"payment-account.create",name:"Unused",allowNegativeBalance:false});const deleted=await command({type:"payment-account.delete",accountId:unused});assert.equal(deleted.disposition,"deleted");assert.equal(await db.collection("paymentAccounts").findOne({id:unused}),null);
 for(const kind of ["movement","document","transfer"]){const id=`history-${kind}`;await db.collection("paymentAccounts").insertOne({id,code:id,name:`Historic ${kind}`,isActive:true,balance:0,allowNegativeBalance:false});if(kind==="movement")await db.collection("financialMovements").insertOne({id:"m-"+id,paymentMethod:id});if(kind==="document")await db.collection("documents").insertOne({id:"d-"+id,paymentMethod:id});if(kind==="transfer")await db.collection("accountTransfers").insertOne({id:"t-"+id,fromAccountId:id,toAccountId:"cash-id"});const result=await command({type:"payment-account.delete",accountId:id});assert.equal(result.disposition,"archived");let account=await db.collection("paymentAccounts").findOne({id});assert.equal(account.isArchived,true);await assert.rejects(command({type:"account-adjustment.post",accountId:id,direction:"deposit",amount:1}),/صالحة/);await command({type:"payment-account.restore",accountId:id});account=await db.collection("paymentAccounts").findOne({id});assert.deepEqual([account.id,account.code,account.isActive,account.isArchived],[id,id,true,false]);}
});
