import type { ReportRow } from "../app/report-types.ts";
import { resolvePartyType } from "../app/domain.ts";
import { displayDocumentNumber } from "./document-sequences.ts";
import { movementStatement, statementNote } from "./movement-statement.ts";

type Stored = Record<string, unknown>;
type Period = { from?: string; to?: string };
type Ledger = { rows: ReportRow[]; summary: Record<string, string | number | boolean> };
const amount = (value: unknown) => Number(value ?? 0);
const finite = (value: unknown): number | null => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function activeCashMovement(document: Stored, movements: Stored[]) {
  const active = movements.filter(row => String(row.documentId) === String(document.id) &&
    (row.type === "party-receipt" || row.type === "party-payment") &&
    row.status !== "reversed" && row.isReversal !== true && row.reversalOfMovementId == null &&
    (row.direction === "in" || row.direction === "out") && (finite(row.amount) ?? 0) > 0);
  return active.length === 1 ? active[0] : null;
}

function paymentDirection(document: Stored, movement: Stored | null) {
  if (document.partyCashDirection === "receive" || document.partyCashDirection === "pay") return document.partyCashDirection;
  if (movement?.direction === "in") return "receive";
  if (movement?.direction === "out") return "pay";
  const title = String(document.title ?? "");
  if (/استلام|دفع لنا|الطرف دفع لنا/.test(title)) return "receive";
  if (/دفع للطرف|دفع لل|نحن دفعنا|صرف/.test(title)) return "pay";
  const saved = finite(document.partyBalanceDelta);
  return saved !== null && saved !== 0 ? saved < 0 ? "receive" : "pay" : null;
}

function partyEffect(document: Stored, parentKinds: ReadonlyMap<string, string>, movement: Stored | null) {
  const saved = finite(document.partyBalanceDelta);
  if (saved !== null) return saved;
  // Imported cross-party offsets can have explicit per-party contributions above.
  if (document.kind === "offset") return 0;
  if (document.kind === "sale") return amount(document.dueTotal);
  if (document.kind === "purchase") return -amount(document.dueTotal);
  if (document.kind === "return") return (parentKinds.get(String(document.parentDocumentId)) === "purchase" ? 1 : -1) *
    Math.max(0, amount(document.total) - amount(document.paidTotal));
  if (document.kind === "party-opening") {
    const contribution = finite(document.partyOpeningContribution);
    if (contribution !== null) return contribution;
    const opening = amount(document.partyOpeningAmount ?? document.total);
    return document.partyOpeningDirection === "payable" ? -opening : document.partyOpeningDirection === "receivable" ? opening : 0;
  }
  if (document.kind === "payment" && (document.partyCashDirection === "receive" || document.partyCashDirection === "pay")) return document.partyCashDirection === "receive" ? -amount(document.total) : amount(document.total);
  const before = finite(document.partyBalanceBefore), after = finite(document.partyBalanceAfter);
  if (before !== null && after !== null) return after - before;
  const receivable = finite(document.settledReceivable), payable = finite(document.settledPayable);
  if ((receivable ?? 0) !== 0 || (payable ?? 0) !== 0) return -(receivable ?? 0) + (payable ?? 0);
  if (movement && finite(movement.amount) !== null) return (movement.direction === "out" ? 1 : -1) * amount(movement.amount);
  // Retain the existing read-only convention for older payment/settlement titles.
  return String(document.title ?? "").includes("دفع لنا") ? -amount(document.total) : amount(document.total);
}

/** Replay current posted documents once; saved before/after snapshots may predate later edits. */
export function buildPartyLedger(party: Stored, documents: Stored[], parentKinds: ReadonlyMap<string, string>,
  movementsByDocument: ReadonlyMap<string, Stored[]> = new Map(), period: Period = {}): Ledger {
  const partyId = String(party.id), partyType = resolvePartyType(party), role = partyType === "customer" ? "العميل" : "المورد";
  const ordered = documents.filter(document => String(document.partyId) === partyId && document.status === "posted")
    .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)) ||
      Number(left.sequence ?? 0) - Number(right.sequence ?? 0) || String(left.id).localeCompare(String(right.id)));
  let running = 0, opening = 0, closing = 0, debit = 0, credit = 0, trade = 0, received = 0, paid = 0;
  const rows: ReportRow[] = [];
  for (const document of ordered) {
    const movement = activeCashMovement(document, movementsByDocument.get(String(document.id)) ?? []);
    const delta = partyEffect(document, parentKinds, movement), before = running;
    running += delta;
    const day = String(document.occurredAt ?? "").slice(0, 10);
    if (period.from && day < period.from) opening += delta;
    if (!period.to || day <= period.to) closing += delta;
    if ((period.from && day < period.from) || (period.to && day > period.to)) continue;
    const isReturn = document.kind === "return", purchaseReturn = isReturn && parentKinds.get(String(document.parentDocumentId)) === "purchase";
    if (partyType === "customer") trade += document.kind === "sale" ? amount(document.total) : isReturn && !purchaseReturn ? -amount(document.total) : 0;
    else trade += document.kind === "purchase" ? amount(document.total) : purchaseReturn ? -amount(document.total) : 0;
    if (document.kind === "payment") {
      const direction = paymentDirection(document, movement), cash = Math.max(0, amount(movement?.amount ?? document.cashAmount ?? document.total));
      if (direction === "receive") received += cash;
      if (direction === "pay") paid += cash;
    }
    const code = document.kind === "party-opening" ? "party-opening" : document.kind === "sale" ? "sale" : document.kind === "purchase" ? "purchase" :
      isReturn ? "return" : document.kind === "offset" ? "offset" : document.kind === "settlement" ? "settlement" :
      document.partyCashDirection === "receive" ? "party-receipt" : document.partyCashDirection === "pay" ? "party-payment" : "payment";
    const label = code === "party-opening" ? "رصيد بداية الديون" : code === "sale" ? "فاتورة بيع" : code === "purchase" ? "فاتورة شراء" :
      code === "return" ? "حركة تاريخية" : code === "offset" ? "مقاصة" : code === "settlement" ? "تسوية" :
      code === "party-receipt" ? `استلام من ${role}` : code === "party-payment" ? partyType === "customer" ? "دفع للعميل" : "دفع للمورد" : "دفعة";
    debit += Math.max(delta, 0); credit += Math.max(-delta, 0);
    rows.push({ id: String(document.id), documentId: String(document.id), partyId, party: String(party.name ?? ""), partyType,
      occurredAt: String(document.occurredAt), movementType: label, movementCode: code, documentNumber: displayDocumentNumber(document),
      note: statementNote(document), description: movementStatement(document, String(document.title ?? document.partyName ?? "")),
      descriptionCode: document.kind === "payment" && document.partyCashDirection ? code : "",
      debit: Math.max(delta, 0), credit: Math.max(-delta, 0), balanceBefore: before, balanceChange: delta, balanceAfter: running,
      balance: running, runningBalance: running, paymentMethod: String(document.paymentMethod ?? ""),
    });
  }
  const current = amount(party.receivable) - amount(party.payable);
  return { rows: rows.reverse(), summary: { name: String(party.name ?? ""), partyType, tradeTotal: trade,
    receivedTotal: received, paidTotal: paid, debitTotal: debit, creditTotal: credit, openingBalance: opening, closingBalance: closing,
    currentBalance: current, net: current, receivable: Math.max(current, 0), payable: Math.max(-current, 0),
    reconciliationDifference: current - running, transactionCount: rows.length,
  } };
}

/** Sum signed positions and each account's two debt sides separately, before any row paging. */
export function combinePartyLedgers(ledgers: Ledger[], partyType: string, selected: boolean) {
  const keys = ["tradeTotal", "receivedTotal", "paidTotal", "debitTotal", "creditTotal", "openingBalance", "closingBalance", "currentBalance", "net",
    "receivable", "payable", "reconciliationDifference", "transactionCount"];
  if (partyType === "employee") keys.push("workersAccrued", "workersPaid", "workersDeposited", "workersReserveReleased");
  const summary: Record<string, string | number | boolean> = { name: selected ? String(ledgers[0]?.summary.name ?? "") : "", partyType, partyCount: ledgers.length };
  for (const key of keys) summary[key] = ledgers.reduce((sum, ledger) => sum + amount(ledger.summary[key]), 0);
  summary.closingReceivable = ledgers.reduce((sum, ledger) => sum + Math.max(amount(ledger.summary.closingBalance), 0), 0);
  summary.closingPayable = ledgers.reduce((sum, ledger) => sum + Math.max(-amount(ledger.summary.closingBalance), 0), 0);
  summary.unreconciledAccounts = ledgers.filter(({ summary: account }) => {
    const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(Math.abs(amount(account.currentBalance)), Math.abs(amount(account.openingBalance)),
      Math.abs(amount(account.closingBalance)), amount(account.debitTotal) + amount(account.creditTotal)) * 16);
    return Math.abs(amount(account.reconciliationDifference)) > tolerance;
  }).length;
  return summary;
}
