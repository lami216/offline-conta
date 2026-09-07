import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: expected source fragment not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: source fragment is not unique`);
  await writeFile(path, source.slice(0, first) + after + source.slice(first + before.length));
}

await replaceOnce(
  'lib/sqlite.ts',
  '  products: "products", warehouses: "warehouses", parties: "parties", paymentAccounts: "payment_accounts",',
  '  products: "products", productCategories: "product_categories", warehouses: "warehouses", parties: "parties", paymentAccounts: "payment_accounts",',
);

await replaceOnce(
  'lib/sqlite.ts',
  'db.prepare("INSERT INTO schema_migrations VALUES(3,?)").run(new Date().toISOString())})()}cleanupExpiredRecords(db);',
  'db.prepare("INSERT INTO schema_migrations VALUES(3,?)").run(new Date().toISOString())})();version=3}if(version<4){db.transaction(()=>{db.exec(`CREATE TABLE IF NOT EXISTS product_categories(record_key TEXT PRIMARY KEY,data_json TEXT NOT NULL)`);db.prepare("INSERT INTO schema_migrations VALUES(4,?)").run(new Date().toISOString())})();version=4}cleanupExpiredRecords(db);',
);

await replaceOnce(
  'lib/backup.ts',
  'export const BACKUP_COLLECTIONS = ["parties", "warehouses", "products", "documents", "stockMovements", "financialMovements", "paymentAccounts", "recurringExpenses", "accountTransfers", "counters", "auditEvents", "appSettings", "users"] as const;',
  'export const BACKUP_COLLECTIONS = ["parties", "warehouses", "products", "productCategories", "documents", "stockMovements", "financialMovements", "paymentAccounts", "recurringExpenses", "accountTransfers", "counters", "auditEvents", "appSettings", "users"] as const;',
);

await replaceOnce(
  'lib/backup.ts',
  '  if (!b.collections || typeof b.collections !== "object" || Array.isArray(b.collections)) throw new Error("بنية collections غير صالحة");\n  const keys = Object.keys(b.collections);',
  '  if (!b.collections || typeof b.collections !== "object" || Array.isArray(b.collections)) throw new Error("بنية collections غير صالحة");\n  // Backups created before product categories existed have no productCategories collection.\n  // Normalize them to an empty collection so old customer backups remain restorable.\n  if (!Array.isArray(b.collections.productCategories)) b.collections.productCategories = [];\n  const keys = Object.keys(b.collections);',
);

await replaceOnce(
  'lib/backup.ts',
  '  const products = unique(b.collections.products, "id", "معرف المنتج"), warehouses = new Set(b.collections.warehouses.map(w => String(w._id ?? w.id))), accounts = unique(b.collections.paymentAccounts, "id", "معرف الحساب");',
  '  const products = unique(b.collections.products, "id", "معرف المنتج"), categories = unique(b.collections.productCategories ?? [], "id", "معرف الفئة"), warehouses = new Set(b.collections.warehouses.map(w => String(w._id ?? w.id))), accounts = unique(b.collections.paymentAccounts, "id", "معرف الحساب");',
);

await replaceOnce(
  'lib/backup.ts',
  '  for (const p of b.collections.products) for (const key of Object.keys((p.stocks ?? {}) as object)) if (!warehouses.has(key)) throw new Error("مخزون يشير إلى مخزن غير موجود");',
  '  for (const p of b.collections.products) { if (p.categoryId && !categories.has(String(p.categoryId))) throw new Error("منتج يشير إلى فئة غير موجودة"); for (const key of Object.keys((p.stocks ?? {}) as object)) if (!warehouses.has(key)) throw new Error("مخزون يشير إلى مخزن غير موجود"); }',
);

await replaceOnce(
  'lib/backup.ts',
  '    const rows = backup.collections[name];',
  '    const rows = backup.collections[name] ?? [];',
);

await replaceOnce(
  'tests/backup-restore-safety.test.mjs',
  'import { BACKUP_COLLECTIONS, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from "../lib/backup.ts";',
  'import { BACKUP_COLLECTIONS, createNativeBackup, parseAndValidateBackup, restoreNativeBackup, stringifyBackup } from "../lib/backup.ts";',
);

const sqliteTestPath = 'tests/sqlite-conformance.test.mjs';
let sqliteTests = await readFile(sqliteTestPath, 'utf8');
const sqliteTest = `\ntest('schema v4 adds product categories to an existing v3 database without touching business data',async()=>{await db.collection('products').insertOne({id:'keep-product',sku:'501',name:'Keep me'});db.native.exec('DROP TABLE product_categories; DELETE FROM schema_migrations WHERE version=4;');const {ensureDatabaseSchema}=await import('../lib/sqlite.ts');ensureDatabaseSchema(db.native);assert.equal((await db.collection('products').findOne({id:'keep-product'})).name,'Keep me');await db.collection('productCategories').insertOne({id:'category-1',name:'General'});assert.equal((await db.collection('productCategories').findOne({id:'category-1'})).name,'General');assert.equal(db.native.prepare('SELECT max(version) version FROM schema_migrations').get().version,4)});\n`;
if (!sqliteTests.includes("schema v4 adds product categories")) {
  sqliteTests += sqliteTest;
  await writeFile(sqliteTestPath, sqliteTests);
}

const backupTestPath = 'tests/backup-restore-safety.test.mjs';
let backupTests = await readFile(backupTestPath, 'utf8');
const backupTest = `\ntest("product categories survive backup/restore and pre-category backups remain compatible",async t=>{\n  const h=await sqliteHarness();t.after(()=>h.close());\n  await h.db.collection("productCategories").insertOne({id:"cat-drinks",name:"Drinks"});\n  await h.db.collection("products").insertOne({id:"categorized-product",sku:"501",name:"Juice",categoryId:"cat-drinks",stocks:{}});\n  const current=await createNativeBackup(h.db);\n  assert.equal(current.collections.productCategories[0].name,"Drinks");\n  await h.db.transaction(session=>restoreNativeBackup(h.db,current,session));\n  assert.equal((await h.db.collection("products").findOne({id:"categorized-product"})).categoryId,"cat-drinks");\n  assert.equal((await h.db.collection("productCategories").findOne({id:"cat-drinks"})).name,"Drinks");\n\n  const old=legacyBackup();\n  delete old.collections.productCategories;\n  delete old.counts.productCategories;\n  const parsed=parseAndValidateBackup(JSON.stringify(old));\n  assert.deepEqual(parsed.collections.productCategories,[]);\n  await h.db.transaction(session=>restoreNativeBackup(h.db,parsed,session));\n  assert.equal(await h.db.collection("productCategories").countDocuments(),0);\n  assert.ok(await h.db.collection("products").findOne({id:"legacy-product"}));\n});\n`;
if (!backupTests.includes('product categories survive backup/restore')) {
  backupTests += backupTest;
  await writeFile(backupTestPath, backupTests);
}

console.log('Applied category SQLite runtime and backup compatibility fix.');
