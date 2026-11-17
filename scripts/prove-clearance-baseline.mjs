import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// This proof temporarily loads the known pre-fix implementation in the CI
// checkout only. It never starts an installed app or uses a customer profile.
assert(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && process.platform === "win32",
  "Run this counterfactual proof only in the isolated GitHub Windows job.");
const baseline = "230a2b2d7d60189e60113e5fc4e862a30f7bb44a";
const expectedTree = "f4e15283474dfdc55643c16c3db4480c2e007ee9";
const root = process.cwd();
const files = ["app/api/command/route.ts", "lib/transaction-lifecycle.ts"];
const runGit = args => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || "Git source lookup failed");
  return result.stdout;
};
runGit(["fetch", "--no-tags", "--depth=1", "origin", baseline]);
assert.equal(runGit(["show", "-s", "--format=%T", baseline]).trim(), expectedTree);
const snapshots = new Map(await Promise.all(files.map(async file => [file, await readFile(path.join(root, file))])));
try {
  for (const file of files) await writeFile(path.join(root, file), runGit(["show", `${baseline}:${file}`]));
  const proof = spawnSync(process.execPath, ["--import", "tsx", "--test", "tests/opening-clearance-post.test.mjs"], {
    cwd: root, env: { ...process.env, CLEARANCE_EXPECT_LEGACY_DEFECT: "1" },
    stdio: "inherit", windowsHide: true, timeout: 120000,
  });
  assert.equal(proof.status, 0, proof.error?.message || "The original source did not reproduce both diagnosed defects.");
  console.log("BEFORE FIX: reproduced both native clearance defects with actual POST requests.");
} finally {
  for (const [file, bytes] of snapshots) {
    await writeFile(path.join(root, file), bytes);
    assert.deepEqual(await readFile(path.join(root, file)), bytes);
  }
  runGit(["diff", "--exit-code", "--", ...files]);
  console.log("Restored the exact candidate source before UI, full-suite and package checks.");
}
