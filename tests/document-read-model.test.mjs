import assert from "node:assert/strict";
import test from "node:test";
import {
  canReadOperationalDocument,
  isEffectiveFinancialMovement,
  isOperationalDocument,
  resolveCurrentPartyName,
} from "../lib/document-read-model.ts";

const access = (permissions, customers = ["c1"], suppliers = ["s1"]) => ({
  can: capability => permissions.includes(capability),
  customerPartyIds: new Set(customers),
  supplierPartyIds: new Set(suppliers),
});

test("voided documents never enter the operational read model", () => {
  const document = { id: "sale-1", kind: "sale", status: "voided", partyId: "c1" };
  assert.equal(isOperationalDocument(document), false);
  assert.equal(canReadOperationalDocument(document, access(["records.view", "pos.view", "customers.view"])), false);
});

test("party account permissions expose the complete posted account history", () => {
  const customerAccess = access(["customers.view"]);
  for (const kind of ["sale", "payment", "settlement", "offset", "return"]) {
    assert.equal(canReadOperationalDocument({ kind, status: "posted", partyId: "c1" }, customerAccess), true, kind);
  }
  assert.equal(canReadOperationalDocument({ kind: "purchase", status: "posted", partyId: "s1" }, customerAccess), false);

  const supplierAccess = access(["suppliers.view"]);
  for (const kind of ["purchase", "payment", "settlement", "offset", "return"]) {
    assert.equal(canReadOperationalDocument({ kind, status: "posted", partyId: "s1" }, supplierAccess), true, kind);
  }
  assert.equal(canReadOperationalDocument({ kind: "sale", status: "posted", partyId: "c1" }, supplierAccess), false);
});

test("warehouse transaction screens receive their own posted documents", () => {
  assert.equal(canReadOperationalDocument({ kind: "transfer", status: "posted" }, access(["warehouses.transfer"])), true);
  assert.equal(canReadOperationalDocument({ kind: "adjustment", status: "posted" }, access(["warehouses.adjust"])), true);
  assert.equal(canReadOperationalDocument({ kind: "transfer", status: "posted" }, access(["warehouses.adjust"])), false);
});

test("current party identity is resolved by partyId without destroying the stored snapshot", () => {
  const document = { id: "sale-1", kind: "sale", status: "posted", partyId: "c1", partyName: "Old spelling" };
  const resolved = resolveCurrentPartyName(document, new Map([["c1", "Correct spelling"]]));
  assert.equal(resolved.partyName, "Correct spelling");
  assert.equal(resolved.partyNameSnapshot, "Old spelling");
  assert.equal(document.partyName, "Old spelling");
});

test("reversed and reversal audit rows are excluded from the effective financial read model", () => {
  assert.equal(isEffectiveFinancialMovement({ type: "sale" }), true);
  assert.equal(isEffectiveFinancialMovement({ type: "sale", status: "posted" }), true);
  assert.equal(isEffectiveFinancialMovement({ type: "sale", status: "reversed" }), false);
  assert.equal(isEffectiveFinancialMovement({ type: "sale:reversal", isReversal: true }), false);
});
