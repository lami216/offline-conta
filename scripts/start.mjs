import { spawn } from "node:child_process";
import { MongoClient } from "mongodb";
import { loadEnvFile } from "node:process";

const log = (level, event, details = {}) => (level === "error" ? console.error : console.log)(JSON.stringify({ time: new Date().toISOString(), level, event, ...details }));
try { loadEnvFile(".env.production.local"); } catch (error) { log("error", "startup.environment_failed", { error: { name: error.name, message: error.message } }); process.exit(1); }
log("info", "startup.started", { node: process.version });
if (!process.env.MONGODB_URI) { log("error", "startup.failed", { error: "MONGODB_URI is required" }); process.exit(1); }
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "conta");
  await db.command({ ping: 1 });
  log("info", "initialization.started");
  await Promise.all([
    db.collection("parties").createIndex({ name: 1 }), db.collection("parties").createIndex({ id: 1 }, { unique: true }), db.collection("parties").createIndex({ phone: 1 }),
    db.collection("products").createIndex({ id: 1 }, { unique: true }), db.collection("products").createIndex({ sku: 1 }, { unique: true }),
    db.collection("products").createIndex({ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: "string", $gt: "" } }, name: "barcode_unique_nonempty" }), db.collection("documents").createIndex({ id: 1 }, { unique: true }), db.collection("documents").createIndex({ number: 1 }, { unique: true }),
    db.collection("documents").createIndex({ partyId: 1, occurredAt: -1 }), db.collection("documents").createIndex({ kind: 1, occurredAt: -1 }), db.collection("stockMovements").createIndex({ warehouseId: 1, productId: 1, occurredAt: -1 }),
    db.collection("auditEvents").createIndex({ createdAt: -1 }),
  ]);
  const warehouses = db.collection("warehouses");
  await warehouses.updateOne({ _id: "wh-main" }, { $setOnInsert: { name: "المخزن الرئيسي", isSalesDefault: false, createdAt: new Date() } }, { upsert: true });
  await warehouses.updateOne({ _id: "wh-boutique" }, { $setOnInsert: { name: "البوتيك", isSalesDefault: true, createdAt: new Date() } }, { upsert: true });
  await client.close();
  log("info", "initialization.completed");
}
catch (error) { log("error", "startup.database_failed", { error: { name: error.name, message: error.message } }); process.exit(1); }
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", process.env.HOSTNAME || "127.0.0.1", "-p", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => { log(code ? "error" : "info", "startup.next_exited", { code, signal }); process.exit(code ?? 1); });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
