import assert from "node:assert/strict";
import test from "node:test";
import { documentKindLabel, visibleDocumentKindLabels } from "../app/domain.ts";

test("party cash labels distinguish both directions for suppliers and customers",()=>{
  for(const [partyType,received,paid] of [
    ["supplier","استلام من المورد","دفع للمورد"],
    ["customer","استلام من العميل","دفع للعميل"],
    [undefined,"استلام من الطرف","دفع للطرف"],
  ]){
    assert.equal(documentKindLabel({kind:"payment",partyCashDirection:"receive"},partyType),received);
    assert.equal(documentKindLabel({kind:"payment",partyCashDirection:"pay"},partyType),paid);
  }
});

test("legacy payments and other document kinds remain compatible",()=>{
  assert.equal(documentKindLabel({kind:"payment"}),"سداد");
  assert.equal(documentKindLabel({kind:"payment",partyCashDirection:undefined},"supplier"),"سداد");
  assert.equal(documentKindLabel({kind:"purchase",partyCashDirection:"pay"},"supplier"),"فاتورة شراء");
  assert.equal(visibleDocumentKindLabels.payment,"دفع واستلام");
});
