import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sqliteHarness } from "./sqlite-harness.mjs";
import { GET as bootstrap } from "../app/api/bootstrap/route.ts";
import { createSession } from "../lib/auth.ts";

let harness, db;
before(async () => { harness = await sqliteHarness(); db = harness.db; });
after(async () => { await harness.close(); });
beforeEach(async () => {
  await harness.reset();
  await db.collection("paymentAccounts").insertMany([
    { id:"cash", code:"cash", name:"Cash", isActive:true, balance:100 },
    { id:"bank", code:"bank", name:"Bank", isActive:true, balance:0 },
  ]);
  await db.collection("accountTransfers").insertOne({ id:"transfer-1", documentId:"transfer-1", number:"BTR-1", fromAccountId:"cash", toAccountId:"bank", amount:25, occurredAt:"2026-09-16T12:00:00.000Z", status:"posted", revision:0 });
});

test("bank workspace viewers receive posted transfers even without transfer-create permission", async () => {
  await db.collection("users").insertOne({ id:"viewer", username:"viewer", name:"Viewer", isActive:true, permissions:["banks.view","banks.transfer.edit"] });
  const token=createSession({principalType:"user",userId:"viewer"});
  const response=await bootstrap(new Request("http://localhost/api/bootstrap",{headers:{Cookie:`conta_session=${token}`}}));
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.accountTransfers.length,1);
  assert.equal(data.accountTransfers[0].id,"transfer-1");
});
