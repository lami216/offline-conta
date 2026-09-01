export type InvoiceShortcutScope = "sale" | "purchase";
export type InvoiceShortcutAction =
  | "toggle-hints" | "focus-product" | "focus-party" | "focus-payment"
  | "toggle-party-quick" | "toggle-print" | "new-invoice" | "submit"
  | "select-direct" | "select-note" | "focus-warehouse";

export type InvoiceKeyboardShortcut = {
  id: InvoiceShortcutAction;
  /** First binding is the compact, primary binding rendered by ShortcutHintAnchor. */
  keys: readonly (readonly string[])[];
  label: string;
  scope: readonly InvoiceShortcutScope[];
  action: InvoiceShortcutAction;
};

/** Single source of truth for invoice key matching, labels, scope, and visible keycaps. */
export const invoiceKeyboardShortcuts: readonly InvoiceKeyboardShortcut[] = [
  { id: "toggle-hints", keys: [["F1"]], label: "اختصارات", scope: ["sale", "purchase"], action: "toggle-hints" },
  { id: "focus-product", keys: [["F2"]], label: "بحث المنتج", scope: ["sale", "purchase"], action: "focus-product" },
  { id: "focus-party", keys: [["F3"]], label: "العميل أو المورد", scope: ["sale", "purchase"], action: "focus-party" },
  { id: "focus-payment", keys: [["F4"]], label: "طريقة الدفع", scope: ["sale", "purchase"], action: "focus-payment" },
  { id: "toggle-party-quick", keys: [["F6"]], label: "إضافة العميل أو المورد", scope: ["sale", "purchase"], action: "toggle-party-quick" },
  { id: "toggle-print", keys: [["F7"]], label: "طباعة", scope: ["sale", "purchase"], action: "toggle-print" },
  { id: "new-invoice", keys: [["F8"]], label: "فاتورة جديدة", scope: ["sale", "purchase"], action: "new-invoice" },
  { id: "submit", keys: [["F9"], ["Ctrl", "Enter"]], label: "إتمام الفاتورة", scope: ["sale", "purchase"], action: "submit" },
  { id: "select-direct", keys: [["1"]], label: "دفع مباشر", scope: ["sale", "purchase"], action: "select-direct" },
  { id: "select-note", keys: [["2"]], label: "ملاحظة", scope: ["sale", "purchase"], action: "select-note" },
  { id: "focus-warehouse", keys: [["F10"]], label: "مخزن الاستلام", scope: ["purchase"], action: "focus-warehouse" },
] as const;

export function shortcutsForInvoice(scope: InvoiceShortcutScope) {
  return invoiceKeyboardShortcuts.filter(shortcut => shortcut.scope.includes(scope));
}

export function shortcutForAction(scope: InvoiceShortcutScope, action: InvoiceShortcutAction) {
  return invoiceKeyboardShortcuts.find(shortcut => shortcut.action === action && shortcut.scope.includes(scope));
}

function matchesBinding(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, keys: readonly string[]) {
  const modified = keys.includes("Ctrl");
  const key = keys.find(item => !["Ctrl", "Alt", "Shift", "Meta"].includes(item));
  return event.key === key
    && Boolean(event.ctrlKey || event.metaKey) === modified
    && Boolean(event.altKey) === keys.includes("Alt")
    && Boolean(event.shiftKey) === keys.includes("Shift");
}

export function invoiceShortcutAction(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, scope: InvoiceShortcutScope) {
  return shortcutsForInvoice(scope).find(shortcut => shortcut.keys.some(keys => matchesBinding(event, keys)))?.action;
}
