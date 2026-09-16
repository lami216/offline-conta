export type ReadModelDocument = Record<string, unknown> & {
  kind?: unknown;
  status?: unknown;
  partyId?: unknown;
  partyName?: unknown;
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

/**
 * One permission-aware visibility rule for every bootstrap consumer. Feature
 * screens should not invent their own rules for which backing documents exist.
 */
export function canReadOperationalDocument(document: ReadModelDocument, access: DocumentReadAccess) {
  if (!isOperationalDocument(document)) return false;
  if (access.can("records.view")) return true;

  const kind = String(document.kind ?? ""), partyId = partyIdOf(document);
  const customerParty = Boolean(partyId) && access.customerPartyIds.has(partyId);
  const supplierParty = Boolean(partyId) && access.supplierPartyIds.has(partyId);

  if (kind === "sale") return access.can("pos.view") || (customerParty && access.can("customers.view"));
  if (kind === "purchase") return access.can("purchases.view") || (supplierParty && access.can("suppliers.view"));
  if (kind === "expense") return access.can("expenses.view");
  if (kind === "transfer") return access.can("warehouses.transfer");
  if (kind === "adjustment") return access.can("warehouses.adjust");

  if (["payment", "settlement", "offset", "return"].includes(kind)) {
    return (customerParty && access.can("customers.view")) || (supplierParty && access.can("suppliers.view"));
  }

  return false;
}

/**
 * Historical snapshots remain untouched in storage. The operational read model
 * resolves the current party identity by id so a corrected customer/supplier
 * name is reflected consistently everywhere that consumes bootstrap data.
 */
export function resolveCurrentPartyName(
  document: ReadModelDocument,
  currentPartyNames: ReadonlyMap<string, string>,
) {
  const partyId = partyIdOf(document);
  if (!partyId) return document;
  const currentName = currentPartyNames.get(partyId)?.trim();
  if (!currentName) return document;
  const snapshot = typeof document.partyName === "string" ? document.partyName.trim() : "";
  return {
    ...document,
    ...(snapshot && snapshot !== currentName ? { partyNameSnapshot: snapshot } : {}),
    partyName: currentName,
  };
}

export function isEffectiveFinancialMovement(movement: Record<string, unknown>) {
  return movement.status !== "reversed" && movement.isReversal !== true;
}
