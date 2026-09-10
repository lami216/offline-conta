export type DateRangeIssue = "missing" | "invalid" | "reversed";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Shared guard for date-range actions that require both boundaries.
 * `null` means the range is safe to commit; otherwise the caller must keep
 * the current view unchanged and surface a validation message instead of
 * issuing a report/filter request with missing dates.
 */
export function validateRequiredDateRange(from: string, to: string): DateRangeIssue | null {
  const start = from.trim();
  const end = to.trim();
  if (!start || !end) return "missing";
  if (!isCalendarDate(start) || !isCalendarDate(end)) return "invalid";
  if (start > end) return "reversed";
  return null;
}
