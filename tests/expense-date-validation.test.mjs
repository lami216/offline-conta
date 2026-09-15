import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "../app/api/command/route.ts";
import { sqliteHarness } from "./sqlite-harness.mjs";

const command=(db,body)=>db.transaction(session=>execute(db,session,body));

test("expense API rejects impossible calendar dates without creating a document",async t=>{
  const h=await sqliteHarness();t.after(()=>h.close());
  await h.db.collection("paymentAccounts").insertOne({id:"cash",code:"cash",name:"Cash",isActive:true,balance:1000});
  await assert.rejects(command(h.db,{type:"expense.post",title:"Bad date",amount:10,occurredAt:"2026-99-99",paymentMethod:"cash"}),/التاريخ غير صالح/);
  assert.equal(await h.db.collection("documents").countDocuments({kind:"expense"}),0);
  assert.equal((await h.db.collection("paymentAccounts").findOne({id:"cash"})).balance,1000);
});
