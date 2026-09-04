import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Arabic and French use one exhaustive typed message-key contract", () => {
  const source=readFileSync(new URL("../app/i18n/messages.ts",import.meta.url),"utf8");
  assert.match(source,/type MessageKey = keyof typeof arMessages/);
  assert.match(source,/frMessages: Record<MessageKey, string>/);
  assert.doesNotMatch(source,/\[FR\]/);
});

test("locale preference is independent, durable, and defaults to Arabic", () => {
  const source=readFileSync(new URL("../app/i18n/locale.ts",import.meta.url),"utf8");
  assert.match(source,/LOCALE_COOKIE = "alkarna_locale"/);
  assert.match(source,/value === "ar" \|\| value === "fr"/);
  assert.match(source,/return isLocale\(value\) \? value : "ar"/);
});
