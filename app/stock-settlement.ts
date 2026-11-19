import { isOpeningStockDocument, type StockMovementDocumentHint } from "./stock-movement.ts";

type SettlementHint = StockMovementDocumentHint & { settlementSequence?: unknown };

/** Physical stock counts have their own serials; opening balances and archive
 * clearances retain their existing identity and accounting lifecycle. */
export function isStockSettlementDocument(document: SettlementHint | null | undefined): boolean {
  return Boolean(document && document.kind === "adjustment" && document.productArchiveStockClearance !== true && !isOpeningStockDocument(document));
}

export function validSettlementSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
