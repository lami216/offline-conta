import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { mobileBackupV23 } from "../tests/fixtures/mobile-backup-v23.mjs";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" || process.platform !== "win32") {
  throw new Error("Mobile export proof runs only on the isolated Windows CI runner.");
}
const commit = "1efa3058013d2da2cf17927ac10dfd5a4ca6083e";
const blob = "d9bd0ca2ecddf9645be48fb5488b8a6ea5594a30";
const url = `https://raw.githubusercontent.com/lami216/Contamobile/${commit}/approved-runtime/app.js`;
const response = await fetch(url);
assert.equal(response.ok, true, "Read the immutable Mobile 23 exporter source");
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), blob, "Exporter must be the exact reviewed Mobile 23 source");
const lines = bytes.toString("utf8").split("\n");
async function exactSource(path, expectedBlob) {
  const response = await fetch(`https://raw.githubusercontent.com/lami216/Contamobile/${commit}/approved-runtime/${path}`);
  assert.equal(response.ok, true, "Read immutable original " + path);
  const data = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex"), expectedBlob, "Verify original " + path);
  return data.toString("utf8");
}
const [featureSource, databaseSource] = await Promise.all([
  exactSource("upgrade-state.js", "620c1d303fc65b72771624c23895cc0ac5f48c5e"),
  exactSource("database.js", "0bd47b34e52c5a7ff906d2363b663d151697b78b"),
]);
const originalValidator = databaseSource.split("\n").filter(line => line.startsWith("export function validateState("));
assert.equal(originalValidator.length, 1);
const select = prefix => {
  const matches = lines.filter(line => line.startsWith(prefix));
  assert.equal(matches.length, 1, "Locate one original declaration: " + prefix);
  return matches[0];
};
const fixture = mobileBackupV23({ repeatedCommercialLines: true });
assert.equal(fixture.state.featureSchema, 2, "Synthetic state uses the original feature schema");
let exported;
const context = vm.createContext({
  S: structuredClone(fixture.state), appUsers: structuredClone(fixture.users), structuredClone,
  database: { async all(name) { assert.equal(name, "users"); return structuredClone(fixture.users); } },
  today: () => "2026-11-21", toast() {},
  prepareFeatureState() { throw new Error("Fixture must already be a valid Mobile 23 feature state"); },
  async download(name, text) { assert.equal(exported, undefined); exported = { name, text }; },
});
new vm.Script(["class StoreError extends Error {}", featureSource.replace(/^export /gm, ""), originalValidator[0].replace(/^export /, ""), "validateState(S)"].join("\n"), { filename: "mobile23-original-validation.js" }).runInContext(context);
// Execute only these three exact, hash-verified original declarations; no mobile UI,
// Android credentials, licensing or customer profile is started by this proof.
new vm.Script([select("const publicUser="), select("function stateForSave()"), select("async function exportBackup()")].join("\n"), { filename: "mobile23-original-exporter.js" }).runInContext(context);
// exportBackup awaits the asynchronous store and download operations.
await vm.runInContext("exportBackup()", context).catch(error => { throw error; });
assert.ok(exported, "Original mobile exporter produced a file");
const parsed = JSON.parse(exported.text);
assert.equal(parsed.format, "alkarna-web-backup");
assert.equal(parsed.schemaVersion, 1);
assert.equal(parsed.state.records.length, fixture.state.records.length);
const repeatedRecords = [102, 114].map(id => {
  const original = fixture.state.records.find(record => record.id === id);
  const actual = parsed.state.records.find(record => record.id === id);
  assert.equal(original.lines.length, 2, "Synthetic source contains repeated commercial rows");
  assert.equal(original.lines[0].product, original.lines[1].product);
  assert.deepEqual(actual.lines, original.lines, "Original Mobile23 validator and exporter retain both repeated rows in order");
  assert.equal(actual.lines.reduce((sum, line) => sum + line.qty * line.price, 0), actual.total);
  return { id, kind: actual.kind, lineCount: actual.lines.length, quantity: actual.lines.reduce((sum, line) => sum + line.qty, 0), total: actual.total };
});
const output = join("test-output", "mobile-backup-ui");
await mkdir(output, { recursive: true });
await writeFile(join(output, "mobile23-export.conta.json"), exported.text);
const proof = { status: "passed", repository: "lami216/Contamobile", commit, path: "approved-runtime/app.js", blob,
  androidVersionCode: 23, androidVersionName: "1.0.22", source: url, actualExporterExecuted: true,
  originalMobileValidationPassed: true,
  syntheticOnly: true, sourceDocuments: parsed.state.records.length, repeatedCommercialRowsPreserved: true, repeatedRecords, file: "mobile23-export.conta.json" };
await writeFile(join(output, "mobile23-source-proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
