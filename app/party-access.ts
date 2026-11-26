import type { Capability } from "../lib/auth.ts";
import type { PartyType } from "./domain.ts";

export type PartyAction = "view" | "create" | "edit" | "delete" | "restore" | "cash-post" | "cash-edit" | "cash-delete" | "opening";

/** Mixed-account access requires both existing role permissions, never either one. */
export function partyCapabilities(role: PartyType, action: PartyAction): Capability[] {
  if (action === "opening") return role === "trader"
    ? ["party.opening.manage", "customers.edit", "suppliers.edit"] : ["party.opening.manage"];
  const pairs: Record<Exclude<PartyAction, "opening">, [Capability, Capability]> = {
    view: ["customers.view", "suppliers.view"],
    create: ["customers.create", "suppliers.create"],
    edit: ["customers.edit", "suppliers.edit"],
    delete: ["customers.delete", "suppliers.delete"],
    restore: ["customers.edit", "suppliers.edit"],
    "cash-post": ["customers.collect", "suppliers.pay"],
    "cash-edit": ["customers.collect.edit", "suppliers.pay.edit"],
    "cash-delete": ["customers.collect.delete", "suppliers.pay.delete"],
  };
  const pair = pairs[action];
  return role === "trader" ? [...pair] : [pair[role === "customer" ? 0 : 1]];
}
