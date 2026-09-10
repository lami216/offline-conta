import assert from "node:assert/strict";
import test from "node:test";
import { validateRequiredDateRange } from "../app/date-range-validation.ts";
import { presentReportResponse } from "../app/report-presentation.ts";

const baseReport = rows => ({
  report: "sales",
  from: "2026-09-10",
  to: "2026-09-10",
  summary: {},
  rows,
  meta: { page: 1, pageSize: rows.length, totalRows: rows.length, totalPages: 1 },
});

test("required date ranges reject every empty or malformed apply state", () => {
  assert.equal(validateRequiredDateRange("", ""), "missing");
  assert.equal(validateRequiredDateRange("2026-09-10", ""), "missing");
  assert.equal(validateRequiredDateRange("", "2026-09-10"), "missing");
  assert.equal(validateRequiredDateRange("2026-02-30", "2026-09-10"), "invalid");
  assert.equal(validateRequiredDateRange("not-a-date", "2026-09-10"), "invalid");
  assert.equal(validateRequiredDateRange("2026-09-11", "2026-09-10"), "reversed");
  assert.equal(validateRequiredDateRange("2026-09-10", "2026-09-10"), null);
});

test("filtered sales present the sale amount as quantity times unit price", () => {
  const report = baseReport([{ id: "line-1", productId: "p1", quantity: 3, unitPrice: 100, revenue: 300, cost: 210, profit: 90 }]);
  const presented = presentReportResponse({ type: "sales", productId: "p1" }, report);
  assert.equal(report.rows[0].unitPrice, 100, "accounting/source row must not be mutated");
  assert.deepEqual([presented.rows[0].unitPrice, presented.rows[0].cost, presented.rows[0].profit], [300, 210, 90]);
});

test("category-filtered sales receive the same line-total presentation", () => {
  const report = baseReport([{ id: "line-1", productId: "p1", quantity: 4, unitPrice: 125, revenue: 500, cost: 320, profit: 180 }]);
  const presented = presentReportResponse({ type: "sales", categoryId: "cat-1" }, report);
  assert.equal(presented.rows[0].unitPrice, 500);
});

test("unfiltered sales and other reports retain their original price semantics", () => {
  const sales = baseReport([{ id: "invoice-1", unitPrice: 100, revenue: 300 }]);
  assert.strictEqual(presentReportResponse({ type: "sales" }, sales), sales);
  const purchases = { ...sales, report: "purchases" };
  assert.strictEqual(presentReportResponse({ type: "purchases", productId: "p1" }, purchases), purchases);
});

test("missing legacy revenue never invents a sale total", () => {
  const report = baseReport([{ id: "legacy", quantity: 2, unitPrice: 100 }]);
  const presented = presentReportResponse({ type: "sales", productId: "legacy" }, report);
  assert.equal(presented.rows[0].unitPrice, 100);
});
