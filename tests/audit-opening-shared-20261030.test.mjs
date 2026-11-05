import assert from 'node:assert/strict';
import test from 'node:test';
import {sqliteHarness} from './sqlite-harness.mjs';
import {execute} from '../app/api/command/route.ts';
import {deriveOpeningStockState} from '../lib/opening-stock.ts';
test('A01 general purchase warehouse edit preserves ten native opening units and permits their independent cancellation',async t=>{
 const h=await sqliteHarness();t.after(()=>h.close());await h.reset();const db=h.db,run=body=>db.transaction(s=>execute(db,s,body));
 await db.collection('warehouses').insertMany([{_id:'a',name:'A',isSalesDefault:true},{_id:'b',name:'B'}]);
 await db.collection('paymentAccounts').insertOne({id:'cash',code:'cash',name:'Cash',isActive:true,balance:10000});
 const id=await run({type:'product.create',name:'Shared source audit',pieceCost:50,piecePrice:100,openingStock:10,openingWarehouseId:'a'});
 const purchase=await run({type:'purchase.post',warehouseId:'a',paymentMethod:'cash',lines:[{productId:id,quantity:5,unitPrice:60}]});
 await run({type:'purchase.update',documentId:purchase,warehouseId:'b',paymentMethod:'cash',lines:[{productId:id,quantity:5,unitPrice:60}]});
 const product=await db.collection('products').findOne({id}),state=await deriveOpeningStockState(db,undefined,product);
 assert.deepEqual([state.remaining,state.consumed,state.allocations],[10,0,{a:10}]);
 const opening=await db.collection('documents').findOne({'lines.productId':id,title:'رصيد بداية'});
 await run({type:'opening-stock-initial.void',documentId:opening.id});
 assert.deepEqual((await db.collection('products').findOne({id})).stocks,{a:0,b:5});
 assert.equal((await db.collection('documents').findOne({id:purchase})).status,'posted');
});
