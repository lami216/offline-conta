import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import { sqliteHarness } from "./sqlite-harness.mjs";
import { execute } from "../app/api/command/route.ts";
import { bankScopeMetrics } from "../app/bank-filters.ts";
import { formatMoney, formatQuantity } from "../app/domain.ts";

let harness,db;
before(async()=>{harness=await sqliteHarness();db=harness.db});
after(async()=>harness.close());
beforeEach(async()=>{
 await harness.reset();
 await db.collection("warehouses").insertMany([{_id:"a",name:"A",isSalesDefault:false},{_id:"b",name:"B",isSalesDefault:true}]);
 await db.collection("products").insertOne({id:"p",sku:"1",name:"Tea",piecePrice:10,lastPurchaseCost:5,stocks:{a:1,b:0}});
 await db.collection("parties").insertOne({id:"c",name:"Customer",partyType:"customer",receivable:0,payable:0,net:0});
 await db.collection("paymentAccounts").insertMany([{id:"cash",code:"cash",name:"Cash",isActive:true,balance:100},{id:"bank",code:"bank",name:"Bank",isActive:true,balance:0}]);
});
const command=body=>db.transaction(session=>execute(db,session,body));

test("voiding an old sale reactivates an archived warehouse before returned stock becomes hidden",async()=>{
 const sale=await command({type:"sale.post",warehouseId:"a",paymentMethod:"cash",lines:[{productId:"p",quantity:1,piecePrice:10}]});
 assert.equal((await db.collection("products").findOne({id:"p"})).stocks.a,0);
 await command({type:"warehouse.delete",id:"a"});
 assert.equal((await db.collection("warehouses").findOne({_id:"a"})).isArchived,true);
 await command({type:"sale.void",documentId:sale});
 assert.equal((await db.collection("products").findOne({id:"p"})).stocks.a,1);
 assert.equal((await db.collection("warehouses").findOne({_id:"a"})).isArchived,false);
});

test("voiding history reactivates an archived party when its balance becomes nonzero",async()=>{
 const sale=await command({type:"sale.post",warehouseId:"a",partyId:"c",paymentMethod:"note",lines:[{productId:"p",quantity:1,piecePrice:10}]});
 await command({type:"party.delete",id:"c",settleBalance:true});
 assert.equal((await db.collection("parties").findOne({id:"c"})).isArchived,true);
 await command({type:"sale.void",documentId:sale});
 const party=await db.collection("parties").findOne({id:"c"});
 assert.equal(party.isArchived,false);
 assert.notEqual(Number(party.receivable??0)-Number(party.payable??0),0);
});

test("reversing a movement on an archived payment account automatically restores the account",async()=>{
 await command({type:"account-adjustment.post",accountId:"bank",direction:"deposit",amount:5});
 const withdrawal=await command({type:"account-adjustment.post",accountId:"bank",direction:"withdrawal",amount:5});
 assert.equal((await db.collection("paymentAccounts").findOne({id:"bank"})).balance,0);
 await command({type:"payment-account.delete",accountId:"bank"});
 assert.equal((await db.collection("paymentAccounts").findOne({id:"bank"})).isArchived,true);
 await command({type:"account-adjustment.void",documentId:withdrawal});
 const bank=await db.collection("paymentAccounts").findOne({id:"bank"});
 assert.deepEqual([bank.isArchived,bank.isActive,bank.balance],[false,true,5]);
});

test("inactive non-archived accounts remain part of the current balance",()=>{
 const summary=bankScopeMetrics([{id:"a",code:"a",name:"A",balance:90,isActive:true},{id:"b",code:"b",name:"B",balance:40,isActive:false}],[],[]);
 assert.equal(summary.currentBalance,130);
});

test("fractional stored values are displayed without silent integer rounding",()=>{
 assert.match(formatQuantity(1.5),/1[,.]5/);
 assert.match(formatMoney(8.6),/8[,.]6/);
});

test("edit identities survive reload, navigation is guarded, and barcode capture excludes ordinary form inputs",async()=>{
 const source=await readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8");
 assert.match(source,/useSessionDraft<string \| null>\("sale-editing-document", null\)/);
 assert.match(source,/useSessionDraft<string \| null>\("purchase-editing-document", null\)/);
 assert.match(source,/useSessionDraft<string\|null>\("expense-editing-document",null\)/);
 assert.match(source,/guard\?\.isEditing\(\)/);
 assert.match(source,/guard\.discard\(\)/);
 assert.match(source,/data-barcode-scanner-input="true"/);
 assert.match(source,/closest\("input, textarea, select, \[contenteditable='true'\]"\)/);
});

test("login clears accounting session drafts between users",async()=>{
 const source=await readFile(new URL("../app/login/page.tsx",import.meta.url),"utf8");
 assert.match(source,/key\.startsWith\("conta:"\)/);
});
