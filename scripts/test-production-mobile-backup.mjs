import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true" || process.platform !== "win32") throw new Error("Production mobile restore proof is CI-only on Windows.");
assert(process.execArgv.includes("--test") || process.env.NODE_TEST_CONTEXT !== undefined, "Run this proof with the genuine Node test runner");
const source = await readFile("test-output/mobile-backup-ui/mobile23-export.conta.json", "utf8");
const raw = JSON.parse(source);
const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;
const reservation = net.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
const port = reservation.address().port; await new Promise(done => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), "alkarna-mobile-production-"));
const environment = { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", ALKARNA_DESKTOP: "1", ALKARNA_USER_DATA: directory,
  ALKARNA_DATABASE_PATH: join(directory, "data", "alkarna.sqlite"), ALKARNA_LICENSE_STATE_PATH: join(directory, "license-state.json"),
  ALKARNA_LICENSE_DISABLE_REGISTRY: "1", ALKARNA_TEST_LICENSE_BYPASS: "1" };
delete environment.ALKARNA_DESKTOP_TOKEN;
delete environment.ALKARNA_TEST_DEVICE_ID;
const server = spawn(process.execPath, ["server.js"], { cwd: ".next/standalone", windowsHide: true,
  env: environment, stdio: ["ignore", "pipe", "pipe"] });
const closed = once(server, "close"); let logs = "", cookie = "";
server.stdout.on("data", data => logs += data); server.stderr.on("data", data => logs += data);
async function call(route, body, extraHeaders = {}) {
  const response = await fetch(origin + route, { method: body === undefined ? "GET" : "POST",
    headers: { origin, host: `127.0.0.1:${port}`, "x-forwarded-proto": "http", ...(cookie ? { cookie } : {}),
      ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }), ...extraHeaders },
    ...(body === undefined ? {} : { body: typeof body === "string" || body instanceof FormData ? body : JSON.stringify(body) }) });
  return response;
}
async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text()); return response.json();
}
async function login() {
  const form = new FormData(); form.set("username", "mobile-restore-manager"); form.set("password", "desktop-password-6631");
  const response = await call("/api/auth/login", form, { "x-alkarna-login-ui": "1" });
  assert.equal((await json(response)).ok, true); cookie = response.headers.get("set-cookie").split(";")[0];
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(origin + "/login")).status < 500) { ready = true; break; } } catch {} if (server.exitCode !== null) break; await delay(250); }
  assert.equal(ready, true, "Compiled production server started");
  const created = await call("/api/settings/users", { username: "mobile-restore-manager", name: "مدير اختبار مستقل", password: "desktop-password-6631",
    permissions: ["settings.users.manage", "settings.backup.manage", "settings.view", "reports.view", "products.view", "warehouses.view", "warehouses.inventory.view", "banks.view", "banks.movements.view", "customers.view", "suppliers.view", "records.view"] });
  await json(created, 201); cookie = created.headers.get("set-cookie").split(";")[0];
  const before = await json(await call("/api/settings/backup"));
  const plan = await json(await call("/api/settings/restore/preview", source));
  assert.equal(plan.sourceFormat, "alkarna-web-backup"); assert.equal(plan.preservesDesktopUsers, true);
  assert.equal(plan.counts.products, raw.state.products.length); assert.equal(plan.counts.parties, raw.state.parties.length);
  assert.deepEqual((await json(await call("/api/settings/backup"))).collections, before.collections, "Preview cannot mutate existing data");
  assert.equal((await call("/api/settings/restore", source, { origin: "https://foreign.invalid" })).status, 403);
  const restored = await call("/api/settings/restore", source);
  assert.equal((await json(restored)).sessionReset, true); assert.match(restored.headers.get("set-cookie"), /Max-Age=0/);
  cookie = ""; assert.equal((await call("/api/bootstrap")).status, 401, "Restoration does not grant a new login");
  await login();
  const exported = await json(await call("/api/settings/backup"));
  assert.equal(exported.format, "conta-backup"); assert.equal(exported.appVersion, packageVersion);
  assert.equal(exported.collections.users.length, 1); assert.equal(exported.collections.users[0].username, "mobile-restore-manager");
  assert.equal(exported.collections.products.length, raw.state.products.length);
  assert.equal(exported.collections.parties.length, raw.state.parties.length);
  for (const type of ["overview", "stock", "financial", "party-ledger"]) {
    const report = await call(`/api/reports?type=${type}&partyType=customer&allTime=true&unpaged=true`);
    // A party ledger without a selected party may return a useful validation error,
    // never an internal failure; the UI suite selects actual imported parties.
    assert.ok(report.status === 200 || type === "party-ledger" && report.status === 400, `${type}: ${await report.clone().text()}`);
  }
  const second = await call("/api/settings/restore", exported); assert.equal((await json(second)).restored, true);
  cookie = ""; await login();
  const after = await json(await call("/api/settings/backup"));
  for (const name of ["products", "parties", "paymentAccounts", "documents", "stockMovements", "financialMovements", "users"]) {
    assert.deepEqual(after.collections[name], exported.collections[name], "Desktop backup round trip preserves " + name);
  }
  const proof = { status: "passed", compiledProductionServer: true, originalMobile23Export: true, previewReadOnly: true, sameOriginEnforced: true,
    restored: true, desktopLoginPreserved: true, phoneSessionsNotImported: true, nativeBackupRoundTrip: true,
    counts: plan.counts, localApplicationOrTestExecution: false };
  await writeFile("test-output/mobile-backup-ui/production-restore-result.json", JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
} catch (error) { throw new Error(`${error.message}\nProduction server logs:\n${logs}`); }
finally {
  if (server.exitCode === null) server.kill("SIGTERM"); await closed;
  const actual = await realpath(directory), temporary = await realpath(tmpdir()), contained = relative(temporary, actual);
  assert.ok(contained && !contained.startsWith("..") && basename(actual).startsWith("alkarna-mobile-production-"));
  assert.notEqual(actual, resolve(process.cwd()));
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
