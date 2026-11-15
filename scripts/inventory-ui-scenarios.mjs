import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { captureControlLayouts } from "./ui-control-bounds.mjs";

function workbookRows(data) {
  const bytes = Buffer.from(data), files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    assert.equal(method, 0, "The application's XLSX exporter emits stored ZIP entries");
    const start = offset + 30 + nameLength + extraLength;
    files.set(bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"), bytes.subarray(start, start + size).toString("utf8"));
    offset = start + size;
  }
  const decode = text => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const rows = name => [...(files.get(name) ?? "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(match => [...match[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => {
    const numeric = /<v>([^<]+)<\/v>/.exec(cell[1]);
    return numeric ? Number(numeric[1]) : decode(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell[1])?.[1] ?? "");
  }));
  assert(files.has("xl/worksheets/sheet1.xml") && files.has("xl/worksheets/sheet2.xml"));
  return { grid: rows("xl/worksheets/sheet1.xml"), summary: rows("xl/worksheets/sheet2.xml") };
}

/** New ordinary fixtures have known counts/costs; filtering/export must never post stock. */
export async function runInventoryScenarios({ cdp, origin, command, database, screenshot, output }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  const evaluate = expression => cdp.evaluate(expression), checkpoints = [], layouts = [];
  const until = async (check, name) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error("Timed out waiting for " + name);
  };
  const click = selector => evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});if(!button||button.disabled)throw Error("Missing inventory action "+${JSON.stringify(selector)});button.click()})()`);
  const fill = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error("Missing inventory field");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  const response = await fetch(origin + "/api/bootstrap"), bootstrap = await response.json();
  assert.equal(response.status, 200);
  const first = bootstrap.warehouses.find(row => !row.isArchived && row.isSalesDefault);
  assert(first);
  const secondId = await command({ type: "warehouse.create", name: "مخزن فحص الجرد الثاني" });
  const categoryA = await command({ type: "product-category.create", name: "فئة الجرد ألف" });
  const categoryB = await command({ type: "product-category.create", name: "فئة الجرد باء" });
  const prefix = "جرد فحص الواجهة";
  const definitions = [
    { name: prefix + " ألف1", categoryId: categoryA, pieceCost: 10, openingStock: 5 },
    { name: prefix + " ألف2", categoryId: categoryA, pieceCost: 20, openingStock: 4 },
    { name: prefix + " باء1", categoryId: categoryB, pieceCost: 30, openingStock: 3 },
  ];
  for (const definition of definitions) definition.id = await command({ type: "product.create", ...definition, piecePrice: 100, openingWarehouseId: first.id });
  await command({ type: "transfer.post", fromWarehouseId: first.id, toWarehouseId: secondId, lines: [{ productId: definitions[0].id, quantity: 2 }] });
  const unchanged = async () => Promise.all(["products", "documents", "stockMovements", "financialMovements", "paymentAccounts"].map(name => database.collection(name).find().toArray()));
  let beforeBrowsing = await unchanged();
  await evaluate('window.__smokeSetLocale("ar")');
  await evaluate('window.__smokeSetView("warehouses")');
  await until(() => evaluate('Boolean(document.querySelector(".inventory-panel"))'), "real inventory component");
  const choose = async (index, label) => {
    await evaluate(`document.querySelectorAll(".inventory-filter-controls > .combobox > .combobox-trigger")[${index}].click()`);
    await until(() => evaluate(`[...document.querySelectorAll(".combobox-popover [role=option]")].some(option=>option.title===${JSON.stringify(label)})`), "inventory option " + label);
    await evaluate(`(()=>{const option=[...document.querySelectorAll(".combobox-popover [role=option]")].find(option=>option.title===${JSON.stringify(label)});option.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true}))})()`);
    await until(() => evaluate(`document.querySelectorAll(".inventory-filter-controls > .combobox > .combobox-trigger")[${index}]?.textContent.trim()===${JSON.stringify(label)}`), "inventory selection " + label);
  };
  const showAll = async () => {
    await evaluate('(()=>{const button=[...document.querySelectorAll(".inventory-filter-controls button")].find(button=>button.textContent.trim()==="عرض الكل");if(!button)throw Error("Missing all-period inventory");button.click()})()');
    await until(() => evaluate('Boolean(document.querySelector(".inventory-grid"))'), "inventory table");
    await fill(".inventory-list-panel input", prefix);
  };
  const numeric = text => Number(String(text).replace(/[^0-9.+-]/g, ""));
  const expectScope = async (names, quantity, value) => {
    let snapshot;
    await until(async () => {
      snapshot = await evaluate('(()=>({cards:[...document.querySelectorAll(".inventory-overview-metrics > span b")].map(node=>node.textContent),rows:[...document.querySelectorAll(".inventory-grid tbody tr")].filter(row=>row.children.length===9).map(row=>[...row.children].map(cell=>cell.textContent.trim()))}))()');
      return JSON.stringify(snapshot.rows.map(row => row[1]).sort()) === JSON.stringify([...names].sort());
    }, "matching inventory rows " + names.join(","));
    assert.equal(numeric(snapshot.cards[0]), value, "Inventory value card shares the grid scope");
    assert.equal(numeric(snapshot.cards[1]), names.length, "Product count shares the grid scope");
    assert.equal(numeric(snapshot.cards[2]), quantity, "Piece quantity shares the grid scope");
    assert.equal(snapshot.rows.reduce((sum, row) => sum + numeric(row[4]), 0), quantity);
    assert.equal(snapshot.rows.reduce((sum, row) => sum + numeric(row[8]), 0), value);
    return snapshot;
  };
  await choose(0, first.name);
  await showAll();
  await expectScope(definitions.map(row => row.name), 10, 200);
  await choose(1, "فئة الجرد ألف");
  await expectScope(definitions.slice(0, 2).map(row => row.name), 7, 110);
  await fill(".inventory-list-panel input", definitions[0].name);
  await expectScope([definitions[0].name], 3, 30);
  await fill(".inventory-list-panel input", prefix);
  await expectScope(definitions.slice(0, 2).map(row => row.name), 7, 110);
  assert.deepEqual(await unchanged(), beforeBrowsing, "Warehouse/category/search filters are read-only");
  await command({ type: "product-category.update", id: categoryA, name: "فئة الجرد المصححة" });
  beforeBrowsing = await unchanged();
  await evaluate('window.__smokeSetView("warehouses")');
  await until(() => evaluate('document.querySelectorAll(".inventory-filter-controls > .combobox > .combobox-trigger")[1]?.textContent.trim()==="فئة الجرد المصححة"'), "selected category keeps its ID after rename");
  await expectScope(definitions.slice(0, 2).map(row => row.name), 7, 110);

  await evaluate('(()=>{window.__smokeOldPrinting=window.alkarnaPrinting;window.alkarnaPrinting={...window.alkarnaPrinting,saveExport:async request=>{window.__smokeInventoryExport={format:request.format,name:request.suggestedName,bytes:Array.from(request.data)};return{ok:true}}}})()');
  try {
    await click(".inventory-print");
    await until(() => evaluate('Boolean(document.querySelector(".output-choice-dialog"))'), "inventory export choices");
    await evaluate('(()=>{const button=[...document.querySelectorAll(".output-choice-card")].find(button=>button.textContent.includes("XLSX"));button.click()})()');
    await until(() => evaluate('Boolean(window.__smokeInventoryExport)&&!document.querySelector(".output-choice-dialog")'), "actual inventory XLSX created");
    const exported = await evaluate("window.__smokeInventoryExport"), workbook = workbookRows(exported.bytes);
    assert.equal(exported.format, "xlsx");
    assert.deepEqual(workbook.grid.slice(1).map(row => row[1]).sort(), definitions.slice(0, 2).map(row => row.name).sort());
    assert.equal(workbook.grid.slice(1).reduce((sum, row) => sum + row[4], 0), 7);
    assert.equal(workbook.grid.slice(1).reduce((sum, row) => sum + row[8], 0), 110);
    const summary = new Map(workbook.summary.slice(1));
    assert.equal(summary.get("المخزن"), first.name);
    assert.equal(summary.get("الفئة"), "فئة الجرد المصححة");
    assert.equal(summary.get("عدد المنتجات"), 2);
    assert.equal(summary.get("قيمة المخزون"), 110);
    assert.equal(summary.get("إجمالي الكمية"), 7);
    fs.writeFileSync(path.join(output, "inventory-filtered.xlsx"), Buffer.from(exported.bytes));
  } finally {
    await evaluate('(()=>{if(window.__smokeOldPrinting===undefined)delete window.alkarnaPrinting;else window.alkarnaPrinting=window.__smokeOldPrinting;delete window.__smokeOldPrinting;delete window.__smokeInventoryExport})()');
  }
  const dates = await evaluate('document.querySelectorAll(".inventory-filter-controls input[type=date]").length');
  assert.equal(dates, 2);
  await evaluate('(()=>{for(const input of document.querySelectorAll(".inventory-filter-controls input[type=date]")){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"2000-01-01");input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}))}})()');
  await click(".inventory-filter-controls .date-apply");
  await until(()=>evaluate('document.querySelector(".inventory-filter-controls button[aria-pressed]")?.getAttribute("aria-pressed")==="false"&&!document.querySelector(".period-error")'),"historic inventory period committed");
  await expectScope(definitions.slice(0, 2).map(row => row.name), 7, 110);
  await choose(0, "مخزن فحص الجرد الثاني");
  await showAll();
  await expectScope([definitions[0].name], 2, 20);
  await choose(0, "كل المخازن");
  await showAll();
  await expectScope(definitions.slice(0, 2).map(row => row.name), 9, 130);
  await choose(1, "كل الفئات");
  await expectScope(definitions.map(row => row.name), 12, 220);
  for (const locale of ["ar", "fr"]) {
    await evaluate(`window.__smokeSetLocale(${JSON.stringify(locale)})`);
    layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: ".inventory-filter-controls", name: "inventory-filters-" + locale }));
    const cards = await evaluate('(()=>{const cards=[...document.querySelectorAll(".inventory-overview-metrics > span")].map(node=>{const box=node.getBoundingClientRect();return{top:box.top,bottom:box.bottom,left:box.left,right:box.right}});return{cards,width:innerWidth}})()');
    assert(cards.cards[1].top >= cards.cards[0].bottom - 2 && Math.abs(cards.cards[1].top - cards.cards[2].top) < 2, "Value stays above the two side-by-side count/quantity cards");
  }
  assert.deepEqual(await unchanged(), beforeBrowsing, "Inventory browsing, period/locale changes and export leave every stock/financial/document snapshot unchanged");
  await evaluate('window.__smokeSetLocale("ar")');
  checkpoints.push("Actual inventory category/search/warehouse scopes agree across cards/grid: W1all10units/value200, categoryA7/110, search3/30, W2two/20, allwarehouses12/220; category rename retains ID, historical period preserves current stock, and filtered real XLSX matches2products/7units/value110");
  return { checkpoints, layouts, filteredExcel: "inventory-filtered.xlsx", productIds: definitions.map(row => row.id), secondWarehouseId: secondId, categoryIds: [categoryA, categoryB] };
}
