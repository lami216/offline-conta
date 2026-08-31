import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const excluded = new Set([".git", ".next", "desktop-dist", "dist", "node_modules"]);
const sourceExtensions = new Set([".cjs", ".js", ".json", ".md", ".mjs", ".ts", ".tsx", ".yml", ".yaml"]);
const obsoleteName = `الكرن${"ة"}`;

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

test("visible Arabic brand spelling is authoritative across source, config, and docs", async () => {
  const appBrand = await readFile(join(root, "lib", "app-brand.ts"), "utf8");
  assert.match(appBrand, /APP_NAME = "الكرنه"/);
  const offenders = [];
  for (const file of await sourceFiles(root)) {
    if ((await readFile(file, "utf8")).includes(obsoleteName)) offenders.push(relative(root, file));
  }
  assert.deepEqual(offenders, [], `Obsolete visible brand spelling remains in: ${offenders.join(", ")}`);
});
