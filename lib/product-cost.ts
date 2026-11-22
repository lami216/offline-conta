import type { DbDocument, SqliteDatabase, SqliteSession } from "./sqlite.ts";
import { resolveAdjustmentStockCost } from "./adjustment-stock-cost.ts";
import { reportCostNumber } from "./report-commerce.ts";
import { createHash } from "node:crypto";

const positiveCost = (value: unknown) => {
  const cost = reportCostNumber(value);
  return cost !== null && cost > 0 ? cost : null;
};

/** A mobile card owns its current valuation, unlike a native Desktop card.
 * Bind that imported snapshot to the unchanged acquisition history, so a real
 * Desktop purchase/cost correction takes over and its void can restore the basis.
 * Notes and customer sales never reprice either the source snapshot or old sales. */
export function mobileCostBasisSignature(productId: string, documents: DbDocument[]) {
  const rows = documents.filter(document => document.status === "posted" &&
    (document.kind === "purchase" || document.openingCorrection === true || String(document.number ?? "").startsWith("OPEN-")) &&
    Array.isArray(document.lines) && document.lines.some((line: DbDocument) => line.productId === productId))
    .map(document => ({ id: String(document.id), kind: String(document.kind), at: String(document.occurredAt), sequence: Number(document.sequence ?? 0),
      unit: reportCostNumber(document.openingCostAfter ?? document.lines.find((line: DbDocument) => line.productId === productId)?.unitPrice),
      quantity: reportCostNumber(document.lines.find((line: DbDocument) => line.productId === productId)?.quantity),
      opening: document.openingStockAfter ?? null }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** Source documents, rather than the editable card price or a stale cache, own cost. */
export function resolveProductCost(product: DbDocument, documents: DbDocument[]) {
  const relevant = documents.filter(document => document.status === "posted" &&
    Array.isArray(document.lines) && document.lines.some((line: DbDocument) => line.productId === product.id));
  const mobileCost = reportCostNumber(product.mobileImportedCurrentCost);
  if (product.mobileSource?.format === "alkarna-web-backup" && mobileCost !== null &&
    product.mobileImportedCostBasis === mobileCostBasisSignature(String(product.id), relevant)) {
    // Preserve the phone's current valuation even when it is zero. The command
    // lookup below still treats that zero as unknown for a future sale.
    return { cost: mobileCost, source: "legacy-opening", at: null };
  }
  // Stable sorting retains posting order for equal timestamps; newest is last.
  const purchases = relevant.filter(document => document.kind === "purchase").sort((a, b) =>
    String(a.occurredAt).localeCompare(String(b.occurredAt)) || Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
  const latest = purchases.at(-1);
  const purchaseCost = positiveCost(latest?.lines.find((line: DbDocument) => line.productId === product.id)?.unitPrice);
  if (purchaseCost !== null) return { cost: purchaseCost, source: "purchase", at: latest!.occurredAt };
  // A newer purchase with an unknown price supersedes older/opening evidence;
  // inventing an opening fallback here would persist a false sale snapshot.
  if (latest) return { cost: null, source: null, at: null };

  const openingDocuments = relevant.filter(document => document.openingCorrection === true || String(document.number ?? "").startsWith("OPEN-"));
  const opening = openingDocuments.at(-1);
  let openingCost = positiveCost(product.openingCost);
  if (!Object.hasOwn(product, "openingCost") && opening && (!Object.hasOwn(opening, "openingStockAfter") || positiveCost(opening.openingStockAfter) !== null)) {
    const savedCost = Object.hasOwn(opening, "openingCostAfter")
      ? opening.openingCostAfter
      : opening.lines.find((line: DbDocument) => line.productId === product.id)?.unitPrice;
    openingCost = positiveCost(savedCost);
  }
  if (openingCost !== null) return { cost: openingCost, source: "opening", at: null };
  const legacyCost = positiveCost(product.legacyOpeningCost);
  if (legacyCost !== null) return { cost: legacyCost, source: "legacy-opening", at: null };
  return { cost: null, source: null, at: null };
}

export async function currentProductCost(db: SqliteDatabase, session: SqliteSession, product: DbDocument, warehouseId?: string) {
  const documents = await db.collection("documents").find({ status: "posted", "lines.productId": product.id }, { session }).toArray();
  const result = resolveProductCost(product, documents);
  const values = { lastPurchaseCost: result.cost, lastPurchaseCostSource: result.source, lastPurchaseAt: result.at };
  await db.collection("products").updateOne({ id: product.id }, { $set: values }, { session });
  Object.assign(product, values);
  if (result.cost === 0 && product.mobileImportedCurrentCost === 0 &&
    product.mobileSource?.format === "alkarna-web-backup" && product.mobileImportedCostBasis === mobileCostBasisSignature(String(product.id), documents)) return null;
  if (result.cost !== null || !warehouseId || !(Number(product.stocks?.[warehouseId]) > 0)) return result.cost;
  const movements = await db.collection("stockMovements").find({ productId: product.id }, { session }).toArray();
  const documentIds = [...new Set(movements.filter(movement => movement.warehouseId === warehouseId).map(movement => movement.documentId).filter(id => typeof id === "string"))];
  if (!documentIds.length) return null;
  const stockDocuments = await db.collection("documents").find({ id: { $in: documentIds } }, { session }).toArray();
  return resolveAdjustmentStockCost({ productId: String(product.id), warehouseId, movements, documents: stockDocuments, currentStock: product.stocks[warehouseId] })?.unitCost ?? null;
}

export async function productsWithCurrentCosts(db: SqliteDatabase, products: DbDocument[], documents?: DbDocument[]): Promise<DbDocument[]> {
  const source = documents ?? await db.collection("documents").find({ status: "posted", kind: { $in: ["purchase", "adjustment"] } }).toArray();
  const byProduct = new Map<string, DbDocument[]>();
  for (const document of source) for (const productId of new Set<string>((document.lines ?? []).map((line: DbDocument) => String(line.productId)))) {
    const rows = byProduct.get(productId) ?? [];
    rows.push(document);
    byProduct.set(productId, rows);
  }
  return products.map(product => {
    const result = resolveProductCost(product, byProduct.get(String(product.id)) ?? []);
    return { ...product, lastPurchaseCost: result.cost, lastPurchaseCostSource: result.source, lastPurchaseAt: result.at };
  });
}
