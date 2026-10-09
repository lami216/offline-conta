import assert from "node:assert/strict";
import test,{after,before,beforeEach} from "node:test";
import {readFile} from "node:fs/promises";
import {sqliteHarness} from "./sqlite-harness.mjs";
import {execute} from "../app/api/command/route.ts";

let harness,db;
before(async()=>{harness=await sqliteHarness();db=harness.db});
after(async()=>{await harness.close()});
beforeEach(async()=>{
  await harness.reset();
  await db.collection("warehouses").insertMany([
    {_id:"a",name:"A",isSalesDefault:true},
    {_id:"b",name:"B",isSalesDefault:false},
  ]);
});
const command=body=>db.transaction(session=>execute(db,session,body));
const insertProduct=async({id="p",stocks={a:4,b:6},isArchived=false}={})=>{
  await db.collection("products").insertOne({
    id,name:"Test product",sku:`SKU-${id}`,barcode:`BAR-${id}`,
    pieceCost:10,lastPurchaseCost:10,lastPurchaseCostSource:"purchase",piecePrice:20,wholesalePrice:18,
    openingStock:0,openingCost:null,openingWarehouseId:null,stocks,isArchived,archivedAt:isArchived?new Date():null,createdAt:new Date(),
  });
};

test("deleting stocked product requires explicit zeroStock confirmation and changes nothing without it",async()=>{
  await insertProduct();
  await assert.rejects(command({type:"product.delete",id:"p"}),/تصفير المخزون/);
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,false);
  assert.deepEqual(product.stocks,{a:4,b:6});
  assert.equal(await db.collection("documents").countDocuments({productArchiveStockClearance:true}),0);
  assert.equal(await db.collection("stockMovements").countDocuments({productId:"p"}),0);
});

test("confirmed product deletion links warehouse corrections and reversing one restores every warehouse and the product",async()=>{
  await insertProduct();
  assert.equal(await command({type:"product.delete",id:"p",zeroStock:true}),"p");
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,true);
  assert.deepEqual(product.stocks,{a:0,b:0});
  const docs=await db.collection("documents").find({productArchiveStockClearance:true}).sort({warehouseId:1}).toArray();
  assert.equal(docs.length,2);
  assert.ok(docs[0].productArchiveStockClearanceGroupId);
  assert.equal(docs[0].productArchiveStockClearanceGroupId,docs[1].productArchiveStockClearanceGroupId);
  assert.deepEqual(docs.map(d=>[d.kind,d.warehouseId,d.title,d.status,d.lines[0].balanceBefore,d.lines[0].balanceAfter]),[
    ["adjustment","a","تصفير المخزون المرتبط بأرشفة المنتج","posted",4,0],
    ["adjustment","b","تصفير المخزون المرتبط بأرشفة المنتج","posted",6,0],
  ]);
  const movements=await db.collection("stockMovements").find({productId:"p"}).sort({warehouseId:1}).toArray();
  assert.deepEqual(movements.map(m=>[m.warehouseId,m.type,m.quantityDelta,m.balanceBefore,m.balanceAfter]),[
    ["a","adjustment",-4,4,0],["b","adjustment",-6,6,0],
  ]);
  await assert.rejects(command({type:"adjustment.update",documentId:docs[0].id,reason:"x",lines:[{productId:"p",actualQuantity:4}]}),/أرشفة المنتج/);
  await command({type:"adjustment.void",documentId:docs[0].id});
  const restored=await db.collection("products").findOne({id:"p"});
  assert.equal(restored.isArchived,false);
  assert.deepEqual(restored.stocks,{a:4,b:6});
  const reversed=await db.collection("documents").find({productArchiveStockClearance:true}).sort({warehouseId:1}).toArray();
  assert.deepEqual(reversed.map(d=>[d.warehouseId,d.status,d.productArchiveStockClearanceRestored]),[["a","voided",true],["b","voided",true]]);
  const reversalMovements=await db.collection("stockMovements").find({productId:"p",type:"adjustment-void"}).sort({warehouseId:1}).toArray();
  assert.deepEqual(reversalMovements.map(m=>[m.warehouseId,m.quantityDelta,m.balanceBefore,m.balanceAfter]),[["a",4,0,4],["b",6,0,6]]);
});

test("zero-stock product archives directly without synthetic adjustment",async()=>{
  await insertProduct({stocks:{a:0,b:0}});
  await command({type:"product.delete",id:"p"});
  assert.equal((await db.collection("products").findOne({id:"p"})).isArchived,true);
  assert.equal(await db.collection("documents").countDocuments({productArchiveStockClearance:true}),0);
});

test("legacy archived product can be stock-zeroed without being restored",async()=>{
  await insertProduct({stocks:{a:3,b:0},isArchived:true});
  await command({type:"product.stock-zero",id:"p"});
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,true);
  assert.deepEqual(product.stocks,{a:0,b:0});
  const docs=await db.collection("documents").find({productArchiveStockClearance:true}).toArray();
  assert.equal(docs.length,1);
  assert.equal(docs[0].warehouseId,"a");
});

test("product restore reverses the linked archive clearance instead of reviving an empty product",async()=>{
  await insertProduct({stocks:{a:2,b:5}});
  await command({type:"product.delete",id:"p",zeroStock:true});
  await command({type:"product.restore",id:"p"});
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,false);
  assert.deepEqual(product.stocks,{a:2,b:5});
  assert.equal(await db.collection("documents").countDocuments({productArchiveStockClearance:true,status:"posted"}),0);
});

test("legacy ungrouped multi-warehouse archive corrections reverse together",async()=>{
  await insertProduct({stocks:{a:0,b:0},isArchived:true});
  const occurredAt="2026-09-29T10:00:00.000Z";
  await db.collection("documents").insertMany([
    {id:"legacy-a",number:"ADJ-A",kind:"adjustment",status:"posted",occurredAt,revision:0,productArchiveStockClearance:true,warehouseId:"a",warehouseName:"A",title:"تصفير المخزون المرتبط بأرشفة المنتج",lines:[{id:"la",productId:"p",quantity:-4,balanceBefore:4,balanceAfter:0}]},
    {id:"legacy-b",number:"ADJ-B",kind:"adjustment",status:"posted",occurredAt:"2026-09-29T10:00:01.000Z",revision:0,productArchiveStockClearance:true,warehouseId:"b",warehouseName:"B",title:"تصفير المخزون المرتبط بأرشفة المنتج",lines:[{id:"lb",productId:"p",quantity:-6,balanceBefore:6,balanceAfter:0}]},
  ]);
  await command({type:"adjustment.void",documentId:"legacy-a"});
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,false);
  assert.deepEqual(product.stocks,{a:4,b:6});
  assert.equal(await db.collection("documents").countDocuments({productArchiveStockClearance:true,status:"posted"}),0);
});

test("product.stock-zero is restricted to already archived products",async()=>{
  await insertProduct({stocks:{a:1},isArchived:false});
  await assert.rejects(command({type:"product.stock-zero",id:"p"}),/مؤرشف/);
  assert.deepEqual((await db.collection("products").findOne({id:"p"})).stocks,{a:1});
});

test("multi-warehouse clearance rolls back atomically when any stocked warehouse is invalid",async()=>{
  await insertProduct({stocks:{a:4,missing:2}});
  await assert.rejects(command({type:"product.delete",id:"p",zeroStock:true}),/تعذر تصفير المخزون/);
  const product=await db.collection("products").findOne({id:"p"});
  assert.equal(product.isArchived,false);
  assert.deepEqual(product.stocks,{a:4,missing:2});
  assert.equal(await db.collection("documents").countDocuments({productArchiveStockClearance:true}),0);
  assert.equal(await db.collection("stockMovements").countDocuments({productId:"p"}),0);
});

test("UI and permission wiring expose archive-clearance reversal while keeping the correction non-editable",async()=>{
  const [app,route,lifecycle]=await Promise.all([
    readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),
    readFile(new URL("../app/api/command/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/transaction-lifecycle.ts",import.meta.url),"utf8"),
  ]);
  assert.match(route,/"product\.stock-zero"\s*:\s*"products\.delete"/);
  assert.match(app,/type:"product\.delete",id:product\.id,[\s\S]{0,80}zeroStock:true/);
  assert.match(app,/type:"product\.stock-zero",id:product\.id/);
  assert.match(route,/تصفير المخزون المرتبط بأرشفة المنتج/);
  assert.match(app,/product\.isArchived[\s\S]{0,500}تصفير المخزون/);
  assert.match(app,/isProductArchiveStockClearanceDocument/);
  assert.match(lifecycle,/restoreProductArchiveStockClearance/);
  assert.match(lifecycle,/sameLegacyClearanceBatch/);
  assert.match(app,/onVoid=\{canDelete\?\(\)=>void remove\(document\)/);
});

test("products page switches exclusively between active and archived products",async()=>{
  const app=await readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8");
  assert.match(app,/data\.products\.filter\(product\s*=>\s*showArchived\s*\?\s*product\.isArchived\s*===\s*true\s*:\s*product\.isArchived\s*!==\s*true\)/);
  assert.doesNotMatch(app,/showArchived\s*\|\|\s*!product\.isArchived/);
});
