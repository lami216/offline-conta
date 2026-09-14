import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_COLLECTIONS, parseAndValidateBackup } from "../lib/backup.ts";
import { execute } from "../app/api/command/route.ts";
import { sqliteHarness } from "./sqlite-harness.mjs";

const command = (db, body) => db.transaction(session => execute(db, session, body));

test("backup parser accepts payloads larger than the former 50 MiB cap", () => {
  const collections = Object.fromEntries(BACKUP_COLLECTIONS.map(name => [name, []]));
  collections.warehouses = [{ _id: "main", name: "Main", isSalesDefault: true }];
  collections.appSettings = [{ id: "large", payload: "x".repeat(51 * 1024 * 1024) }];
  const backup = {
    format: "conta-backup",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: "test",
    encoding: "json-v2",
    collections,
    counts: Object.fromEntries(BACKUP_COLLECTIONS.map(name => [name, collections[name].length])),
  };
  const input = JSON.stringify(backup);
  assert.ok(Buffer.byteLength(input) > 50 * 1024 * 1024);
  assert.equal(parseAndValidateBackup(input).collections.appSettings.length, 1);
});

test("payment and settlement reject an invalid balance side", async t => {
  const h = await sqliteHarness();
  t.after(() => h.close());
  await h.db.collection("paymentAccounts").insertOne({ id: "cash", code: "cash", name: "Cash", isActive: true, balance: 1000 });
  await h.db.collection("parties").insertOne({ id: "party", name: "Party", partyType: "customer", receivable: 100, payable: 100, net: 0 });
  await assert.rejects(command(h.db, { type: "payment.post", partyId: "party", side: "typo", amount: 10, paymentMethod: "cash" }), /جهة الرصيد غير صالحة/);
  await assert.rejects(command(h.db, { type: "settlement.post", partyId: "party", side: "typo", amount: 10 }), /جهة الرصيد غير صالحة/);
  const party = await h.db.collection("parties").findOne({ id: "party" });
  assert.deepEqual([party.receivable, party.payable], [100, 100]);
});

test("historical partial-payment invoices are read-only instead of being coerced to zero or full payment", async t => {
  const h = await sqliteHarness();
  t.after(() => h.close());
  await h.db.collection("warehouses").insertOne({ _id: "main", name: "Main", isSalesDefault: true });
  await h.db.collection("paymentAccounts").insertOne({ id: "cash", code: "cash", name: "Cash", isActive: true, balance: 1000 });
  await h.db.collection("products").insertOne({ id: "p", sku: "1", name: "Tea", stocks: { main: 5 }, openingStock: 5, openingCost: 50 });
  await h.db.collection("documents").insertOne({
    id: "legacy-partial",
    number: "SAL-OLD",
    kind: "sale",
    status: "posted",
    occurredAt: "2026-01-01T12:00:00.000Z",
    businessDate: "2026-01-01",
    warehouseId: "main",
    warehouseName: "Main",
    paymentMethod: "cash",
    total: 100,
    paidTotal: 40,
    cashAmount: 40,
    dueTotal: 60,
    lines: [{ id: "line", productId: "p", description: "Tea", quantity: 1, unitPrice: 100, lineTotal: 100, costAtSale: 50, grossProfit: 50 }],
  });
  await assert.rejects(command(h.db, {
    type: "sale.update",
    documentId: "legacy-partial",
    paymentMethod: "cash",
    lines: [{ productId: "p", quantity: 1, piecePrice: 120 }],
  }), /دفع جزئي/);
  const original = await h.db.collection("documents").findOne({ id: "legacy-partial" });
  assert.deepEqual([original.total, original.paidTotal, original.dueTotal], [100, 40, 60]);
});
