import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { captureControlLayouts } from "./ui-control-bounds.mjs";

function workbook(bytes) {
  const data = Buffer.from(bytes), sheets = []; let offset = 0;
  const decode = value => value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const flags = data.readUInt16LE(offset + 6), method = data.readUInt16LE(offset + 8), size = data.readUInt32LE(offset + 18), nameSize = data.readUInt16LE(offset + 26), extraSize = data.readUInt16LE(offset + 28);
    assert.equal(flags & 8, 0); assert([0, 8].includes(method));
    const name = data.subarray(offset + 30, offset + 30 + nameSize).toString("utf8"), start = offset + 30 + nameSize + extraSize;
    assert(start + size <= data.length);
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const packed = data.subarray(start, start + size), xml = (method === 8 ? inflateRawSync(packed) : packed).toString("utf8");
      sheets.push([...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => {
        const number = /<v>([^<]+)<\/v>/.exec(cell[1]);
        return number ? Number(number[1]) : decode(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell[1])?.[1] ?? "");
      })));
    }
    offset = start + size;
  }
  assert.equal(sheets.length, 2, "The actual report XLSX has data and full-scope summary sheets");
  return sheets;
}

/** Real commands/components; only external printing/file dialogs are captured in CI. */
export async function runSalesByProductScenarios({ cdp, origin, command, database, screenshot, output }) {
  assert.equal(process.env.CI, "true"); assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.platform, "win32");
  const evaluate = code => cdp.evaluate(code), checkpoints = [], layouts = [], exports = [];
  const until = async (check, label) => { const end = Date.now() + 25000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error("Timed out waiting for " + label); };
  const click = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable sales action '+${JSON.stringify(selector)});e.click()})()`);
  const fill = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing sales filter');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const choose = async (selector, label) => {
    await click(selector);
    await until(() => evaluate('Boolean(document.querySelector(".combobox-popover"))'), "sales selector");
    await evaluate(`(()=>{const e=${label === null ? "document.querySelector('.combobox-popover .combobox-results>button:not([role])')" : "[...document.querySelectorAll('.combobox-popover [role=option]')].find(e=>e.title===" + JSON.stringify(label) + ")"};if(!e)throw Error('Missing sales option');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))})()`);
    await until(() => evaluate('!document.querySelector(".combobox-popover")'), "sales option committed");
  };
  const bootstrapResponse = await fetch(origin + "/api/bootstrap"), bootstrap = await bootstrapResponse.json(); assert.equal(bootstrapResponse.status, 200);
  const warehouse = bootstrap.warehouses.find(row => row.isSalesDefault && !row.isArchived); assert(warehouse);
  const account = await command({ type: "payment-account.create", name: "حساب فحص مبيعات المنتجات", openingBalance: 0 });
  const otherAccount = await command({ type: "payment-account.create", name: "حساب مستبعد من فحص المنتجات", openingBalance: 0 });
  const category = await command({ type: "product-category.create", name: "فئة فحص المبيعات ألف" });
  const otherCategory = await command({ type: "product-category.create", name: "فئة فحص المبيعات باء" });
  const definitions = [
    { name: "سلعة مبيعات تجريبية ألف", categoryId: category, piecePrice: 20, pieceCost: 5 },
    { name: "سلعة مبيعات تجريبية باء", categoryId: category, piecePrice: 30, pieceCost: 10 },
    { name: "سلعة مبيعات خارج الفئة", categoryId: otherCategory, piecePrice: 70, pieceCost: 15 },
  ];
  for (const product of definitions) product.id = await command({ type: "product.create", ...product, openingStock: 50, openingWarehouseId: warehouse.id });
  const line = (index, quantity, piecePrice) => ({ productId: definitions[index].id, quantity, piecePrice });
  const sale = (paymentMethod, lines) => command({ type: "sale.post", warehouseId: warehouse.id, paymentMethod, lines });
  await sale(account, [line(0, 3, 20), line(1, 2, 30)]);
  await sale(account, [line(0, 1, 25)]);
  await sale(account, [line(2, 1, 70)]);
  await sale(otherAccount, [line(0, 1, 40), line(2, 1, 50)]);
  const voidId = await sale(account, [line(0, 2, 100)]), voidDocument = await database.collection("documents").findOne({ id: voidId });
  await command({ type: "sale.void", documentId: voidId, expectedRevision: voidDocument.revision ?? 0, reason: "سند ملغى لا يدخل تقرير المنتجات" });
  const snapshot = async () => Promise.all(["products", "documents", "stockMovements", "financialMovements", "paymentAccounts", "parties", "auditEvents", "commandReceipts"].map(name => database.collection(name).find().sort({ id: 1 }).toArray()));
  const beforeReads = await snapshot();
  await evaluate('window.__smokeSetLocale("ar")');
  await evaluate('window.__smokeSetView("sales-report")');
  await until(() => evaluate('Boolean(document.querySelector(".sales-view-toggle"))&&!document.querySelector(".report-loading")'), "actual sales report");
  assert.equal(await evaluate('document.querySelector("[data-sales-view=invoices]").getAttribute("aria-pressed")'), "true", "Sales still defaults to invoice view");
  assert.equal(await evaluate('Boolean(document.querySelector(".reports-workspace .report-table-sales-products"))'), false);
  await click(".reports-workspace .compact-date-range button[aria-pressed]");
  await fill(".reports-workspace .payment-account-select", account);
  const rows = () => evaluate("[...document.querySelectorAll('.reports-workspace .report-table-sales-products tbody tr')].map(row=>({product:row.querySelector('[data-column=product]')?.textContent.trim(),quantity:Number(row.querySelector('[data-column=quantity]')?.textContent.replace(/[^0-9.+-]/g,'')),revenue:Number(row.querySelector('[data-column=revenue]')?.textContent.replace(/[^0-9.+-]/g,'')),cells:row.children.length}))");
  const expect = async expected => {
    let actual;
    await until(async () => { actual = await rows(); return !await evaluate('Boolean(document.querySelector(".report-loading"))') && JSON.stringify(actual.map(row => [row.product, row.quantity, row.revenue]).sort()) === JSON.stringify(expected.map(row => [...row]).sort()); }, "matching product quantities and sales");
    assert(actual.every(row => row.cells === 3), "Exactly three business cells, without a redundant serial column");
    assert.equal(await evaluate('document.querySelectorAll(".reports-workspace .report-table-sales-products thead th").length'), 3);
    const footer = await evaluate("[...document.querySelectorAll('.reports-workspace .report-kpis .report-kpi-value b')].map(e=>Number(e.textContent.replace(/[^0-9.+-]/g,'')))");
    assert.deepEqual(footer, [expected.length, expected.reduce((sum, row) => sum + row[1], 0), expected.reduce((sum, row) => sum + row[2], 0)], "Footer aggregates the same complete filtered scope");
    return actual;
  };
  const all = [[definitions[0].name, 4, 85], [definitions[1].name, 2, 60], [definitions[2].name, 1, 70]], filtered = all.slice(0, 2);
  await click("[data-sales-view=products]"); await expect(all);
  await choose(".report-category-filter .combobox-trigger", "فئة فحص المبيعات ألف"); await expect(filtered);
  const selectedFilters = () => evaluate("({category:document.querySelector('.report-category-filter .combobox-trigger').textContent,account:document.querySelector('.payment-account-select').value,dates:[...document.querySelectorAll('.compact-date-range input')].map(e=>e.value),allTime:document.querySelector('.compact-date-range button[aria-pressed]').getAttribute('aria-pressed')})");
  const retained = await selectedFilters();
  await click("[data-sales-view=invoices]");
  await until(() => evaluate('!document.querySelector(".reports-workspace .report-table-sales-products")&&!document.querySelector(".report-loading")'), "invoice mode restored");
  assert.deepEqual(await selectedFilters(), retained, "Changing view preserves every active filter");
  await click("[data-sales-view=products]"); await expect(filtered);
  await choose(".report-filters>.combobox .combobox-trigger", definitions[0].name); await expect([filtered[0]]);
  await choose(".report-filters>.combobox .combobox-trigger", definitions[1].name); await expect([filtered[1]]);
  await choose(".report-filters>.combobox .combobox-trigger", null); await expect(filtered);
  await evaluate(`(()=>{window.__salesOriginalFetch=window.fetch;window.__salesRequests=[];window.fetch=async function(input,init){const r=await window.__salesOriginalFetch.call(this,input,init),url=String(input?.url??input);if(url.includes('/api/reports?'))window.__salesRequests.push({url,status:r.status});return r};window.__salesPreviousPrinting=window.alkarnaPrinting;window.__salesOutput=null;const capture=async(kind,settings)=>{const p=document.querySelector('.report-print-portal');if(!p)throw Error('Missing real printable sales report');window.__salesOutput={kind,settings,title:p.querySelector('h2')?.textContent,headers:[...p.querySelectorAll('thead th')].map(e=>e.textContent.trim()),rows:[...p.querySelectorAll('tbody tr')].map(row=>[...row.children].map(e=>e.textContent.trim())),footer:[...p.querySelectorAll('.report-kpi-value b')].map(e=>e.textContent.trim())};await new Promise(resolve=>window.__salesFinishOutput=resolve);return{ok:true}};window.alkarnaPrinting={getSettings:async()=>({deviceName:null,profile:'a4'}),print:settings=>capture('printer',settings),pdf:settings=>capture('pdf',settings),saveExport:async request=>{window.__salesOutput={kind:'excel',format:request.format,name:request.suggestedName,bytes:Array.from(request.data)};return{ok:true}}}})()`);
  try {
    for (const locale of ["ar", "fr"]) {
      await evaluate(`window.__smokeSetLocale(${JSON.stringify(locale)})`);
      await until(() => evaluate(`document.documentElement.lang===${JSON.stringify(locale)}`), "sales locale " + locale);
      await expect(filtered);
      layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: ".report-toolbar", name: "sales-products-filters-" + locale, widths: locale === "ar" ? [1280, 760] : [480] }));
      for (const kind of locale === "ar" ? ["printer", "pdf", "excel"] : ["excel"]) {
        await evaluate('window.__salesOutput=null;window.__salesRequests=[]');
        await click(".report-print-button"); await until(() => evaluate('Boolean(document.querySelector(".output-choice-dialog"))'), "sales output choice");
        await click(".output-choice-card:nth-child(" + ({ printer: 1, pdf: 2, excel: 3 })[kind] + ")");
        await until(() => evaluate('Boolean(window.__salesOutput)'), "actual sales " + kind + " output");
        const captured = await evaluate("window.__salesOutput"), requests = await evaluate("window.__salesRequests");
        assert.equal(captured.kind, kind);
        assert(requests.some(request => { const q = new URL(request.url, origin).searchParams; return request.status === 200 && q.get("unpaged") === "true" && q.get("groupBy") === "product" && q.get("categoryId") === category && q.get("paymentAccountId") === account; }), "Every output obtains the unpaged committed product view with the same filters");
        const file = "sales-products-" + locale + "-" + kind + (kind === "excel" ? ".xlsx" : ".pdf");
        if (kind === "excel") {
          assert.equal(captured.format, "xlsx"); const sheets = workbook(captured.bytes);
          assert.equal(sheets[0][0].length, 3, "Actual XLSX has the product/quantity/sales columns only");
          assert.deepEqual(sheets[0].slice(1).map(row => [row[0], row[1], row[2]]).sort(), [...filtered].sort());
          assert.deepEqual(sheets[1].slice(1).map(row => row[1]), [2, 6, 145], "Actual Excel summary covers the same complete scope");
          fs.writeFileSync(path.join(output, file), Buffer.from(captured.bytes));
        } else {
          assert.equal(captured.headers.length, 3);
          assert.equal(captured.title, await evaluate('document.querySelector(".reports-workspace .print-report-title h2").textContent'), "Native print title belongs to the selected product view");
          assert.deepEqual(captured.rows.map(row => [row[0], Number(row[1]), Number(row[2].replace(/[^0-9.+-]/g, ""))]).sort(), [...filtered].sort());
          assert.deepEqual(captured.footer.map(value => Number(value.replace(/[^0-9.+-]/g, ""))), [2, 6, 145]);
          assert.equal(captured.settings.profile, "a4");
          const pdf = await cdp.call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
          const bytes = Buffer.from(pdf.data, "base64"); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert(bytes.length > 1000);
          fs.writeFileSync(path.join(output, file), bytes);
          await evaluate('window.__salesFinishOutput();delete window.__salesFinishOutput');
        }
        await until(() => evaluate('!document.querySelector(".report-print-portal")&&!document.querySelector(".output-choice-dialog")&&!document.querySelector(".report-error")'), "sales output cleanup");
        await expect(filtered); exports.push({ locale, kind, file, rows: 2, quantity: 6, revenue: 145, unpaged: true });
      }
    }
    await evaluate('window.__smokeSetLocale("ar")');
    await until(() => evaluate('document.documentElement.lang==="ar"'), "Arabic invoice export locale");
    await click("[data-sales-view=invoices]");
    await until(() => evaluate('!document.querySelector(".reports-workspace .report-table-sales-products")&&!document.querySelector(".report-loading")'), "return to invoice export view");
    assert.deepEqual(await selectedFilters(), retained);
    await evaluate('window.__salesOutput=null;window.__salesRequests=[]');
    await click(".report-print-button"); await until(() => evaluate('Boolean(document.querySelector(".output-choice-dialog"))'), "invoice output choices");
    await click(".output-choice-card:nth-child(3)"); await until(() => evaluate('window.__salesOutput?.kind==="excel"'), "actual invoice-view XLSX");
    const invoiceOutput = await evaluate("window.__salesOutput"), invoiceWorkbook = workbook(invoiceOutput.bytes), invoiceRequests = await evaluate("window.__salesRequests");
    assert(invoiceWorkbook[0][0].includes("رقم الفاتورة"), "Switching back restores the actual invoice-number column");
    assert(invoiceWorkbook[0][0].length > 3);
    const invoiceColumns = invoiceWorkbook[0][0], invoiceRows = invoiceWorkbook[0].slice(1), numberIndex = invoiceColumns.indexOf("رقم الفاتورة"), quantityIndex = invoiceColumns.indexOf("الكمية"), revenueIndex = invoiceColumns.indexOf("قيمة البيع");
    assert.equal(invoiceRows.length, 3, "The existing category-filtered invoice view retains three source line facts");
    assert.equal(new Set(invoiceRows.map(row => row[numberIndex])).size, 2, "Those line facts still belong to two original invoices");
    assert.equal(invoiceRows.reduce((sum, row) => sum + row[quantityIndex], 0), 6);
    assert.equal(invoiceRows.reduce((sum, row) => sum + row[revenueIndex], 0), 145);
    assert(invoiceRequests.some(request => { const q = new URL(request.url, origin).searchParams; return request.status === 200 && q.get("groupBy") === "invoice" && q.get("unpaged") === "true" && q.get("categoryId") === category && q.get("paymentAccountId") === account; }), "Returning to invoices exports the unpaged invoice view, never a stale product response");
    fs.writeFileSync(path.join(output, "sales-invoices-return-ar.xlsx"), Buffer.from(invoiceOutput.bytes));
    exports.push({ locale: "ar", kind: "invoice-excel", file: "sales-invoices-return-ar.xlsx", rows: 3, invoices: 2, unpaged: true });
    assert.deepEqual(await snapshot(), beforeReads, "Views, filters, layouts, print/PDF/Excel do not mutate financial/stock/document/audit data");
    checkpoints.push("Sales defaults to invoices; switching to products keeps category, account and period filters, aggregates the same product across different invoices/prices, excludes other accounts/categories and voided invoices, and keeps the three-column grid and full-scope footer consistent");
    checkpoints.push("Actual product-view print and PDF paths render the real unpaged report and produce Chrome PDF bytes, Arabic/French actual XLSX contains product/quantity/sales and full-scope totals, and switching back exports invoice-number columns with groupBy=invoice; all browsing/export snapshots remain unchanged");
    return { checkpoints, layouts, exports, productIds: definitions.map(row => row.id), accountId: account, sourceSnapshotsUnchanged: true, defaultInvoices: true };
  } finally {
    await evaluate('(()=>{window.__salesFinishOutput?.();window.fetch=window.__salesOriginalFetch;window.alkarnaPrinting=window.__salesPreviousPrinting;delete window.__salesOriginalFetch;delete window.__salesPreviousPrinting;delete window.__salesOutput;delete window.__salesRequests;delete window.__salesFinishOutput})()');
  }
}
