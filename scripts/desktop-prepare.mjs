import {cp, lstat, mkdir, readdir, readlink, realpath, rm, writeFile} from "node:fs/promises";
import path from "node:path";

const repositoryRoot = await realpath(process.cwd());
const output = path.join(repositoryRoot, "desktop-dist", "app");

await rm(path.dirname(output), {recursive: true, force: true});
await mkdir(output, {recursive: true});
await cp(path.join(repositoryRoot, ".next", "standalone"), output, {recursive: true});
await mkdir(path.join(output, ".next"), {recursive: true});
await cp(path.join(repositoryRoot, ".next", "static"), path.join(output, ".next", "static"), {recursive: true});
await cp(path.join(repositoryRoot, "public"), path.join(output, "public"), {recursive: true});
await cp(
  path.join(repositoryRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  path.join(output, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
);

// Turbopack emits hashed external-package aliases below .next/node_modules. On
// Windows they are junctions and fs.cp preserves their absolute build-tree
// targets; on POSIX fs.cp turns the relative links into absolute links too.
// Replace those aliases with relocatable shims to the one canonical staged copy.
const aliases = ["better-sqlite3", "sql.js"];
const aliasRoot = path.join(output, ".next", "node_modules");
for (const entry of await readdir(aliasRoot)) {
  const packageName = aliases.find((name) => entry.startsWith(`${name}-`));
  if (!packageName) continue;
  const aliasPath = path.join(aliasRoot, entry);
  const stat = await lstat(aliasPath);
  if (stat.isSymbolicLink()) console.log(`Replacing traced external link ${entry} -> ${await readlink(aliasPath)}`);
  await rm(aliasPath, {recursive: true, force: true});
  await mkdir(aliasPath, {recursive: true});
  await writeFile(path.join(aliasPath, "package.json"), JSON.stringify({private: true, main: "index.cjs"}));
  await writeFile(path.join(aliasPath, "index.cjs"), `module.exports = require(${JSON.stringify(`../../../node_modules/${packageName}`)});\n`);
}

for (const relative of [
  "node_modules/better-sqlite3",
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
]) {
  const physical = await realpath(path.join(output, relative));
  if (physical !== output && !physical.startsWith(`${output}${path.sep}`)) {
    throw new Error(`Staged runtime path escapes the app: ${relative} -> ${physical}`);
  }
  console.log(`Staged physical path: ${physical}`);
}
