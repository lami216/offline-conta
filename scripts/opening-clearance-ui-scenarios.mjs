import assert from "node:assert/strict";
import { captureControlLayouts } from "./ui-control-bounds.mjs";

/** Real Products/POS/Adjustment/OpeningHistory interactions in the CI-owned profile. */
export async function runOpeningClearanceScenarios({ cdp, origin, database, screenshot }) {
  assert.equal(process.env.CI,"true");assert.equal(process.env.GITHUB_ACTIONS,"true");
  const evaluate=expression=>cdp.evaluate(expression),checkpoints=[],layouts=[];
  const until=async(check,label)=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error("Timed out waiting for "+label)};
  const fill=(selector,value)=>evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error("Missing lifecycle field "+${JSON.stringify(selector)});const prototype=input.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  const fillLabel=(label,value)=>evaluate(`(()=>{const row=[...document.querySelectorAll(".product-form label")].find(label=>label.firstChild?.textContent.trim()===${JSON.stringify(label)}),input=row?.querySelector("input");if(!input)throw Error("Missing product label "+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  const click=selector=>evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error("Unavailable lifecycle action "+${JSON.stringify(selector)});button.click()})()`);
  const confirm=async()=>{await until(()=>evaluate('Boolean(document.querySelector(".app-confirm-dialog"))'),"lifecycle confirmation");await click(".app-confirm-actions button:first-child");await until(()=>evaluate('!document.querySelector(".app-confirm-dialog")'),"confirmation closed")};
  const view=async(name,selector)=>{await evaluate(`window.__smokeSetView(${JSON.stringify(name)})`);await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),name+" native screen")};
  const bootstrap=await(await fetch(origin+"/api/bootstrap")).json(),warehouse=bootstrap.warehouses.find(row=>row.isSalesDefault&&!row.isArchived),cash=bootstrap.paymentAccounts.find(row=>row.code==="cash");
  assert(warehouse&&cash);
  const balances=async()=>(await database.collection("paymentAccounts").find().toArray()).map(row=>[row.id,row.balance]).sort();
  const beforeBalances=await balances();
  const product=fixture=>database.collection("products").findOne({id:fixture.id});
  const waitProduct=async(fixture,stock,archived)=>until(async()=>{const current=await product(fixture);return Number(current?.stocks?.[warehouse.id]??0)===stock&&Boolean(current?.isArchived)===archived&&await evaluate("!window.__payrollBusy")},fixture.name+" stock"+stock+" archived"+archived);
  const productAction=async(fixture,label)=>{
    await evaluate(`(()=>{const row=[...document.querySelectorAll(".product-management tbody tr")].find(row=>row.querySelector(".product-name-hover")?.title===${JSON.stringify(fixture.name)}),button=[...(row?.querySelectorAll(".action-cell button")??[])].find(button=>button.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error("Missing product action "+${JSON.stringify(label)});button.click()})()`);
  };
  const showProduct=async(fixture,archived=false)=>{
    await view("products",".products-page");
    await fill(".products-page .workspace-toolbar input",fixture.name);
    const pressed=await evaluate('document.querySelector(".products-page .workspace-toolbar .selection-option").getAttribute("aria-pressed")==="true"');
    if(pressed!==archived)await click(".products-page .workspace-toolbar .selection-option");
    await until(()=>evaluate(`[...document.querySelectorAll(".product-management .product-name-hover")].some(name=>name.title===${JSON.stringify(fixture.name)})`),"product in native "+(archived?"archive":"active")+" list");
  };
  const createOpened=async(name,quantity,cost,price)=>{
    await view("products",".products-page");await click(".products-page .workspace-toolbar button.primary");
    await until(()=>evaluate('Boolean(document.querySelector(".product-form"))'),"new product form");
    for(const[label,value]of [["اسم المنتج",name],["سعر الشراء للفرد",cost],["سعر البيع للفرد",price],["رصيد البداية",quantity]])await fillLabel(label,value);
    await click(".product-form-actions button.primary");
    let created;
    await until(async()=>{created=await database.collection("products").findOne({name});return created&&await evaluate('!window.__payrollBusy&&!document.querySelector(".product-form")')},"product created through form");
    const opening=(await database.collection("documents").find({kind:"adjustment",status:"posted"}).toArray()).find(document=>document.title==="رصيد بداية"&&document.lines.some(line=>line.productId===created.id));
    assert(opening);const fixture={id:created.id,name,opening,quantity,cost,price};await waitProduct(fixture,quantity,false);return fixture;
  };
  const sale=async(fixture,quantity)=>{
    await view("sale",".pos-workspace");await fill('.pos-workspace .search-panel input[aria-label="بحث المنتج"]',fixture.name);
    await until(()=>evaluate(`Boolean(document.getElementById(${JSON.stringify("product-result-"+fixture.id)}))`),"sale product search");
    await evaluate(`document.getElementById(${JSON.stringify("product-result-"+fixture.id)}).click()`);
    await until(()=>evaluate('Boolean(document.querySelector(".pos-workspace .invoice-line-total-input"))'),"sale row");
    await fill(".pos-workspace .invoice-table tbody tr td:nth-child(2) input",quantity);await fill(".pos-workspace .compact-payment select",cash.id);
    await click(".pos-workspace .checkout-footer button.primary.wide");
    let document;
    await until(async()=>{document=(await database.collection("documents").find({kind:"sale",status:"posted"}).toArray()).find(row=>row.lines.some(line=>line.productId===fixture.id));return document&&await evaluate('!window.__payrollBusy&&!document.querySelector(".pos-workspace .invoice-line-total-input")')},"native sale committed");
    assert.equal(document.total,quantity*fixture.price);assert.equal(document.lines[0].costAtSale,fixture.cost);
    const report=await(await fetch(origin+"/api/reports?"+new URLSearchParams({type:"sales",allTime:"true",unpaged:"true",productId:fixture.id}))).json();
    assert.deepEqual([report.summary.netSales,report.summary.cost,report.summary.profit],[quantity*fixture.price,quantity*fixture.cost,quantity*(fixture.price-fixture.cost)]);
    return document;
  };
  const archive=async(fixture,remaining)=>{await showProduct(fixture);await productAction(fixture,"أرشفة المنتج");await confirm();await waitProduct(fixture,0,true);const docs=await clearances(fixture);assert.equal(docs.filter(row=>row.status==="posted").reduce((sum,row)=>sum-Number(row.lines[0].quantity),0),remaining);return docs};
  const clearances=async fixture=>(await database.collection("documents").find({kind:"adjustment",productArchiveStockClearance:true}).toArray()).filter(document=>document.lines.some(line=>line.productId===fixture.id));
  const voidSale=async(fixture,document,restoredQuantity)=>{
    await view("sale",".pos-workspace");const number=String(document.sequence??document.number);
    await until(()=>evaluate(`[...document.querySelectorAll(".pos-workspace .quick-invoice-list tbody tr")].some(row=>row.children[0]?.textContent.trim()===${JSON.stringify(number)})`),"sale source history");
    await evaluate(`(()=>{const row=[...document.querySelectorAll(".pos-workspace .quick-invoice-list tbody tr")].find(row=>row.children[0]?.textContent.trim()===${JSON.stringify(number)});row.click()})()`);
    await until(()=>evaluate('Boolean(document.querySelector(".pos-workspace .invoice-line-total-input"))'),"sale editor loaded");await click(".pos-workspace .invoice-void");await confirm();await waitProduct(fixture,restoredQuantity,true);
    const saved=await database.collection("documents").findOne({id:document.id});assert.equal(saved.status,"voided");assert.deepEqual(saved.lines,document.lines,"Void preserves historical price/COGS snapshots");assert.deepEqual(await balances(),beforeBalances);
  };
  const cancelOpening=async fixture=>{
    await view("adjustments",".opening-stock-history");await click(`[id="opening-stock-source-${fixture.opening.id}"] .compact-delete`);await confirm();
    await until(async()=>(await database.collection("documents").findOne({id:fixture.opening.id}))?.status==="voided"&&await evaluate("!window.__payrollBusy"),"initial opening canceled from its own history");
    await waitProduct(fixture,0,false);assert.equal((await product(fixture)).openingStock,0);
  };
  await evaluate('window.__smokeSetLocale("ar")');
  const first=await createOpened("رصيد افتتاحي فحص الاستعادة",10,100,150),firstSale=await sale(first,4);
  await archive(first,6);await voidSale(first,firstSale,4);await showProduct(first,true);await productAction(first,"استعادة");await confirm();await waitProduct(first,10,false);
  assert((await clearances(first)).every(document=>document.status==="voided"));
  await showProduct(first);await screenshot("opening-restored-product10-1280",1280);
  await cancelOpening(first);
  await screenshot("opening-original-canceled-history-1280",1280);
  await showProduct(first);await productAction(first,"أرشفة المنتج");await confirm();await waitProduct(first,0,true);
  assert.equal((await clearances(first)).length,1,"Archiving an empty product adds no clearance");
  await showProduct(first,true);await productAction(first,"استعادة");await confirm();await waitProduct(first,0,false);
  checkpoints.push("Native Products creates opening10, POS sells4, archive zeroes6, POS void restores4, Products restore adds only pending6, and native OpeningHistory cancels10; historical sale/COGS and cash stay intact, and empty archive/restore adds no stock");

  const second=await createOpened("رصيد افتتاحي فحص سجل التصفير",8,50,100),secondSale=await sale(second,3);
  const oldClearance=(await archive(second,5))[0];await voidSale(second,secondSale,3);await showProduct(second,true);await productAction(second,"تصفير المخزون");await confirm();await waitProduct(second,0,true);
  const groups=await clearances(second),newClearance=groups.find(document=>document.id!==oldClearance.id);assert.equal(groups.length,2);assert(newClearance);
  for(const[document,stock,archived]of [[oldClearance,5,true],[newClearance,8,false]]){
    await view("adjustments",".adjustment-workspace");
    const selector=`.adjustment-workspace > .records:not(.opening-stock-history)`;
    await until(()=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector+" tbody tr")})].some(row=>row.children[2]?.textContent.trim()===${JSON.stringify(document.number)})`),"native archive-clearance row");
    await evaluate(`(()=>{const row=[...document.querySelectorAll(${JSON.stringify(selector+" tbody tr")})].find(row=>row.children[2]?.textContent.trim()===${JSON.stringify(document.number)});if(row.querySelector(".lifecycle-row-actions button.soft"))throw Error("Archive clearance incorrectly editable");const button=row.querySelector(".compact-delete");if(!button)throw Error("Clearance void unavailable");button.click()})()`);
    await confirm();await waitProduct(second,stock,archived);assert.equal((await database.collection("documents").findOne({id:document.id})).status,"voided");
  }
  await showProduct(second);await screenshot("opening-two-clearances-restored8-1280",1280);
  await cancelOpening(second);assert.deepEqual(await balances(),beforeBalances);
  await screenshot("opening-two-clearances-canceled-history-1280",1280);
  checkpoints.push("Native archived-product zero runs after a sale return; both clearance groups remain separately visible and non-editable in Adjustment history, each native void reverses only its own amount, then OpeningHistory cancels the restored8 without changing cash");

  const third=await createOpened("رصيد افتتاحي فحص مصدر التصحيح",5,20,50);await showProduct(third);await productAction(third,"تعديل");
  await until(()=>evaluate('Boolean(document.querySelector(".product-form"))&&!document.querySelector(".product-form-actions button.primary")?.disabled'),"opening state loaded in product editor");
  await fillLabel("رصيد البداية",7);await click(".product-form-actions button.primary");await confirm();
  await until(async()=>Number((await product(third)).openingStock)===7&&await evaluate('!window.__payrollBusy&&!document.querySelector(".product-form")'),"opening correction committed");
  const correction=(await database.collection("documents").find({kind:"adjustment",status:"posted"}).toArray()).find(document=>document.openingCorrection===true&&document.lines.some(line=>line.productId===third.id));assert(correction);
  await view("adjustments",".opening-stock-history");await click(`[id="opening-stock-source-${third.opening.id}"] .compact-delete`);await confirm();
  await until(()=>evaluate('Boolean(document.querySelector(".opening-correction-blockers"))'),"linked latest correction blocker");
  assert.equal(await evaluate('window.__smokeLastError.code'),"OPENING_INITIAL_HAS_CORRECTION");assert.equal(await evaluate('window.__smokeLastError.correctionDocumentId'),correction.id);
  assert((await evaluate('document.querySelector(".opening-correction-blocker-table").textContent')).includes(correction.number));await waitProduct(third,7,false);
  layouts.push(...await captureControlLayouts({cdp,screenshot,scope:".opening-correction-blockers",name:"opening-latest-blocker-ar",widths:[1280,760]}));
  await evaluate('window.__smokeSetLocale("fr")');layouts.push(...await captureControlLayouts({cdp,screenshot,scope:".opening-correction-blockers",name:"opening-latest-blocker-fr",widths:[760]}));await evaluate('window.__smokeSetLocale("ar")');
  await click(".opening-correction-blocker-table button");
  await until(()=>evaluate(`!document.querySelector(".opening-correction-blockers")&&document.activeElement?.closest("tr")?.id===${JSON.stringify("opening-stock-source-"+correction.id)}`),"exact correction source selected in native history");
  await screenshot("opening-correction-native-source-760",760);
  await click(`[id="opening-stock-source-${correction.id}"] .compact-delete`);await confirm();await waitProduct(third,5,false);await cancelOpening(third);
  assert.deepEqual(await balances(),beforeBalances);
  for(const fixture of [first,second,third]){
    const response=await fetch(origin+"/api/reports?"+new URLSearchParams({type:"sales",productId:fixture.id,allTime:"true",unpaged:"true"})),report=await response.json();assert.equal(response.status,200);assert.deepEqual([report.summary.netSales,report.summary.cost,report.summary.profit],[0,0,0]);
  }
  checkpoints.push("A native opening correction blocks original deletion with the exact source number/ID in Arabic/French; its source link focuses the correct native history void action, then correction and initial opening cancel separately, leaving all sales reports and cash reconciled");
  return {checkpoints,layouts,productIds:[first.id,second.id,third.id],cashUnchanged:true};
}
