import type { SqliteDatabase as Db, SqliteSession as ClientSession, DbDocument as Document } from "./sqlite.ts";

const finite = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const positive = (value: unknown) => {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
};

export type OpeningStockState = {
  total: number;
  remaining: number;
  consumed: number;
  allocations: Record<string, number>;
  warehouseId: string | null;
  cost: number | null;
  hasNativeOpening: boolean;
  hasStockHistory: boolean;
  legacySnapshot: boolean;
  consumptionByDocument: Record<string, Record<string, number>>;
};

function take(allocation: Record<string, number>, warehouseId: string, quantity: number) {
  const available = Math.max(0, Number(allocation[warehouseId] ?? 0));
  const used = Math.min(Math.max(0, quantity), available);
  allocation[warehouseId] = available - used;
  return used;
}
function add(allocation: Record<string, number>, warehouseId: string, quantity: number) {
  if (quantity <= 0) return;
  allocation[warehouseId] = Math.max(0, Number(allocation[warehouseId] ?? 0)) + quantity;
}

/**
 * Rebuilds native opening-stock provenance from the complete stock movement history.
 * Legacy DataAcc `legacy-opening` rows are intentionally excluded: they are imported
 * current-balance snapshots, not editable native opening balances.
 */
export async function deriveOpeningStockState(db: Db, session: ClientSession | undefined, product: Document): Promise<OpeningStockState> {
  const productId = String(product.id ?? "");
  if (!productId) return { total: 0, remaining: 0, consumed: 0, allocations: {}, warehouseId: null, cost: null, hasNativeOpening: false, hasStockHistory: false, legacySnapshot: false, consumptionByDocument: {} };
  // Replay insertion order. Edits/voids retain the invoice's original occurredAt,
  // so sorting by that date would move today's correction into the past.
  const movements = await db.collection("stockMovements").find({ productId }, { session }).toArray();
  const hasNativeOpening = movements.some(movement => movement.type === "opening" || movement.type === "opening-void" || String(movement.type ?? "").startsWith("opening-correction"));
  const hasStockHistory = movements.length > 0;
  const legacySnapshot = movements.some(movement => movement.type === "legacy-opening") || positive(product.legacyOpeningCost) !== null;
  const openingDocumentIds = [...new Set(movements.filter(movement => movement.type === "opening").map(movement => String(movement.documentId ?? "")).filter(Boolean))];
  const openingDocuments = openingDocumentIds.length
    ? await db.collection("documents").find({ id: { $in: openingDocumentIds } }, { session }).sort({ occurredAt: 1 }).toArray()
    : [];
  const costByDocument = new Map<string, number>();
  for (const document of openingDocuments) {
    const line = (Array.isArray(document.lines) ? document.lines : []).find((item: Document) => String(item.productId ?? "") === productId);
    const cost = positive(line?.unitPrice);
    if (cost !== null) costByDocument.set(String(document.id), cost);
  }

  const allocations: Record<string, number> = {};
  const consumedBySale = new Map<string, Array<{ opening: number; other: number }>>();
  const adjustmentOtherByDocument = new Map<string, Map<string, number>>();
  const consumptionByDocument: Record<string, Record<string, number>> = {};
  const transferGroups = new Map<string, Document[]>();
  const processedTransferGroups = new Set<string>();
  const transferGroupKey = (movement: Document) => {
    const type = String(movement.type ?? "");
    const documentId = String(movement.documentId ?? "");
    if (!documentId || !(type === "transfer" || type === "transfer-out" || type === "transfer-in" || type.startsWith("transfer-edit") || type === "transfer-void")) return "";
    const family = type.startsWith("transfer-edit") ? "edit" : type === "transfer-void" ? "void" : "post";
    return [documentId, String(movement.documentRevision ?? 0), family].join("\u0000");
  };
  for (const movement of movements) {
    const key = transferGroupKey(movement);
    if (!key) continue;
    const rows = transferGroups.get(key) ?? [];
    rows.push(movement);
    transferGroups.set(key, rows);
  }
  const recordConsumption = (documentId: string, warehouseId: string, quantity: number) => {
    if (!documentId || quantity <= 0) return;
    const byWarehouse = consumptionByDocument[documentId] ?? (consumptionByDocument[documentId] = {});
    byWarehouse[warehouseId] = Math.max(0, Number(byWarehouse[warehouseId] ?? 0)) + quantity;
  };
  const restoreConsumption = (documentId: string, warehouseId: string, quantity: number) => {
    if (!documentId || quantity <= 0) return 0;
    const byWarehouse = consumptionByDocument[documentId];
    const outstanding = Math.max(0, Number(byWarehouse?.[warehouseId] ?? 0));
    const restored = Math.min(quantity, outstanding);
    if (restored > 0) {
      add(allocations, warehouseId, restored);
      byWarehouse![warehouseId] = outstanding - restored;
      if (byWarehouse![warehouseId] <= 1e-9) delete byWarehouse![warehouseId];
      if (!Object.keys(byWarehouse!).length) delete consumptionByDocument[documentId];
    }
    return restored;
  };
  const adjustmentOther = (documentId: string, warehouseId: string) => {
    const byWarehouse = adjustmentOtherByDocument.get(documentId) ?? new Map<string, number>();
    adjustmentOtherByDocument.set(documentId, byWarehouse);
    return {
      get: () => Math.max(0, Number(byWarehouse.get(warehouseId) ?? 0)),
      set: (value: number) => { if (value > 1e-9) byWarehouse.set(warehouseId, value); else byWarehouse.delete(warehouseId); },
    };
  };
  let total = 0;
  let inferredCost: number | null = null;
  let firstWarehouseId: string | null = null;

  for (const movement of movements) {
    const warehouseId = String(movement.warehouseId ?? "");
    const documentId = String(movement.documentId ?? "");
    const type = String(movement.type ?? "");
    const delta = finite(movement.quantityDelta) ?? 0;
    if (!warehouseId || !delta) continue;

    if (type === "opening" || type === "opening-void") {
      // Native opening entries and an explicit deletion of that opening source.
      if (delta > 0) {
        add(allocations, warehouseId, delta);
        total += delta;
        firstWarehouseId ??= warehouseId;
        inferredCost = costByDocument.get(documentId) ?? inferredCost;
      } else {
        const removed = take(allocations, warehouseId, -delta);
        total -= removed;
      }
      continue;
    }
    if (type === "opening-correction" || type.startsWith("opening-correction-")) {
      if (delta > 0) add(allocations, warehouseId, delta);
      else take(allocations, warehouseId, -delta);
      total += delta;
      continue;
    }
    if (type === "legacy-opening" || type === "purchase" || type === "purchase-edit" || type === "purchase-void") continue;

    const transferKey = transferGroupKey(movement);
    if (transferKey) {
      if (processedTransferGroups.has(transferKey)) continue;
      processedTransferGroups.add(transferKey);
      const netByWarehouse = new Map<string, number>();
      for (const row of transferGroups.get(transferKey) ?? [movement]) {
        const rowWarehouseId = String(row.warehouseId ?? "");
        const rowDelta = finite(row.quantityDelta) ?? 0;
        if (!rowWarehouseId || !rowDelta) continue;
        netByWarehouse.set(rowWarehouseId, Number(netByWarehouse.get(rowWarehouseId) ?? 0) + rowDelta);
      }
      let movedOpening = 0;
      for (const [rowWarehouseId, rowDelta] of netByWarehouse) {
        if (rowDelta < 0) movedOpening += take(allocations, rowWarehouseId, -rowDelta);
      }
      for (const [rowWarehouseId, rowDelta] of netByWarehouse) {
        if (rowDelta <= 0 || movedOpening <= 0) continue;
        const restored = Math.min(rowDelta, movedOpening);
        add(allocations, rowWarehouseId, restored);
        movedOpening -= restored;
      }
      continue;
    }
    if ((type === "sale" || type === "sale-edit") && delta < 0) {
      const used = take(allocations, warehouseId, -delta);
      recordConsumption(documentId, warehouseId, used);
      const segments = consumedBySale.get(documentId) ?? [];
      segments.push({ opening: used, other: -delta - used });
      consumedBySale.set(documentId, segments);
      continue;
    }
    if ((type === "sale-edit" || type === "sale-void") && delta > 0) {
      const segments = consumedBySale.get(documentId) ?? [];
      let returning = delta;
      // Undo the last units of this sale first: later purchase-origin units must
      // not be relabelled as opening stock when a mixed sale is reduced.
      while (returning > 0 && segments.length) {
        const segment = segments[segments.length - 1];
        const other = Math.min(returning, segment.other);
        segment.other -= other;
        returning -= other;
        const opening = Math.min(returning, segment.opening);
        segment.opening -= opening;
        returning -= opening;
        restoreConsumption(documentId, warehouseId, opening);
        if (!segment.opening && !segment.other) segments.pop();
      }
      continue;
    }
    if (type === "adjustment" || type === "adjustment-edit" || type === "adjustment-edit-reversal" || type === "adjustment-void") {
      const tracked = adjustmentOther(documentId, warehouseId);
      if (delta < 0) {
        let removing = -delta;
        const other = tracked.get(), fromOther = Math.min(removing, other);
        tracked.set(other - fromOther);
        removing -= fromOther;
        if (removing > 0) {
          const used = take(allocations, warehouseId, removing);
          recordConsumption(documentId, warehouseId, used);
        }
      } else {
        let returning = delta;
        const restored = restoreConsumption(documentId, warehouseId, returning);
        returning -= restored;
        if (returning > 0) tracked.set(tracked.get() + returning);
      }
      continue;
    }

    // Any future stock outflow consumes opening units first. Positive unknown
    // movements never create opening provenance.
    if (delta < 0) {
      const used = take(allocations, warehouseId, -delta);
      recordConsumption(documentId, warehouseId, used);
    }
  }

  for (const key of Object.keys(allocations)) if (allocations[key] <= 0) delete allocations[key];
  const remaining = Object.values(allocations).reduce((sum, quantity) => sum + quantity, 0);
  // Prefer explicit metadata written by the fixed workflow, but retain the complete
  // movement replay as the quantity authority for pre-fix products.
  const metadataTotal = finite(product.openingStock);
  if (metadataTotal !== null && metadataTotal >= 0 && hasNativeOpening) total = metadataTotal;
  total = Math.max(total, remaining);
  const consumed = Math.max(0, total - remaining);
  const explicitWarehouseId = typeof product.openingWarehouseId === "string" && product.openingWarehouseId ? product.openingWarehouseId : null;
  const warehouseId = explicitWarehouseId ?? Object.keys(allocations)[0] ?? firstWarehouseId;
  const cost = Object.hasOwn(product, "openingCost") ? positive(product.openingCost) : inferredCost;
  return { total, remaining, consumed, allocations, warehouseId, cost, hasNativeOpening, hasStockHistory, legacySnapshot, consumptionByDocument };
}

export function planOpeningStockCorrection(state: OpeningStockState, desiredTotal: number, targetWarehouseId: string | null, relocateRemaining = false) {
  if (!Number.isInteger(desiredTotal) || desiredTotal < 0) throw new Error("رصيد البداية غير صالح");
  if (desiredTotal < state.consumed) throw new Error(`لا يمكن خفض رصيد البداية عن ${state.consumed} لأن هذه الكمية تم التصرف بها سابقًا`);
  const desiredRemaining = desiredTotal - state.consumed;
  const fallbackWarehouseId = targetWarehouseId ?? state.warehouseId ?? Object.keys(state.allocations).sort()[0] ?? null;
  if (desiredRemaining > 0 && !fallbackWarehouseId) throw new Error("مخزن رصيد البداية مطلوب");
  const desiredAllocations: Record<string, number> = {};
  if (relocateRemaining) {
    if (desiredRemaining > 0 && fallbackWarehouseId) desiredAllocations[fallbackWarehouseId] = desiredRemaining;
  } else {
    for (const [warehouseId, quantity] of Object.entries(state.allocations)) if (quantity > 0) desiredAllocations[warehouseId] = quantity;
    const change = desiredRemaining - state.remaining;
    if (change > 0 && fallbackWarehouseId) desiredAllocations[fallbackWarehouseId] = Number(desiredAllocations[fallbackWarehouseId] ?? 0) + change;
    if (change < 0) {
      let reduction = -change;
      const order = [...new Set([fallbackWarehouseId, ...Object.keys(desiredAllocations).sort()].filter((value): value is string => Boolean(value)))];
      for (const warehouseId of order) {
        if (reduction <= 0) break;
        const available = Number(desiredAllocations[warehouseId] ?? 0);
        const removed = Math.min(available, reduction);
        desiredAllocations[warehouseId] = available - removed;
        reduction -= removed;
      }
      if (reduction > 1e-9) throw new Error("تعذر مطابقة رصيد البداية مع سجل الحركات");
    }
    for (const warehouseId of Object.keys(desiredAllocations)) if (desiredAllocations[warehouseId] <= 0) delete desiredAllocations[warehouseId];
  }
  const warehouseIds = new Set([...Object.keys(state.allocations), ...Object.keys(desiredAllocations)]);
  const deltas = [...warehouseIds].map(warehouseId => ({ warehouseId, delta: Number(desiredAllocations[warehouseId] ?? 0) - Number(state.allocations[warehouseId] ?? 0) })).filter(item => item.delta !== 0);
  return { desiredRemaining, desiredAllocations, deltas };
}

export function openingFallbackCost(product: Document, state?: Pick<OpeningStockState, "cost" | "total">) {
  const opening = positive(product.openingCost) ?? (state && state.total > 0 ? positive(state.cost) : null);
  if (opening !== null) return { cost: opening, source: "opening" as const };
  const legacy = positive(product.legacyOpeningCost);
  if (legacy !== null) return { cost: legacy, source: "legacy-opening" as const };
  return { cost: null, source: null };
}
