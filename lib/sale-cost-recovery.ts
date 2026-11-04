import { createHash, randomUUID } from "node:crypto";
import type { DbDocument, SqliteDatabase } from "./sqlite.ts";
import { reportCostNumber, reportNetLines } from "./report-commerce.ts";
import { resolveAdjustmentStockCost } from "./adjustment-stock-cost.ts";
import { stockBalanceAfter } from "./stock-numbers.ts";

export const SALE_COST_RECOVERY_VERSION = 1;
export const SALE_COST_RECOVERY_SETTING = "sale-cost-recovery:v1";
const AUTOMATIC_PROOF_POLICY = 2;
type Row = DbDocument;
type Stored = { record_key: string; data_json: string; rowid: number; value: Row };
type Actor = { principalType: string; name: string; userId?: string };
type Source = { documentId: string; number: string; lineId: string; unitCost: number; kind: string; occurredAt: string; fingerprint: string; proof?: Row };
type Resolution = { source: Source | null; reason: string };
type Candidate = { document: Stored; line: Row; index: number; product: Row | undefined; state: "missing" | "invalid" | "saved-zero"; resolution: Resolution; token: string; lineId: string; revenue: number | null; reviewed: boolean };
type ClassifiedCandidate = Omit<Candidate, "resolution" | "token" | "revenue">;
export class SaleCostRecoveryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const lines = (document: Row): Row[] => Array.isArray(document.lines) ? document.lines.filter(record) : [];
const imported = (document: Row) => Boolean(document.legacyKey || document.legacy || document.importRunId || document.importedFrom || document.sourceType === "dataacc-sqlite");
const liquidEvidence = (line: Row) => Boolean(line.bottleProductId || line.perfumeAllocations || line.bottleAllocations || line.liquidQuantityMl !== undefined || line.fillMl !== undefined);
const generatedPerfumeEvidence = (product: Row) =>
  (Array.isArray(product.perfumeLots) && product.perfumeLots.length > 0) ||
  Boolean(text(product.parentProductId) || text(product.sourceProductId)) ||
  product.perfumeStockUnit === "ml" ||
  ["decantSizeMl", "partialVolumeMl", "partialRemainingParts", "partialOriginalParts", "legacyDecantUnitMl", "decantPriceBasisMl"].some(key => product[key] !== undefined && product[key] !== null);
// Old generated products may predate perfumeForm. Their lot/link/unit evidence
// still owns cost; ordinary bottle volume metadata alone does not make a derivative.
const ordinary = (product: Row | undefined, line: Row) => Boolean(product && !["decant", "bottle", "partial"].includes(String(product.perfumeForm)) && !generatedPerfumeEvidence(product) && !liquidEvidence(line));
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const revision = (document: Row) => Number.isSafeInteger(Number(document.revision ?? 0)) && Number(document.revision ?? 0) >= 0 ? Number(document.revision ?? 0) : null;
function readRows(db: SqliteDatabase, table: "documents" | "products" | "app_settings" | "audit_events") {
  const where = table === "audit_events" ? " WHERE json_extract(data_json,'$.action')='sale-cost-recovery.confirm' AND json_extract(data_json,'$.version')=1" : "";
  return (db.native.prepare(`SELECT record_key,data_json,rowid FROM ${table}${where} ORDER BY rowid`).all() as Omit<Stored, "value">[]).map(row => ({ ...row, value: JSON.parse(row.data_json) as Row }));
}
function snapshot(db: SqliteDatabase, includeFingerprint = true) {
  const documents = readRows(db, "documents"), products = readRows(db, "products");
  const reviewedZeros = new Set<string>();
  for (const { value: event } of readRows(db, "audit_events")) {
    if (event.action !== "sale-cost-recovery.confirm" || event.version !== SALE_COST_RECOVERY_VERSION || !["owner", "local"].includes(String(event.actor?.principalType)) || !record(event.afterDocument)) continue;
    const savedLine = event.afterDocument.lines?.[event.lineIndex];
    if (!record(savedLine) || savedLine.saleCostRecovery?.action !== "confirm-zero" || reportCostNumber(savedLine.costAtSale) !== 0) continue;
    reviewedZeros.add(zeroIdentity(event.afterDocument, savedLine, String(event.lineId)));
  }
  const sources = new Map<string, Stored[]>();
  for (const document of documents) if (document.value.kind === "purchase" || document.value.kind === "adjustment") {
    for (const productId of new Set(lines(document.value).map(line => String(line.productId)))) {
      const rows = sources.get(productId) ?? []; rows.push(document); sources.set(productId, rows);
    }
  }
  return { documents, sources, reviewedZeros, products: new Map(products.map(row => [String(row.value.id), row.value])), fingerprint: includeFingerprint ? hash([SALE_COST_RECOVERY_VERSION, documents.map(row => [row.record_key, row.data_json]), products.map(row => [row.record_key, row.data_json])]) : undefined };
}
const zeroIdentity = (document: Row, line: Row, lineId: string) => hash([document.id, document.occurredAt, lineId, line.productId, line.costAtSale, line.quantity, line.unitPrice, line.lineTotal]);
function saleRevenue(document: Row, index: number) {
  const all = lines(document), total = reportCostNumber(document.total), amounts = all.map(line => reportCostNumber(line.lineTotal));
  if (all.length !== document.lines?.length || total === null || amounts.some(amount => amount === null) || total > amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) + 1e-7) return null;
  return reportCostNumber(reportNetLines(document)[index]?.lineTotal);
}

function purchaseQuantity(document: Row, line: Row, cost: number) {
  const all = lines(document), quantity = reportCostNumber(line.quantity);
  const amount = reportCostNumber(line.lineTotal), total = reportCostNumber(document.total);
  if (all.length !== document.lines?.length || quantity === null || quantity <= 0 || amount === null || total === null) return null;
  const amounts = all.map(item => reportCostNumber(item.lineTotal));
  if (amounts.some(value => value === null)) return null;
  const sum = amounts.reduce<number>((value, item) => value + (item ?? 0), 0);
  return Math.abs(amount - Math.round(quantity * cost)) <= 1e-7 && Math.abs(total - sum) <= 1e-7 ? quantity : null;
}

/** Recovery needs stronger proof than a read-only report estimate. Never consult
 * today's product price/cache, skip an unknown newest source, or infer imported chronology. */
function resolveSource(documents: Stored[], sale: Stored, line: Row): Resolution {
  const at = timestamp(sale.value.occurredAt);
  if (!at || imported(sale.value)) return { source: null, reason: "unsupported-import-or-date" };
  const relevant = documents.filter(row => lines(row.value).some(item => item.productId === line.productId));
  // The live cost resolver can see a source posted before the sale even when its
  // business date was malformed/backdated. Such contradictory chronology is not
  // permission to hydrate a cheaper older/opening cost.
  if (relevant.some(row => row.value.kind === "purchase" && row.rowid < sale.rowid && (!timestamp(row.value.occurredAt) || String(row.value.occurredAt) > at))) return { source: null, reason: "source-history-unproven" };
  const prior = (row: Stored) => Boolean(timestamp(row.value.occurredAt) && String(row.value.occurredAt) <= at);
  const purchases = relevant.filter(row => row.value.kind === "purchase" && prior(row));
  const openings = relevant.filter(row => row.value.kind === "adjustment" && (row.value.openingCorrection === true || /^OPEN-(?!COR)/.test(String(row.value.number ?? ""))) && prior(row));
  const sources = purchases.length ? purchases : openings;
  sources.sort((a, b) => String(a.value.occurredAt).localeCompare(String(b.value.occurredAt)) || Number(a.value.sequence ?? 0) - Number(b.value.sequence ?? 0));
  const latest = sources.at(-1);
  if (!latest) return { source: null, reason: "no-prior-source" };
  const ties = sources.filter(row => row.value.occurredAt === latest.value.occurredAt && Number(row.value.sequence ?? 0) === Number(latest.value.sequence ?? 0));
  if (ties.length !== 1) return { source: null, reason: "ambiguous-source-order" };
  // A purchase canceled after the sale can still have determined its original
  // missing snapshot. Falling back to older/opening cost would silently reprice it.
  if (latest.value.status !== "posted") return { source: null, reason: "source-history-unproven" };
  if (latest.rowid >= sale.rowid) return { source: null, reason: "source-posted-after-sale" };
  if (imported(latest.value) || Number(latest.value.revision ?? 0) !== 0 || (latest.value.updatedAt && String(latest.value.updatedAt) > at)) return { source: null, reason: "source-history-unproven" };
  const matching = lines(latest.value).filter(item => item.productId === line.productId);
  if (matching.length !== 1 || liquidEvidence(matching[0])) return { source: null, reason: "ambiguous-source-line" };
  const sourceLine = matching[0];
  const savedCost = latest.value.kind === "purchase" || !Object.hasOwn(latest.value, "openingCostAfter") ? sourceLine.unitPrice : latest.value.openingCostAfter;
  const unitCost = reportCostNumber(savedCost);
  if (unitCost === null || unitCost <= 0) return { source: null, reason: "latest-source-cost-unknown" };
  if (latest.value.kind === "purchase") {
    if (purchaseQuantity(latest.value, sourceLine, unitCost) === null) return { source: null, reason: "source-values-unproven" };
  } else {
    // A stale price on a zero/cleared opening is not evidence that stock existed.
    // Correction deltas may be negative, so prefer its saved absolute target.
    const quantity = reportCostNumber(Object.hasOwn(latest.value, "openingStockAfter") ? latest.value.openingStockAfter : sourceLine.quantity);
    if (quantity === null || quantity <= 0) return { source: null, reason: "source-values-unproven" };
  }
  return { source: { documentId: String(latest.value.id), number: String(latest.value.number ?? ""), lineId: String(sourceLine.id ?? ""), unitCost, kind: String(latest.value.kind), occurredAt: String(latest.value.occurredAt), fingerprint: hash(latest.value) }, reason: "proven-prior-source" };
}
/** Counts and pagination need eligibility only, never source resolution per sale. */
function candidates(state: ReturnType<typeof snapshot>): ClassifiedCandidate[] {
  const result: ClassifiedCandidate[] = [];
  for (const document of state.documents) {
    const sale = document.value;
    if (sale.kind !== "sale" || sale.status !== "posted" || !Array.isArray(sale.lines) || revision(sale) === null) continue;
    for (let index = 0; index < sale.lines.length; index++) {
      const line = sale.lines[index];
      if (!record(line)) continue;
      const cost = reportCostNumber(line.costAtSale), product = state.products.get(String(line.productId));
      if (!ordinary(product, line) || (cost !== null && cost > 0)) continue;
      const stateName = cost === 0 ? "saved-zero" : line.costAtSale === null || line.costAtSale === undefined ? "missing" : "invalid";
      const lineId = text(line.id) && sale.lines.filter((item: Row) => item?.id === line.id).length === 1 ? text(line.id) : `legacy-index:${index}`;
      // General invoice edits may omit additive line metadata. The durable owner
      // journal remains authoritative while the complete saved stock/price tuple agrees.
      const reviewed = cost === 0 && state.reviewedZeros.has(zeroIdentity(sale, line, lineId));
      result.push({ document, line, index, product, state: stateName, lineId, reviewed });
    }
  }
  return result;
}
/** Keep the original source proof and token inputs exact; resolve only used rows. */
function resolveCandidate(state: ReturnType<typeof snapshot>, candidate: ClassifiedCandidate): Candidate {
  const { document, line, index, product } = candidate, sale = document.value;
  const quantity = reportCostNumber(line.quantity), revenue = saleRevenue(sale, index);
  let resolution = quantity === null || quantity <= 0 || revenue === null ? { source: null, reason: "sale-values-unproven" } : resolveSource(state.sources.get(String(line.productId)) ?? [], document, line);
  if (resolution.source && !Number.isFinite(Number(line.quantity) * resolution.source.unitCost)) resolution = { source: null, reason: "sale-values-unproven" };
  const token = hash([SALE_COST_RECOVERY_VERSION, sale, index, product?.perfumeForm ?? null, resolution]);
  return { ...candidate, resolution, token, revenue };
}

function groupRows(rows: Stored[], field: string) {
  const groups = new Map<string, Stored[]>();
  for (const row of rows) {
    const key = text(row.value[field]);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function readProofRows(db: SqliteDatabase, query: string, ...keys: Set<string>[]) {
  return (db.native.prepare(query).all(...keys.map(key => JSON.stringify([...key]))) as Omit<Stored, "value">[])
    .map(row => ({ ...row, value: JSON.parse(row.data_json) as Row }));
}

function automaticEvidence(db: SqliteDatabase, state: ReturnType<typeof snapshot>, candidates: ClassifiedCandidate[]) {
  const productIds = new Set<string>(), saleIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.state !== "missing" || imported(candidate.document.value) || !text(candidate.line.id)) continue;
    productIds.add(text(candidate.line.productId));
    saleIds.add(text(candidate.document.value.id));
  }
  const movements = productIds.size ? readProofRows(db, `
    SELECT record_key,data_json,rowid FROM stock_movements
    WHERE json_extract(data_json,'$.productId') IN (SELECT value FROM json_each(?))
       OR json_extract(data_json,'$.documentId') IN (SELECT value FROM json_each(?))
    ORDER BY rowid`, productIds, saleIds) : [];
  const documentIds = new Set(movements.map(row => text(row.value.documentId)));
  for (const id of saleIds) documentIds.add(id);
  const audits = documentIds.size ? readProofRows(db, `
    SELECT record_key,data_json,rowid FROM audit_events
    WHERE json_extract(data_json,'$.entityId') IN (SELECT value FROM json_each(?))
      AND json_extract(data_json,'$.status')='committed'
      AND json_extract(data_json,'$.action') IN ('sale.post','sale.update','sale.void','purchase.post','purchase.update','purchase.void')
    ORDER BY rowid`, documentIds) : [];
  return {
    documents: groupRows(state.documents.filter(row => documentIds.has(text(row.value.id))), "id"),
    productMoves: groupRows(movements, "productId"),
    documentMoves: groupRows(movements, "documentId"),
    audits: groupRows(audits, "entityId"),
    fingerprint: hash([AUTOMATIC_PROOF_POLICY, state.fingerprint, movements.map(row => [row.record_key, row.data_json]), audits.map(row => [row.record_key, row.data_json])]),
  };
}

type AutomaticEvidence = ReturnType<typeof automaticEvidence>;
type DebitProof = { movement: Stored; audit: Stored; basis: "original-debit" | "edit-introduction" };
const nativeRecord = (row: Stored) => row.value.id === row.record_key && (row.value._id === undefined || row.value._id === row.record_key) && !imported(row.value);
const movementQuantity = (row: Row) => typeof row.quantityDelta === "number" && Number.isFinite(row.quantityDelta) ? row.quantityDelta : null;

function coherentMovement(row: Stored) {
  const { balanceBefore, balanceAfter } = row.value;
  const delta = movementQuantity(row.value);
  return nativeRecord(row) && typeof balanceBefore === "number" && typeof balanceAfter === "number" &&
    Number.isFinite(balanceBefore) && Number.isFinite(balanceAfter) && balanceBefore >= 0 && balanceAfter >= 0 &&
    delta !== null && stockBalanceAfter(balanceBefore, delta) === balanceAfter;
}

/** A debit is tied to the actual posting revision. A later header-only edit has
 * no stock row, but still needs its corresponding committed update receipt. */
function proveDebit(evidence: AutomaticEvidence, candidate: Candidate): DebitProof | null {
  const { document, line, lineId } = candidate, sale = document.value;
  const allMoves = evidence.documentMoves.get(sale.id) ?? [];
  const targetMoves = allMoves.filter(row => row.value.productId === line.productId);
  const movement = targetMoves[0], value = movement?.value;
  const at = timestamp(sale.occurredAt), debitAt = timestamp(value?.occurredAt), currentRevision = revision(sale);
  if (!nativeRecord(document) || !at || !debitAt || currentRevision === null || targetMoves.length !== 1 ||
      evidence.documents.get(sale.id)?.length !== 1 || !text(line.id) || lineId !== line.id ||
      lines(sale).filter(item => item.productId === line.productId).length !== 1 ||
      !text(sale.warehouseId) || value.warehouseId !== sale.warehouseId || value.documentNumber !== sale.number ||
      !coherentMovement(movement) || movementQuantity(value) !== -Number(line.quantity)) return null;
  const moveRevision = value.documentRevision;
  if (!Number.isSafeInteger(moveRevision) || moveRevision < 0 || moveRevision > currentRevision) return null;
  const audits = evidence.audits.get(sale.id) ?? [];
  if (audits.length !== currentRevision + 1) return null;
  let previous = at;
  for (const [index, audit] of audits.entries()) {
    const committedAt = timestamp(audit.value.createdAt);
    if (!nativeRecord(audit) || audit.value.action !== (index === 0 ? "sale.post" : "sale.update") ||
        !committedAt || committedAt < previous || (index > 0 && committedAt === previous)) return null;
    previous = committedAt;
  }
  if (currentRevision > 0 && (!timestamp(sale.updatedAt) || sale.updatedAt > previous ||
      sale.updatedAt <= audits.at(-2)!.value.createdAt)) return null;
  // Each revision may affect several SKUs. Check the whole stock family, including
  // the original debit of the different SKU on an edited addition.
  const seen = new Set<string>();
  let originals = 0, previousRevision = 0;
  for (const row of allMoves) {
    const item = row.value, itemRevision = item.documentRevision;
    const when = timestamp(item.occurredAt);
    const key = JSON.stringify([itemRevision, item.productId]);
    if (!Number.isSafeInteger(itemRevision) || itemRevision < previousRevision || itemRevision > currentRevision ||
        !text(item.productId) || seen.has(key) || !coherentMovement(row) || !when ||
        item.warehouseId !== sale.warehouseId || item.documentNumber !== sale.number ||
        when > audits[itemRevision].value.createdAt || movementQuantity(item) === 0) return null;
    if (itemRevision === 0) {
      if (item.type !== "sale" || when !== at || movementQuantity(item)! >= 0) return null;
      originals++;
    } else if (item.type !== "sale-edit" || when <= audits[itemRevision - 1].value.createdAt) return null;
    seen.add(key);
    previousRevision = itemRevision;
  }
  if (!originals) return null;
  return { movement, audit: audits[moveRevision], basis: moveRevision === 0 ? "original-debit" : "edit-introduction" };
}

/** An edited addition can use its own receipt only when it is the single native
 * purchase for the SKU and its entire warehouse balance came from that receipt. */
function adjacentPurchase(state: ReturnType<typeof snapshot>, evidence: AutomaticEvidence, candidate: Candidate, debit: DebitProof): Source | null {
  const { line, document } = candidate, sale = document.value, movement = debit.movement.value;
  const purchases = (state.sources.get(line.productId) ?? []).filter(row => row.value.kind === "purchase");
  if (purchases.length !== 1) return null;
  const purchase = purchases[0], source = purchase.value;
  const purchaseAt = timestamp(source.occurredAt);
  if (!nativeRecord(purchase) || evidence.documents.get(source.id)?.length !== 1 ||
      source.status !== "posted" || revision(source) !== 0 || source.warehouseId !== sale.warehouseId ||
      !purchaseAt || purchaseAt <= sale.occurredAt) return null;
  const matching = lines(source).filter(item => item.productId === line.productId);
  const sourceLine = matching[0], cost = reportCostNumber(sourceLine?.unitPrice);
  if (matching.length !== 1 || !text(sourceLine.id) || liquidEvidence(sourceLine) || cost === null || cost <= 0) return null;
  const quantity = purchaseQuantity(source, sourceLine, cost);
  if (quantity === null) return null;
  const productMoves = evidence.productMoves.get(line.productId) ?? [];
  const receipt = productMoves.findLast(row => row.rowid < debit.movement.rowid && row.value.warehouseId === sale.warehouseId);
  if (!receipt || !coherentMovement(receipt)) return null;
  const saved = receipt.value;
  if (saved.documentId !== source.id || saved.documentNumber !== source.number || saved.type !== "purchase" ||
      saved.documentRevision !== 0 || saved.occurredAt !== purchaseAt || saved.balanceBefore !== 0 ||
      saved.balanceAfter !== quantity || saved.quantityDelta !== quantity || movement.balanceBefore !== quantity ||
      (evidence.documentMoves.get(source.id) ?? []).filter(row => row.value.productId === line.productId).length !== 1) return null;
  const audits = evidence.audits.get(source.id) ?? [];
  const audit = audits[0], committedAt = timestamp(audit?.value.createdAt);
  const originalPost = evidence.audits.get(sale.id)![0];
  if (audits.length !== 1 || !nativeRecord(audit) || audit.value.action !== "purchase.post" || !committedAt ||
      purchaseAt <= originalPost.value.createdAt || committedAt < purchaseAt || committedAt >= movement.occurredAt ||
      audit.rowid <= originalPost.rowid || audit.rowid >= debit.audit.rowid ||
      (source.updatedAt && (!timestamp(source.updatedAt) || source.updatedAt > committedAt))) return null;
  const proof = { basis: debit.basis, debitMovementId: movement.id, debitAt: movement.occurredAt,
    saleRevision: movement.documentRevision, saleAuditId: debit.audit.value.id, receiptMovementId: saved.id, purchaseAuditId: audit.value.id };
  return { documentId: source.id, number: String(source.number ?? ""), lineId: sourceLine.id, unitCost: cost,
    kind: "purchase", occurredAt: purchaseAt, fingerprint: hash([source, saved, movement, audit.value, debit.audit.value]), proof };
}

function resolveAutomatic(state: ReturnType<typeof snapshot>, evidence: AutomaticEvidence, candidate: Candidate): Candidate {
  if (candidate.state !== "missing" || candidate.revenue === null || imported(candidate.document.value)) return candidate;
  const { document, line } = candidate;
  const targetMoves = (evidence.documentMoves.get(document.value.id) ?? []).filter(row => row.value.productId === line.productId);
  const addedByEdit = targetMoves.some(row => row.value.type === "sale-edit") &&
    !targetMoves.some(row => row.value.type === "sale" && row.value.documentRevision === 0);
  if (!addedByEdit && candidate.resolution.source) return candidate;
  const debit = proveDebit(evidence, candidate);
  if (!debit) return addedByEdit ? { ...candidate, resolution: { source: null, reason: "edit-introduction-unproven" } } : candidate;
  let source = debit.basis === "edit-introduction" ? adjacentPurchase(state, evidence, candidate, debit) : null;
  if (!source) {
    const movements = evidence.productMoves.get(line.productId) ?? [];
    const ids = new Set(movements.map(row => text(row.value.documentId)));
    const documents = [...ids].flatMap(id => (evidence.documents.get(id) ?? []).map(row => row.value));
    const adjustment = resolveAdjustmentStockCost({
      productId: line.productId, warehouseId: document.value.warehouseId,
      movements: movements.map(row => row.value), documents, debitMovementId: debit.movement.value.id,
    });
    if (adjustment) {
      source = { ...adjustment, fingerprint: hash([adjustment, debit.movement.value, debit.audit.value]),
        proof: { basis: "stock-adjustment", debitBasis: debit.basis, debitMovementId: debit.movement.value.id,
          debitAt: debit.movement.value.occurredAt, saleRevision: debit.movement.value.documentRevision, saleAuditId: debit.audit.value.id,
          receiptMovementId: adjustment.movementId } };
    }
  }
  if (!source || !Number.isFinite(Number(line.quantity) * source.unitCost)) {
    return addedByEdit ? { ...candidate, resolution: { source: null, reason: "edit-introduction-unproven" } } : candidate;
  }
  return { ...candidate, resolution: { source, reason: "proven-native-stock-debit" } };
}
function setting(db: SqliteDatabase) { const row = db.native.prepare("SELECT data_json FROM app_settings WHERE record_key=?").get(SALE_COST_RECOVERY_SETTING) as { data_json: string } | undefined; return row ? JSON.parse(row.data_json) as Row : null; }
function saveSetting(db: SqliteDatabase, value: Row) { db.native.prepare("INSERT INTO app_settings(record_key,data_json) VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET data_json=excluded.data_json").run(SALE_COST_RECOVERY_SETTING, JSON.stringify({ ...value, id: SALE_COST_RECOVERY_SETTING, _id: SALE_COST_RECOVERY_SETTING })); }
function journal(db: SqliteDatabase, action: string, beforeDocument: Row, afterDocument: Row, candidate: Candidate, actor: Actor, reason: string, ownerReviewed = false) {
  const id = `sale-cost-recovery-${randomUUID()}`;
  db.native.prepare("INSERT INTO audit_events(record_key,data_json) VALUES(?,?)").run(id, JSON.stringify({ id, _id: id, action, version: SALE_COST_RECOVERY_VERSION, status: "committed", createdAt: new Date().toISOString(), entityId: beforeDocument.id, lineId: candidate.lineId, lineIndex: candidate.index, actor, reason, sourceType: ownerReviewed ? "owner-reviewed" : "proven-prior-source", source: ownerReviewed ? null : candidate.resolution.source, beforeDocument, afterDocument }));
}
function apply(db: SqliteDatabase, candidate: Candidate, cost: number, actor: Actor, action: "automatic" | "apply-suggested" | "confirm-zero" | "set-reviewed-cost", reason: string) {
  const before = candidate.document.value, after = structuredClone(before), line = after.lines[candidate.index];
  if (!Number.isFinite(Number(line.quantity) * cost) || !Number.isFinite(candidate.revenue! - Number(line.quantity) * cost)) throw new SaleCostRecoveryError("تكلفة الوحدة التي راجعتها يجب أن تكون رقمًا موجبًا صالحًا");
  line.costAtSale = cost;
  line.grossProfit = candidate.revenue! - Number(line.quantity) * cost;
  const ownerReviewed = action === "set-reviewed-cost" || action === "confirm-zero";
  line.saleCostRecovery = { version: SALE_COST_RECOVERY_VERSION, action, at: new Date().toISOString(), sourceType: ownerReviewed ? "owner-reviewed" : "proven-prior-source", sourceDocumentId: ownerReviewed ? null : candidate.resolution.source?.documentId ?? null, snapshot: hash([line.costAtSale, line.quantity, line.unitPrice, line.lineTotal]) };
  // Automatic hydration leaves business and revision timestamps intact. An explicit
  // owner correction is a revision, but never a replacement stock/financial posting.
  if (action !== "automatic") { after.revision = Number(before.revision ?? 0) + 1; after.updatedAt = new Date().toISOString(); }
  journal(db, action === "automatic" ? "sale-cost-recovery.automatic" : "sale-cost-recovery.confirm", before, after, candidate, actor, reason, ownerReviewed);
  const updated = db.native.prepare("UPDATE documents SET data_json=? WHERE record_key=? AND data_json=?").run(JSON.stringify(after), candidate.document.record_key, candidate.document.data_json);
  if (updated.changes !== 1) throw new SaleCostRecoveryError("تغيرت الفاتورة أثناء مراجعة التكلفة؛ حدّث القائمة وأعد المحاولة", 409);
  candidate.document.data_json = JSON.stringify(after); candidate.document.value = after;
  return after;
}
function atomic<T>(db: SqliteDatabase, work: () => T): T {
  if (db.native.inTransaction) {
    const point = `sale_cost_recovery_${randomUUID().replaceAll("-", "")}`;
    db.native.exec(`SAVEPOINT ${point}`);
    try { const result = work(); db.native.exec(`RELEASE SAVEPOINT ${point}`); return result; }
    catch (error) { db.native.exec(`ROLLBACK TO SAVEPOINT ${point}`); db.native.exec(`RELEASE SAVEPOINT ${point}`); throw error; }
  }
  db.native.exec("BEGIN IMMEDIATE");
  try { const result = work(); db.native.exec("COMMIT"); return result; }
  catch (error) { if (db.native.inTransaction) db.native.exec("ROLLBACK"); throw error; }
}

/** Runs once per changed dataset, inside a single SQLite transaction. The durable
 * before-image journal and marker travel with native backups; no external profile is read. */
export function recoverHistoricalSaleCosts(db: SqliteDatabase, options: { context?: string } = {}) {
  return atomic(db, () => {
    const state = snapshot(db), prior = setting(db);
    const classified = candidates(state);
    const evidence = automaticEvidence(db, state, classified);
    if (prior?.version === SALE_COST_RECOVERY_VERSION && prior.fingerprint === evidence.fingerprint) return summary(db, classified);
    let recovered = 0;
    for (const row of classified) {
      if (row.state === "saved-zero") continue;
      const candidate = resolveAutomatic(state, evidence, resolveCandidate(state, row));
      if (!candidate.resolution.source || candidate.revenue === null) continue;
      apply(db, candidate, candidate.resolution.source.unitCost, { principalType: "system", name: "safe-cost-recovery" }, "automatic",
        candidate.resolution.source.proof ? "proven-native-stock-debit" : "proven-prior-native-source");
      recovered++;
    }
    // An untouched dataset needs no migration metadata. In particular, restoring
    // a backup without a recovery marker must preserve its settings byte-for-byte.
    if (recovered === 0 && !prior) return summary(db, classified);
    const final = snapshot(db), remaining = candidates(final);
    const fingerprint = recovered ? automaticEvidence(db, final, remaining).fingerprint : evidence.fingerprint;
    saveSetting(db, { version: SALE_COST_RECOVERY_VERSION, fingerprint, automaticRecovered: Number(prior?.automaticRecovered ?? 0) + recovered, lastRecovered: recovered, completedAt: new Date().toISOString(), context: options.context ?? "startup" });
    return summary(db, remaining);
  });
}
export function readSaleCostRecoverySummary(db: SqliteDatabase) {
  return summary(db, candidates(snapshot(db, false)));
}
function summary(db: SqliteDatabase, all: ClassifiedCandidate[]) {
  const rows = all.filter(row => !row.reviewed);
  return { automaticRecovered: Number(setting(db)?.automaticRecovered ?? 0), unresolved: rows.filter(row => row.state !== "saved-zero").length, savedZeroReview: rows.filter(row => row.state === "saved-zero").length, reviewedZero: all.filter(row => row.reviewed).length };
}
export function accountingHealth(db: SqliteDatabase, options: { page?: number; pageSize?: number } = {}) {
  const page = options.page ?? 1, pageSize = options.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new SaleCostRecoveryError("إعدادات صفحة مراجعة التكاليف غير صالحة");
  const state = snapshot(db, false), candidatesAll = candidates(state), all = candidatesAll.filter(row => !row.reviewed);
  const rows = all.slice((page - 1) * pageSize, page * pageSize).map(row => resolveCandidate(state, row)).map(row => ({ documentId: String(row.document.value.id), number: String(row.document.value.number ?? ""), lineId: row.lineId, lineIndex: row.index, productId: String(row.line.productId), productName: String(row.product?.name ?? row.line.description ?? ""), occurredAt: String(row.document.value.occurredAt ?? ""), revision: Number(row.document.value.revision ?? 0), originalCost: row.line.costAtSale ?? null, costState: row.state, suggestedPriorCost: row.resolution.source?.unitCost ?? null, sourceDocumentId: row.resolution.source?.documentId ?? null, sourceNumber: row.resolution.source?.number ?? null, reason: row.resolution.reason, canApplySuggested: row.resolution.source !== null && row.revenue !== null, canConfirmZero: row.revenue !== null && (reportCostNumber(row.line.quantity) ?? 0) > 0, canSetReviewedCost: row.revenue !== null && (reportCostNumber(row.line.quantity) ?? 0) > 0, reviewToken: row.token }));
  return { version: SALE_COST_RECOVERY_VERSION, summary: summary(db, candidatesAll), rows, pagination: { page, pageSize, totalRows: all.length, totalPages: Math.max(1, Math.ceil(all.length / pageSize)) } };
}
export function confirmSaleCostRecovery(db: SqliteDatabase, body: Row, actor: Actor) {
  if (!["owner", "local"].includes(actor.principalType)) throw new SaleCostRecoveryError("مراجعة تكاليف المبيعات متاحة للمالك فقط", 403);
  const action = text(body.action), reason = text(body.reason);
  if (!["apply-suggested", "confirm-zero", "set-reviewed-cost"].includes(action) || !reason || reason.length > 1000) throw new SaleCostRecoveryError("اختر إجراء المراجعة واكتب سببًا واضحًا لا يتجاوز 1000 حرف");
  const reviewedCost = reportCostNumber(body.reviewedUnitCost);
  if (action === "set-reviewed-cost" && (reviewedCost === null || reviewedCost <= 0)) throw new SaleCostRecoveryError("تكلفة الوحدة التي راجعتها يجب أن تكون رقمًا موجبًا صالحًا");
  return atomic(db, () => {
    const state = snapshot(db), classified = candidates(state).find(row => String(row.document.value.id) === text(body.documentId) && row.lineId === text(body.lineId));
    if (!classified || classified.reviewed) throw new SaleCostRecoveryError("السطر غير متاح لمراجعة التكلفة أو تمت مراجعته بالفعل", 409);
    const candidate = resolveCandidate(state, classified);
    if (typeof body.expectedRevision !== "number" || body.expectedRevision !== revision(candidate.document.value) || text(body.reviewToken) !== candidate.token) throw new SaleCostRecoveryError("تغيرت الفاتورة أو مصدر التكلفة؛ حدّث قائمة المراجعة وأعد المحاولة", 409);
    if (candidate.revenue === null || (reportCostNumber(candidate.line.quantity) ?? 0) <= 0) throw new SaleCostRecoveryError("بيانات مبلغ أو كمية البيع غير مكتملة؛ لا يمكن اعتماد التكلفة آليًا", 409);
    if (action === "apply-suggested" && !candidate.resolution.source) throw new SaleCostRecoveryError("لا يوجد مصدر تكلفة تاريخي مؤكد لهذا السطر؛ لا يمكن تخمين التكلفة", 409);
    const cost = action === "confirm-zero" ? 0 : action === "set-reviewed-cost" ? reviewedCost! : candidate.resolution.source!.unitCost;
    const after = apply(db, candidate, cost, actor, action as "apply-suggested" | "confirm-zero" | "set-reviewed-cost", reason);
    const prior = setting(db) ?? {};
    saveSetting(db, { ...prior, version: SALE_COST_RECOVERY_VERSION, fingerprint: snapshot(db).fingerprint, completedAt: new Date().toISOString() });
    return { id: String(after.id), lineId: candidate.lineId, costAtSale: cost, revision: Number(after.revision ?? 0), action };
  });
}
