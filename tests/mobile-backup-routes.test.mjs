import test from "node:test";
import assert from "node:assert/strict";
import { sqliteHarness } from "./sqlite-harness.mjs";
import { mobileBackupV23 } from "./fixtures/mobile-backup-v23.mjs";
import { BACKUP_COLLECTIONS, createNativeBackup, parseAndValidateBackup, restoreNativeBackup } from "../lib/backup.ts";
import { CAPABILITIES, createSession, hashPassword, SESSION_COOKIE } from "../lib/auth.ts";
import { POST as preview } from "../app/api/settings/restore/preview/route.ts";
import { POST as restore } from "../app/api/settings/restore/route.ts";
import { POST as login } from "../app/api/auth/login/route.ts";
import { getCurrencySettings } from "../lib/currency-settings.ts";
import { getInvoiceBranding } from "../lib/invoice-branding.ts";
import { execute } from "../app/api/command/route.ts";

const origin = "http://127.0.0.1:3219";
function request(route, body, options = {}) {
  const headers = { origin, host: "127.0.0.1:3219", "content-type": "application/json", ...options.headers };
  if (options.user) headers.cookie = `${SESSION_COOKIE}=${createSession({ principalType: "user", userId: options.user })}`;
  return new Request(origin + route, { method: "POST", headers, body: JSON.stringify(body) });
}
async function desktopUser(db, id = "desktop-owner", permissions = CAPABILITIES) {
  const user = { id, username: id, usernameNormalized: id, name: "مدير الكمبيوتر", passwordHash: hashPassword("desktop-only-4826"), isActive: true, owner: false, permissions: [...permissions] };
  await db.collection("users").insertOne(user);
  return db.collection("users").findOne({ id });
}

test("mobile preview validates actual normalized counts and cannot write or leak phone credentials", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  await desktopUser(h.db);
  const before = await createNativeBackup(h.db), source = mobileBackupV23();
  const response = await preview(request("/api/settings/restore/preview", source, { user: "desktop-owner" }));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json(), converted = parseAndValidateBackup(JSON.stringify(source));
  assert.equal(result.sourceFormat, "alkarna-web-backup");
  assert.equal(result.preservesDesktopUsers, true);
  assert.deepEqual(result.counts, Object.fromEntries(BACKUP_COLLECTIONS.map(name => [name, converted.collections[name].length])));
  assert.equal(result.counts.users, 0);
  assert.equal(Object.hasOwn(result, "users"), false);
  assert.equal(Object.hasOwn(result, "state"), false);
  assert.deepEqual((await createNativeBackup(h.db)).collections, before.collections);
});

test("mobile preview and restore keep authorization and same-origin checks", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  await desktopUser(h.db);
  await desktopUser(h.db, "viewer", ["products.view"]);
  const source = mobileBackupV23(), before = await createNativeBackup(h.db);
  for (const [route, handler] of [["preview", preview], ["", restore]]) {
    const url = `/api/settings/restore${route ? "/" + route : ""}`;
    assert.equal((await handler(request(url, source))).status, 401);
    assert.equal((await handler(request(url, source, { user: "viewer" }))).status, 403);
    assert.equal((await handler(request(url, source, { user: "desktop-owner", headers: { origin: "https://other.invalid" } }))).status, 403);
  }
  assert.deepEqual((await createNativeBackup(h.db)).collections, before.collections);
});

test("mobile restore retains desktop credentials, saves prior data and forces a real desktop login", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const user = await desktopUser(h.db);
  await h.db.collection("products").insertOne({ id: "previous-product", sku: "991", name: "قبل الاستعادة", stocks: {} });
  const before = await createNativeBackup(h.db);
  const response = await restore(request("/api/settings/restore", mobileBackupV23(), { user: user.id }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).sessionReset, true);
  assert.match(response.headers.get("set-cookie"), /conta_session=;.*Max-Age=0/);
  assert.deepEqual(await h.db.collection("users").find().toArray(), [user]);
  assert.equal(await h.db.collection("products").findOne({ id: "previous-product" }), null);
  const recovery = await h.db.collection("restoreSnapshots").findOne({});
  assert.deepEqual(parseAndValidateBackup(recovery.backup).collections, before.collections);
  const form = new FormData(); form.set("username", user.username); form.set("password", "desktop-only-4826");
  const loggedIn = await login(new Request(origin + "/api/auth/login", { method: "POST", headers: { origin, host: "127.0.0.1:3219", "x-alkarna-login-ui": "1" }, body: form }));
  assert.equal(loggedIn.status, 200, await loggedIn.clone().text());
  assert.equal((await loggedIn.json()).ok, true);
  assert.match(loggedIn.headers.get("set-cookie"), /conta_session=[^;]+;/);
  const exported = await createNativeBackup(h.db);
  assert.equal(exported.mobileImport, undefined);
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(JSON.stringify(exported)), session));
  assert.deepEqual(await h.db.collection("users").find().toArray(), [user]);
});

test("invalid phone backup cannot change existing data or create a recovery snapshot", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  await desktopUser(h.db);
  const before = await createNativeBackup(h.db), bad = mobileBackupV23();
  bad.state.products[0].stocks["مخزن غير موجود"] = 2;
  const response = await restore(request("/api/settings/restore", bad, { user: "desktop-owner" }));
  assert.equal(response.status, 400);
  assert.deepEqual((await createNativeBackup(h.db)).collections, before.collections);
  assert.equal(await h.db.collection("restoreSnapshots").countDocuments(), 0);
});

test("native files cannot impersonate mobile imports to change restore policy", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const native = await createNativeBackup(h.db);
  native.mobileImport = { sourceFormat: "alkarna-web-backup", schemaVersion: 1 };
  assert.equal(parseAndValidateBackup(JSON.stringify(native)).mobileImport, undefined);
});

test("phone currency, shop identity and literal product notes survive without converting amounts", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const source = mobileBackupV23();
  source.state.currency = { code: "EUR", availableCodes: ["MRU", "EUR"] };
  source.state.branding = "متجر انتقال تجريبي";
  source.state.brandInfo = { phone: "00000000", address: "عنوان تجريبي", footer: "نص محفوظ" };
  source.state.products[0].note = "ملاحظة أصلية\nTexte conservé";
  const parsed = parseAndValidateBackup(JSON.stringify(source));
  await h.db.transaction(session => restoreNativeBackup(h.db, parsed, session));
  assert.equal((await getCurrencySettings(h.db)).code, "EUR");
  assert.deepEqual((await h.db.collection("paymentAccounts").find().toArray()).map(row => row.balance), source.state.accounts.map(row => row.balance));
  const branding = await getInvoiceBranding(h.db);
  assert.equal(branding.storeName, source.state.branding);
  assert.equal(branding.storePhone, source.state.brandInfo.phone);
  assert.equal(branding.storeAddress, source.state.brandInfo.address);
  assert.equal(branding.footerNote, source.state.brandInfo.footer);
  assert.equal((await h.db.collection("products").findOne({ id: "mobile23:product:" + source.state.products[0].id })).note, source.state.products[0].note);
});

test("imported opening baselines cannot be reinterpreted as ordinary editable inventory adjustments", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(JSON.stringify(mobileBackupV23())), session));
  const before = await createNativeBackup(h.db);
  const openings = before.collections.documents.filter(row => row.kind === "adjustment" && (row.mobileBaseline || row.mobileOpening));
  assert.ok(openings.length > 0);
  for (const original of openings) {
    for (const type of ["adjustment.update", "adjustment.void", "opening-stock-initial.void", "opening-stock-correction.update", "opening-stock-correction.void"]) {
      await assert.rejects(h.db.transaction(session => execute(h.db, session, { type, documentId: original.id, reason: "اختبار المصدر التاريخي" })), /سجل تاريخي/);
    }
  }
  assert.deepEqual((await createNativeBackup(h.db)).collections, before.collections);
});

test("a phone opening-account correction stays historical while new native corrections work normally", async t => {
  const h = await sqliteHarness(); t.after(() => h.close());
  const source = mobileBackupV23(), correction = source.state.records.find(row => row.id === 106);
  Object.assign(correction, { openingAccountCorrection: true, openingBalanceBefore: 1000, openingBalanceAfter: 1050 });
  source.state.accounts[0].openingBalance = 1050;
  await h.db.transaction(session => restoreNativeBackup(h.db, parseAndValidateBackup(JSON.stringify(source)), session));
  const original = await h.db.collection("documents").findOne({ id: "mobile23:record:106" });
  assert.equal(original.legacyKey, original.id, "The historical document uses the existing read-only source UI");
  const movement = await h.db.collection("financialMovements").findOne({ documentId: original.id, type: "opening-balance-correction" });
  assert.ok(movement);
  const command = body => h.db.transaction(session => execute(h.db, session, body));
  for (const type of ["account-opening-balance-correction.update", "account-opening-balance-correction.void"]) {
    await assert.rejects(command({ type, movementId: movement.id, newOpeningBalance: 1090, reason: "فحص" }), /سجل تاريخي/);
  }
  const nativeId = await command({ type: "account-opening-balance-correction.post", accountId: "mobile23:account:1", newOpeningBalance: 1070, reason: "تصحيح أصلي جديد" });
  const increased = await h.db.collection("paymentAccounts").findOne({ id: "mobile23:account:1" });
  assert.equal(increased.openingBalance, 1070); assert.equal(increased.balance, 1002);
  await command({ type: "account-opening-balance-correction.void", movementId: nativeId });
  const restored = await h.db.collection("paymentAccounts").findOne({ id: "mobile23:account:1" });
  assert.equal(restored.openingBalance, 1050); assert.equal(restored.balance, 982);
  assert.deepEqual(await h.db.collection("documents").findOne({ id: original.id }), original);
});
