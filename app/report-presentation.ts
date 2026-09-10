import type { ReportFilters, ReportResponse, ReportRow } from "./report-types";

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Report rows are accounting facts first, presentation rows second. In a filtered
 * sales drill-down the cost and profit columns are line totals, so the sale-value
 * slot must also be the line total (unit price × quantity), not the per-unit price.
 * The underlying persisted invoice remains untouched.
 */
export function presentReportResponse(filters: Pick<ReportFilters, "type" | "productId" | "categoryId">, report: ReportResponse): ReportResponse {
  if (filters.type !== "sales" || (!filters.productId && !filters.categoryId)) return report;
  const rows: ReportRow[] = report.rows.map(row => {
    const saleTotal = finite(row.revenue);
    return saleTotal === null ? row : { ...row, unitPrice: saleTotal };
  });
  return { ...report, rows };
}
