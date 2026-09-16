import assert from "node:assert/strict";
import test from "node:test";
import { expandPermissionDependencies, removePermissionAndDependents } from "../lib/permission-dependencies.ts";
import { permissionPresets, setPermission } from "../app/user-permissions.ts";

test("edit and delete permissions include the read access required by their workspace", () => {
  assert.deepEqual(new Set(expandPermissionDependencies(["pos.edit"])), new Set(["pos.edit", "pos.view"]));
  assert.deepEqual(new Set(expandPermissionDependencies(["customers.collect.delete"])), new Set(["customers.collect.delete", "customers.view"]));
  assert.deepEqual(new Set(expandPermissionDependencies(["banks.transfer.edit"])), new Set(["banks.transfer.edit", "banks.view"]));
});

test("legacy warehouse lifecycle rows keep their access/create capability as the edit/delete prerequisite", () => {
  assert.deepEqual(new Set(expandPermissionDependencies(["warehouses.transfer.edit"])), new Set(["warehouses.transfer.edit", "warehouses.transfer"]));
  assert.deepEqual(new Set(expandPermissionDependencies(["warehouses.adjust.delete"])), new Set(["warehouses.adjust.delete", "warehouses.adjust"]));
});

test("removing a prerequisite also removes permissions that would otherwise become unreachable", () => {
  assert.deepEqual(removePermissionAndDependents(["customers.view", "customers.collect", "customers.collect.edit"], "customers.view"), []);
  assert.deepEqual(removePermissionAndDependents(["warehouses.transfer", "warehouses.transfer.edit", "records.view"], "warehouses.transfer"), ["records.view"]);
});

test("permission editor applies the same prerequisite policy as runtime principals", () => {
  assert.deepEqual(new Set(setPermission([], "expenses.edit", true)), new Set(["expenses.edit", "expenses.view"]));
  assert.deepEqual(new Set(setPermission([], "warehouses.transfer.delete", true)), new Set(["warehouses.transfer.delete", "warehouses.transfer"]));
  assert.deepEqual(setPermission(["suppliers.view", "suppliers.pay", "suppliers.pay.delete"], "suppliers.view", false), []);
});

test("built-in permission presets are dependency complete", () => {
  for (const [name, permissions] of Object.entries(permissionPresets)) {
    assert.deepEqual(new Set(expandPermissionDependencies(permissions)), new Set(permissions), name);
  }
});
