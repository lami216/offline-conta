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
  assert.equal((source.match(/event\.key === "F2"/g) ?? []).length, 2);
  assert.equal((source.match(/event\.key === "F4"/g) ?? []).length, 2);
  assert.equal((source.match(/isModifiedEnter\(event\.nativeEvent\)/g) ?? []).length, 2);
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
