export type ReadModelDocument = Record<string, unknown> & {
  kind?: unknown;
  status?: unknown;
  partyId?: unknown;
  partyName?: unknown;
  partyNameOriginal?: unknown;
};

export type DocumentReadAccess = {
  can: (capability: string) => boolean;
  customerPartyIds: ReadonlySet<string>;
  supplierPartyIds: ReadonlySet<string>;
};

const partyIdOf = (document: ReadModelDocument) =>
  typeof document.partyId === "string" ? document.partyId : "";

/**
 * `documents` in bootstrap is the operational read model. Voided records stay in
 * storage for audit/history, but must not leak back into normal screens as if
 * they were still active transactions.
 */
export function isOperationalDocument(document: ReadModelDocument) {
  return document.status === "posted";
}

/** Coarse kind authorization, used before historical queries expose a kind. */
export function canReadDocumentKind(kind: string, access: Pick<DocumentReadAccess, "can">) {
  if (access.can("records.view")) return true;
  if (kind === "sale") return access.can("pos.view") || access.can("customers.view");
  if (kind === "purchase") return access.can("purchases.view") || access.can("suppliers.view");
  if (kind === "expense") return access.can("expenses.view");
  if (kind === "transfer") return access.can("warehouses.transfer");
  if (kind === "adjustment") return access.can("warehouses.adjust");
  if (kind === "account-transfer" || kind === "account-adjustment") return access.can("banks.view") || access.can("banks.movements.view");
  if (["payment", "settlement", "offset", "return"].includes(kind)) return access.can("customers.view") || access.can("suppliers.view");
  return false;
}

/** One authorization rule for both live documents and historical/audit reads. */
export function canReadDocument(document: ReadModelDocument, access: DocumentReadAccess) {
  if (access.can("records.view")) return true;

  const kind = String(document.kind ?? ""), partyId = partyIdOf(document);
  const customerParty = Boolean(partyId) && access.customerPartyIds.has(partyId);
  const supplierParty = Boolean(partyId) && access.supplierPartyIds.has(partyId);

  if (kind === "sale") return access.can("pos.view") || (customerParty && access.can("customers.view"));
  if (kind === "purchase") return access.can("purchases.view") || (supplierParty && access.can("suppliers.view"));
  if (kind === "expense") return access.can("expenses.view");
  if (kind === "transfer") return access.can("warehouses.transfer");
  if (kind === "adjustment") return access.can("warehouses.adjust");
  if (kind === "account-transfer" || kind === "account-adjustment") return access.can("banks.view") || access.can("banks.movements.view");
  if (["payment", "settlement", "offset", "return"].includes(kind)) {
    return (customerParty && access.can("customers.view")) || (supplierParty && access.can("suppliers.view"));
  }
  return false;
}

/** Feature screens consume only active documents, on top of the shared access rule. */
export function canReadOperationalDocument(document: ReadModelDocument, access: DocumentReadAccess) {
  return isOperationalDocument(document) && canReadDocument(document, access);
}

/**
 * Operational consumers always see the current party identity by id. The first
 * stored name remains available separately for audit / as-issued presentation.
 */
export function resolveCurrentPartyName(
  document: ReadModelDocument,
  currentPartyNames: ReadonlyMap<string, string>,
) {
  const partyId = partyIdOf(document);
  if (!partyId) return document;
  const currentName = currentPartyNames.get(partyId)?.trim();
  if (!currentName) return document;
  const original = typeof document.partyNameOriginal === "string" ? document.partyNameOriginal.trim() : "";
  const stored = typeof document.partyName === "string" ? document.partyName.trim() : "";
  const snapshot = original || stored;
  return {
    ...document,
    ...(snapshot && snapshot !== currentName ? { partyNameSnapshot: snapshot } : {}),
    partyName: currentName,
  };
}

/** Reversal rows are audit evidence, never an additional operating cash effect. */
export function isEffectiveFinancialMovement(movement: Record<string, unknown>) {
  return movement.status !== "reversed" && movement.isReversal !== true;
}
