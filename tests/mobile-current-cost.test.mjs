import test from "node:test";
import assert from "node:assert/strict";
import { mobileCostBasisSignature, resolveProductCost, currentProductCost } from "../lib/product-cost.ts";
import { createNativeBackup, parseAndValidateBackup, restoreNativeBackup } from "../lib/backup.ts";
import { buildReport, parseReportFilters } from "../lib/reports.ts";
import { execute } from "../app/api/command/route.ts";
import { sqliteHarness } from "./sqlite-harness.mjs";
import { mobileBackupV23, mobileBackupV23Expected as expected } from "./fixtures/mobile-backup-v23.mjs";

const purchase = (id, price, date = "2026-11-01T10:00:00.000Z") => ({ id, kind: "purchase", status: "posted", occurredAt: date, sequence: 1, lines: [{ productId: "p", unitPrice: price }] });

test("an imported current valuation is bound to its unchanged acquisition history", () => {
  const source = purchase("source", 10), product = { id: "p", pieceCost: 999, mobileSource: { format: "alkarna-web-backup" }, mobileImportedCurrentCost: 12 };
  product.mobileImportedCostBasis = mobileCostBasisSignature("p", [source]);
  assert.equal(resolveProductCost(product, [source]).cost, 12);
  assert.equal(resolveProductCost(product, [{ ...source, note: "ملاحظة جديدة", revision: 2 }]).cost, 12);
  const newer = purchase("native", 15, "2026-11-21T10:00:00.000Z");
  assert.equal(resolveProductCost(product, [source, newer]).cost, 15);
  assert.equal(resolveProductCost(product, [source, { ...newer, status: "voided" }]).cost, 12);
  assert.equal(resolveProductCost(product, [{ ...source, lines: [{ productId: "p", unitPrice: 13 }] }]).cost, 13);
  assert.equal(resolveProductCost(product, [{ ...source, status: "voided" }]).cost, null);
  assert.equal(resolveProductCost({ id: "p", pieceCost: 999 }, [source]).cost, 10, "Native cards keep their existing cost authority");
  assert.equal(resolveProductCost({ ...product, mobileImportedCurrentCost: 0 }, [source]).cost, 0, "A zero phone valuation is not replaced by a different historical price");
});

test("mobile valuation 12 and saved historical COGS remain separate through purchase, void and backup", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const source = mobileBackupV23(); source.state.products[0].cost = 12;
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(JSON.stringify(source)), session));
  const command = body => h.db.transaction(session => execute(h.db, session, body));
  const product = () => h.db.collection("products").findOne({ id: expected.productId });
  const native = await createNativeBackup(h.db), warehouseId = native.collections.warehouses.find(row => row.name === "الرئيسي")._id;
  const filters = parseReportFilters(new URL("http://local/?type=sales&allTime=true&unpaged=true"));
  const oldReports = await buildReport(h.db, filters);
  assert.deepEqual([oldReports.summary.netSales, oldReports.summary.cost, oldReports.summary.profit], [72, 35, 37]);
  assert.equal(await h.db.transaction(async session => currentProductCost(h.db, session, await product())), 12);
  const purchaseId = await command({ type: "purchase.post", warehouseId, paymentMethod: expected.accountId, lines: [{ productId: expected.productId, quantity: 1, unitPrice: 15 }] });
  assert.equal(await h.db.transaction(async session => currentProductCost(h.db, session, await product())), 15);
  const purchaseDoc = await h.db.collection("documents").findOne({ id: purchaseId });
  await command({ type: "purchase.void", documentId: purchaseId, expectedRevision: purchaseDoc.revision ?? 0 });
  assert.equal(await h.db.transaction(async session => currentProductCost(h.db, session, await product())), 12);
  assert.deepEqual((await buildReport(h.db, filters)).summary, oldReports.summary, "New acquisitions never reprice imported historical sales");
  const roundTrip = parseAndValidateBackup(JSON.stringify(await createNativeBackup(h.db)));
  await h.db.transaction(session => restoreNativeBackup(h.db, roundTrip, session));
  assert.equal(await h.db.transaction(async session => currentProductCost(h.db, session, await product())), 12);
  assert.deepEqual((await buildReport(h.db, filters)).summary, oldReports.summary);
});

test("a zero mobile valuation stays zero in inventory without asserting a free cost for a future sale", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const source = mobileBackupV23(); source.state.products[0].cost = 0;
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(JSON.stringify(source)), session));
  const product = await h.db.collection("products").findOne({ id: expected.productId });
  assert.equal(await h.db.transaction(session => currentProductCost(h.db, session, product)), null);
  assert.equal((await h.db.collection("products").findOne({ id: expected.productId })).lastPurchaseCost, 0);
  const overview = await buildReport(h.db, parseReportFilters(new URL("http://local/?type=overview&allTime=true&unpaged=true")));
  assert.equal(overview.summary.currentInventoryValue, 20);
  const sales = await buildReport(h.db, parseReportFilters(new URL("http://local/?type=sales&allTime=true&unpaged=true")));
  assert.equal(sales.summary.cost, 35);
  assert.equal(sales.summary.profit, 37);
});
