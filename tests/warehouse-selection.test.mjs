import test from "node:test";
import assert from "node:assert/strict";
import { defaultWarehouse, soleWarehouseId, warehouseSelectionId } from "../app/warehouse-selection.ts";

test("sole active warehouse defaults new drafts while historical selections remain unchanged",()=>{
  const warehouses=[{id:"old",isArchived:true},{id:"sole"}];
  assert.equal(soleWarehouseId(warehouses),"sole");
  assert.equal(defaultWarehouse(warehouses)?.id,"sole");
  assert.equal(warehouseSelectionId(warehouses),"sole");
  assert.equal(warehouseSelectionId(warehouses,"old",true),"old");
  assert.equal(warehouseSelectionId(warehouses,"",true),"");
  const multiple=[{id:"a"},{id:"b",isSalesDefault:true}];
  assert.equal(warehouseSelectionId(multiple),"");
  assert.equal(defaultWarehouse(multiple)?.id,"b");
  assert.equal(warehouseSelectionId(multiple,"a"),"a");
  assert.equal(soleWarehouseId([]),"");
});
