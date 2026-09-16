export type PermissionName = string;

/**
 * Mutating a workspace is only meaningful when the same user can reach and read
 * that workspace. Keep those prerequisites in one place so API principals,
 * permission editing, bootstrap data and navigation cannot drift apart.
 *
 * Warehouse transfer/adjustment pre-date explicit view capabilities; their base
 * capabilities are therefore the legacy access/create capability and remain a
 * prerequisite for edit/delete. Other workspaces use their dedicated view cap.
 */
const prerequisites: Readonly<Record<PermissionName, readonly PermissionName[]>> = {
  "pos.create": ["pos.view"],
  "pos.edit": ["pos.view"],
  "pos.delete": ["pos.view"],
  "purchases.create": ["purchases.view"],
  "purchases.edit": ["purchases.view"],
  "purchases.delete": ["purchases.view"],
  "products.create": ["products.view"],
  "products.edit": ["products.view"],
  "products.delete": ["products.view"],
  "customers.create": ["customers.view"],
  "customers.edit": ["customers.view"],
  "customers.delete": ["customers.view"],
  "customers.collect": ["customers.view"],
  "customers.collect.edit": ["customers.view"],
  "customers.collect.delete": ["customers.view"],
  "suppliers.create": ["suppliers.view"],
  "suppliers.edit": ["suppliers.view"],
  "suppliers.delete": ["suppliers.view"],
  "suppliers.pay": ["suppliers.view"],
  "suppliers.pay.edit": ["suppliers.view"],
  "suppliers.pay.delete": ["suppliers.view"],
  "warehouses.create": ["warehouses.view"],
  "warehouses.edit": ["warehouses.view"],
  "warehouses.delete": ["warehouses.view"],
  "warehouses.transfer.edit": ["warehouses.transfer"],
  "warehouses.transfer.delete": ["warehouses.transfer"],
  "warehouses.adjust.edit": ["warehouses.adjust"],
  "warehouses.adjust.delete": ["warehouses.adjust"],
  "banks.create": ["banks.view"],
  "banks.edit": ["banks.view"],
  "banks.delete": ["banks.view"],
  "banks.transfer": ["banks.view"],
  "banks.transfer.edit": ["banks.view"],
  "banks.transfer.delete": ["banks.view"],
  "banks.deposit_withdraw": ["banks.view"],
  "banks.deposit_withdraw.edit": ["banks.view"],
  "banks.deposit_withdraw.delete": ["banks.view"],
  "banks.balance_correct": ["banks.view"],
  "expenses.create": ["expenses.view"],
  "expenses.edit": ["expenses.view"],
  "expenses.delete": ["expenses.view"],
};

export function expandPermissionDependencies(permissions: readonly PermissionName[]) {
  const expanded = new Set(permissions);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...expanded]) {
      for (const prerequisite of prerequisites[permission] ?? []) {
        if (!expanded.has(prerequisite)) {
          expanded.add(prerequisite);
          changed = true;
        }
      }
    }
  }
  return [...expanded];
}

export function removePermissionAndDependents(permissions: readonly PermissionName[], permission: PermissionName) {
  const remaining = new Set(permissions);
  const queue = [permission];
  while (queue.length) {
    const removed = queue.shift()!;
    remaining.delete(removed);
    for (const candidate of [...remaining]) {
      if ((prerequisites[candidate] ?? []).includes(removed)) queue.push(candidate);
    }
  }
  return [...remaining];
}
