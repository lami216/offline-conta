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

test("invoice hints and behavior share one conflict-free shortcut registry", () => {
  for (const key of ["F1", "F2", "F3", "F4", "F6", "F7", "F8", "F9", "F10", "1", "2"]) assert.ok(shortcutRegistry.includes(`[["${key}"]]`) || shortcutRegistry.includes(`[["${key}"],`));
  assert.match(shortcutRegistry, /id: "submit", keys: \[\["F9"\], \["Ctrl", "Enter"\]\]/);
  assert.match(source, /shortcutForAction\(scope, action\)/);
  assert.equal((source.match(/invoiceShortcutAction\(event\.nativeEvent/g) ?? []).length, 2);
});

test("game-style hints are local, non-blocking, and registry-driven", () => {
  assert.match(source, /function ShortcutHintAnchor/);
  assert.equal((source.match(/action="focus-product" visible=\{keyboardHintsVisible\}/g) ?? []).length, 2);
  assert.equal((source.match(/action="focus-payment" visible=\{keyboardHintsVisible\}/g) ?? []).length, 2);
  assert.equal((source.match(/action="submit" visible=\{keyboardHintsVisible\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /KeyboardHelpOverlay|keyboard-help-overlay|onKeyDownCapture/);
  assert.doesNotMatch(source, /if \(!keyboardHintsVisible\) return; event\.preventDefault/);
  assert.match(css, /\.keyboard-shortcut-anchor[\s\S]{0,80}position: relative/);
  assert.match(css, /\.keyboard-shortcut-badge[\s\S]{0,160}pointer-events: none/);
  assert.doesNotMatch(css, /\.keyboard-help-overlay|\.keyboard-help-legend/);
});

test("hint mode keeps actions live and protects typing and quick-entry forms", () => {
  assert.equal((source.match(/action === "toggle-hints"/g) ?? []).length, 2);
  assert.equal((source.match(/action === "focus-product"/g) ?? []).length, 2);
  assert.equal((source.match(/action === "submit" && !quick/g) ?? []).length, 2);
  assert.equal((source.match(/\(action === "select-direct" \|\| action === "select-note"\) && isTypingTarget\(event\.target\)/g) ?? []).length, 2);
});

test("sale and purchase keep party add and native payment controls in bounded rows", () => {
  assert.match(source, /aria-label="إضافة العميل"[\s\S]{0,150}<span>إضافة العميل<\/span>/);
  assert.match(source, /aria-label="إضافة المورد"[\s\S]{0,150}<span>إضافة المورد<\/span>/);
  assert.equal((source.match(/<CompactPaymentSelector selectRef=\{paymentRef\}/g) ?? []).length, 2);
  assert.match(css, /\.pos-payment-row,[\s\S]{0,120}grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\) auto/);
});
