export type InvoiceShortcutScope = "sale" | "purchase";
export type InvoiceShortcutAnchor = "product-search" | "payment" | "submit";

export type InvoiceKeyboardShortcut = {
  id: "focus-product" | "focus-payment" | "submit";
  keys: readonly string[];
  label: string;
  anchor: InvoiceShortcutAnchor;
  scope: readonly InvoiceShortcutScope[];
  action: "focus-product" | "focus-payment" | "submit";
};

/** The single registry used by invoice event handlers and the visual keyboard map. */
export const invoiceKeyboardShortcuts: readonly InvoiceKeyboardShortcut[] = [
  { id: "focus-product", keys: ["F2"], label: "بحث المنتج", anchor: "product-search", scope: ["sale", "purchase"], action: "focus-product" },
  { id: "focus-payment", keys: ["F4"], label: "طريقة الدفع", anchor: "payment", scope: ["sale", "purchase"], action: "focus-payment" },
  { id: "submit", keys: ["Ctrl", "Enter"], label: "إتمام الفاتورة", anchor: "submit", scope: ["sale", "purchase"], action: "submit" },
] as const;

export function shortcutsForInvoice(scope: InvoiceShortcutScope) {
  return invoiceKeyboardShortcuts.filter(shortcut => shortcut.scope.includes(scope));
}

export function invoiceShortcutAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">, scope: InvoiceShortcutScope) {
  const shortcut = shortcutsForInvoice(scope).find(item => item.keys.length === 1
    ? event.key === item.keys[0]
    : item.keys.includes("Enter") && event.key === "Enter" && (event.ctrlKey || event.metaKey));
  return shortcut?.action;
}
