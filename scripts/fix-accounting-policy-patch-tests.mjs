import { readFileSync, writeFileSync } from "node:fs";

function patch(path, search, replacement, label) {
  const source = readFileSync(path, "utf8");
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  writeFileSync(path, source.replace(search, replacement), "utf8");
}

patch(
  "tests/inventory-settlement-policy.test.mjs",
  `  assert.match(picker, /hasOwnProperty.call(product.stocks/);`,
  `  assert.ok(picker.includes("Object.prototype.hasOwnProperty.call(product.stocks"));`,
  "fix UI guard assertion",
);

patch(
  "tests/reliability-cleanup.test.mjs",
  `  assert.match(block,/effectiveInput=input\\.filter/);`,
  `  assert.match(block,/effectiveInput\\s*=\\s*input\\.filter/);`,
  "make no-op guard assertion formatting-insensitive",
);

patch(
  "tests/transactions.test.mjs",
  `paymentMethod: "note", paidAmount: 500,`,
  `paymentMethod: "note", paidAmount: 0,`,
  "note purchase fixture uses full-credit settlement",
);

patch(
  "tests/transactions.test.mjs",
  `paymentMethod: "note", paidAmount: 700,`,
  `paymentMethod: "note", paidAmount: 0,`,
  "note sale fixture uses full-credit settlement",
);

patch(
  "tests/visual-consistency.test.mjs",
  `  for (const heading of ["الكمية للتحويل", "الكمية الفعلية", "تكلفة الوحدة"]) assert.match(table, new RegExp(heading));`,
  `  for (const heading of ["الكمية للتحويل", "الكمية الفعلية"]) assert.match(table, new RegExp(heading));\n  assert.doesNotMatch(table, /تكلفة الوحدة|purchaseCost/);`,
  "stock adjustment visual contract has no cost editor",
);

console.log("Policy regression expectations updated for the approved all-or-none settlement and quantity-only adjustment model.");
