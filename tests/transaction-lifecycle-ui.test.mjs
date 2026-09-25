import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/conta-app.tsx", import.meta.url), "utf8");
const openingHistory = await readFile(new URL("../app/opening-stock-history.tsx", import.meta.url), "utf8");
const openingBlockers = await readFile(new URL("../app/opening-stock-blockers.tsx", import.meta.url), "utf8");

const expectedCommands = [
  "party-cash.update",
  "party-cash.void",
  "transfer.update",
  "transfer.void",
  "adjustment.update",
  "adjustment.void",
  "account-transfer.update",
  "account-transfer.void",
  "account-adjustment.update",
  "account-adjustment.void",
];

const expectedPermissions = [
  "customers.collect.edit",
  "customers.collect.delete",
  "suppliers.pay.edit",
  "suppliers.pay.delete",
  "warehouses.transfer.edit",
  "warehouses.transfer.delete",
  "warehouses.adjust.edit",
  "warehouses.adjust.delete",
  "banks.transfer.edit",
  "banks.transfer.delete",
  "banks.deposit_withdraw.edit",
  "banks.deposit_withdraw.delete",
];

test("every new transaction lifecycle command is reachable from the application UI", () => {
  for (const command of expectedCommands) assert.ok(source.includes(`"${command}"`), `missing UI command ${command}`);
});

test("transaction lifecycle buttons respect the matching edit and delete permissions", () => {
  for (const permission of expectedPermissions) assert.ok(source.includes(`"${permission}"`), `missing UI permission ${permission}`);
});

test("lifecycle row actions reuse the current visual system and shared confirmation flow", () => {
  assert.match(source, /function LifecycleActions/);
  assert.match(source, /className="soft"/);
  assert.match(source, /className="danger compact-delete"/);
  assert.match(source, /useAppConfirm\(\)/);
  assert.doesNotMatch(source, /window\.confirm\s*\(/);
  assert.doesNotMatch(source, /window\.alert\s*\(/);
});

test("opening-stock history has its own latest-correction edit and delete lifecycle", () => {
  assert.match(source, /document\.kind === "adjustment" && !isOpeningStockDocument\(document\)/);
  assert.match(source, /<OpeningStockHistory[\s\S]*run=\{p\.run\}[\s\S]*canEdit=\{canEdit\}[\s\S]*canDelete=\{canDelete\}/);
  assert.match(openingHistory, /"opening-stock-correction\.update"/);
  assert.match(openingHistory, /"opening-stock-correction\.void"/);
  assert.match(openingHistory, /latestCorrectionByProduct/);
  assert.doesNotMatch(openingHistory, /document\.openingCorrection === true/);
  assert.match(openingHistory, /isOpeningStockCorrectionDocument\(document\)/);
  assert.match(openingHistory, /openOpeningSource\(productId\)/);
  assert.match(source, /productSourceRequest/);
  assert.match(source, /<Products[\s\S]*sourceRequest=\{productSourceRequest\}/);
  assert.match(source, /<OpeningStockHistory[\s\S]*openOpeningSource=\{p\.openOpeningSource\}/);
  assert.match(openingHistory, /useAppConfirm\(\)/);
  assert.match(openingHistory, /asOpeningStockBlockedPayload/);
  assert.match(openingHistory, /<OpeningStockBlockers/);
  assert.match(openingBlockers, /OPENING_STOCK_BLOCKED/);
  assert.match(openingBlockers, /الانتقال إلى المصدر/);
  assert.match(openingBlockers, /عرض حركات المنتج/);
  assert.match(openingBlockers, /openSource\(blocker\.documentId\)/);
  assert.match(openingBlockers, /openMovements\(payload\.productId\)/);
  assert.match(source, /<OpeningStockHistory[\s\S]*openSource=\{p\.openSource\}/);
  assert.match(source, /<OpeningStockHistory[\s\S]*openMovements=\{p\.openMovements\}/);
});

test("original opening stock has an explicit delete action and blocked deletion opens the product movement history", () => {
  assert.match(source, /"opening-stock-initial\.void"/);
  assert.match(source, /حذف رصيد البداية/);
  assert.match(source, /asOpeningStockBlockedPayload/);
  assert.match(source, /inventorySourceRequest/);
  assert.match(source, /setDetailProduct\(product\)/);
  assert.match(source, /setMovementFilter\("all"\)/);
  assert.match(source, /openProductMovements/);
  assert.match(source, /<ProductMovementPanel[\s\S]*openSource=\{openSource\}/);
  assert.match(source, /openSource\(movement\.documentId\)/);
});

test("product movement view derives the current document effect instead of selecting one audit movement", () => {
  assert.ok(source.includes("documentProductQuantityEffect"));
  assert.ok(!source.includes("data.movements.find(move => move.documentId === document.id"));
});

test("edit forms expose save and cancel using existing primary and soft styles", () => {
  assert.match(source, /editingPaymentId\?tr\("حفظ التعديل"\)/);
  assert.match(source, /editingDocument\?tr\("حفظ التعديل"\)/);
  assert.match(source, /editingTransferId\?tr\("حفظ التعديل"\)/);
  assert.match(source, /editingAdjustmentId\?tr\("حفظ التعديل"\)/);
  assert.match(source, /className="soft"[^>]*>\{tr\("إلغاء التعديل"\)\}/);
});


test("bank edit actions release the old fixed 124px action column and allow translated buttons to wrap safely", async () => {
  const css=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
  assert.match(css,/\.transfer-detail-row,\.adjustment-detail-row\{grid-template-columns:110px minmax\(0,1fr\)\}/);
  assert.match(css,/\.transfer-detail-row>\.party-row-actions,\.adjustment-detail-row>\.party-row-actions\{grid-column:1\/-1;justify-content:flex-end;flex-wrap:wrap;white-space:normal\}/);
  assert.doesNotMatch(css,/transfer-detail-row,\.adjustment-detail-row\{grid-template-columns:110px minmax\(0,1fr\) 124px\}/);
});

test("party payment buttons use complete translated labels instead of concatenating fragments", () => {
  assert.match(source,/customer\?tr\("دفع للعميل"\):tr\("دفع للمورد"\)/);
  assert.doesNotMatch(source,/tr\("دفع لل"\)\}\{customer\?tr\("عميل"\):tr\("مورد"\)/);
});
