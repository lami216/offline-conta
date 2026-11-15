import assert from 'node:assert/strict';
import test from 'node:test';
import {buildWarehouseInventory,inventoryProductQuantity,inventoryQuantityLabel} from '../app/warehouse-inventory-model.ts';
import {inventoryAverageUnitCostAcrossWarehouses,inventoryValueAcrossWarehouses} from '../app/domain.ts';

const product=(id,name,categoryId,stocks,cost)=>({id,name,sku:'sku-'+id,barcode:'barcode-'+id,categoryId,stocks,lastPurchaseCost:cost,pieceCost:999,piecePrice:50});
const products=[product('a','Synthetic Alpha','one',{w:3,other:2},10),product('b','Synthetic Beta','two',{w:1,other:4},20),product('empty','Synthetic empty','one',{w:0,other:0},100)];

test('warehouse grid membership, counts, quantity and book value share the same selected scope',()=>{
 const before=structuredClone(products),all=buildWarehouseInventory({products,warehouseIds:['w','other']}),single=buildWarehouseInventory({products,warehouseIds:['w']});
 assert.deepEqual(all.products.map(row=>row.id),['a','b']);assert.deepEqual(all.summary,{count:2,pieces:10,value:150});
 assert.deepEqual(single.summary,{count:2,pieces:4,value:50});assert.equal(inventoryProductQuantity(products[0],['w']),3);assert.deepEqual(products,before);
});

test('category and name/code/barcode search narrow the rows and all three summary values together',()=>{
 for(const query of ['alpha','sku-a','barcode-a']){
  const result=buildWarehouseInventory({products,warehouseIds:['w','other'],categoryId:'one',query});
  assert.deepEqual(result.products.map(row=>row.id),['a']);assert.deepEqual(result.summary,{count:1,pieces:5,value:50});
 }
 const mismatch=buildWarehouseInventory({products,warehouseIds:['w','other'],categoryId:'one',query:'Beta'});assert.deepEqual(mismatch.products,[]);assert.deepEqual(mismatch.summary,{count:0,pieces:0,value:0});
 const unavailable=buildWarehouseInventory({products,warehouseIds:['missing']});assert.deepEqual(unavailable.summary,{count:0,pieces:0,value:0});
});

test('ordinary stock valuation preserves its existing accounting-cost fallback and never uses the product-card price',()=>{
 const opening=product('opening','Synthetic opening','one',{w:2},null);opening.openingCost=12;
 assert.equal(inventoryValueAcrossWarehouses(opening,['w']),24);assert.equal(inventoryAverageUnitCostAcrossWarehouses(opening,['w']),12);
 const zero={...opening,lastPurchaseCost:0};assert.equal(inventoryValueAcrossWarehouses(zero,['w']),0);assert.equal(inventoryAverageUnitCostAcrossWarehouses(zero,['w']),0);
 assert.equal(inventoryValueAcrossWarehouses(opening,[]),0);
 assert.equal(inventoryQuantityLabel({count:1,pieces:2.5,value:30},{pieces:'وحدة',format:String}),'2.5 وحدة');
});
