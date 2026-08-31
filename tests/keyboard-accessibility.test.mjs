import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/conta-app.tsx", import.meta.url), "utf8");
const keyboard = await readFile(new URL("../app/keyboard.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("typing-target guard covers native editors and contenteditable", () => {
  assert.match(keyboard, /input, textarea, select, \[contenteditable\]/);
  assert.match(source, /isTypingTarget\(event\.target\)/);
});

test("shared searchable select has standard combobox keyboard semantics", () => {
  assert.match(source, /role="combobox"[\s\S]{0,250}aria-activedescendant/);
  assert.match(source, /setHighlightedIndex\(null\); setOpen\(true\)/);
  assert.match(source, /e\.key === "ArrowDown"[\s\S]{0,180}x === null \? 0/);
  assert.match(source, /e\.key === "ArrowUp"/);
  assert.match(source, /e\.key === "Enter" && highlightedIndex !== null/);
  assert.match(source, /e\.key === "Escape"[\s\S]{0,100}closeSelect\(true\)/);
  assert.doesNotMatch(source, /e\.key === "Tab"[^\n]*preventDefault/);
  assert.match(source, /role="option" aria-selected=\{highlightedIndex === index\}/);
});

test("POS and purchase workspaces expose safe shortcuts and focus-after-add", () => {
  assert.equal((source.match(/invoiceShortcutAction\(event\.nativeEvent/g) ?? []).length, 2);
  assert.match(keyboard, /isModifiedEnter/);
  assert.equal((source.match(/submittingRef\.current\) return/g) ?? []).length, 2);
  assert.equal((source.match(/productSearchRef\.current\?\.focus\(\)/g) ?? []).length >= 4, true);
  assert.match(source, /<SearchProducts inputRef=\{productSearchRef\}/);
  assert.match(source, /selectRef=\{paymentRef\}/);
});

test("document dialog and quick-create popovers restore focus on Escape", () => {
  assert.match(source, /role="dialog"[\s\S]{0,300}event\.key === "Escape"/);
  assert.match(source, /dialogOpenerRef\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === "Tab"[\s\S]{0,500}controls\.at\(-1\)/);
  assert.match(source, /pos-quick-customer-popover[\s\S]{0,220}event\.key === "Escape"/);
});

test("important controls have a visible focus-visible treatment", () => {
  assert.match(css, /:is\(button, input, textarea, select, a\[href\]/);
  assert.match(css, /:focus-visible[\s\S]{0,180}outline: 3px solid/);
});

const shortcutRegistry = await readFile(new URL("../app/invoice-keyboard.ts", import.meta.url), "utf8");

test("invoice help and behavior share one conflict-free shortcut registry", () => {
  const entries = [...shortcutRegistry.matchAll(/\{ id: "([^"]+)", keys: \[([^\]]+)\][^}]+scope: \[([^\]]+)\][^}]+action: "([^"]+)"/g)];
  assert.equal(entries.length, 3);
  for (const scope of ["sale", "purchase"]) {
    const scoped = entries.filter(entry => entry[3].includes(`"${scope}"`));
    assert.equal(new Set(scoped.map(entry => entry[1])).size, scoped.length);
    assert.deepEqual(new Set(scoped.map(entry => entry[4])), new Set(["focus-product", "focus-payment", "submit"]));
  }
  assert.match(source, /invoiceShortcutAction\(event\.nativeEvent, "sale"\)/);
  assert.match(source, /invoiceShortcutAction\(event\.nativeEvent, "purchase"\)/);
  assert.match(source, /shortcutsForInvoice\(scope\)/);
});

test("visual keyboard help is anchored, dismissible, and blocks invoice shortcuts", () => {
  assert.equal((source.match(/data-keyboard-help="product-search"/g) ?? []).length, 2);
  assert.equal((source.match(/data-keyboard-help="payment"/g) ?? []).length, 2);
  assert.equal((source.match(/data-keyboard-help="submit"/g) ?? []).length, 2);
  assert.match(source, /role="dialog" aria-modal="true" aria-label="خريطة اختصارات الفاتورة"/);
  assert.equal((source.match(/if \(!keyboardHelpOpen\) return; event\.preventDefault\(\); event\.stopPropagation\(\)/g) ?? []).length, 2);
  assert.match(source, /if \(event\.key === "Escape"\) \{ setKeyboardHelpOpen\(false\)/);
  assert.match(source, /aria-pressed=\{open\} onClick=\{onToggle\}/);
});

test("sale and purchase keep party add and native payment controls in bounded rows", () => {
  assert.match(source, /aria-label="إضافة العميل"[\s\S]{0,150}<span>إضافة العميل<\/span>/);
  assert.match(source, /aria-label="إضافة المورد"[\s\S]{0,150}<span>إضافة المورد<\/span>/);
  assert.equal((source.match(/<CompactPaymentSelector selectRef=\{paymentRef\}/g) ?? []).length, 2);
  assert.match(css, /\.pos-payment-row,[\s\S]{0,120}grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) auto/);
});
