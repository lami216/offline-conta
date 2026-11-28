import assert from "node:assert/strict";
import { captureControlLayouts } from "./ui-control-bounds.mjs";

/** CI only: one account selected through the actual trader, purchase and sale components. */
export async function runTraderScenarios({ cdp, origin, command, database, screenshot }) {
  assert.equal(process.env.CI, "true"); assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.platform, "win32");
  const evaluate = code => cdp.evaluate(code), checkpoints = [], layouts = [], invoices = [];
  const until = async (check, label) => { const end = Date.now() + 25000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error("Timed out waiting for trader " + label); };
  const click = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable trader control '+${JSON.stringify(selector)});e.click()})()`);
  const fill = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing trader field '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const choose = async (selector, label) => {
    await click(selector);
    await until(() => evaluate(`[...document.querySelectorAll('.combobox-popover [role=option]')].some(e=>e.title===${JSON.stringify(label)})`), "option " + label);
    await evaluate(`(()=>{const e=[...document.querySelectorAll('.combobox-popover [role=option]')].find(e=>e.title===${JSON.stringify(label)});e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))})()`);
    await until(() => evaluate('!document.querySelector(".combobox-popover")'), "closed selector");
  };
  const bootstrap = async () => { const response = await fetch(origin + "/api/bootstrap"), data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data; };
  const cash = async () => (await database.collection("paymentAccounts").find().toArray()).map(row => [row.id, row.balance]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const close = (actual, wanted, label) => assert(Math.abs(Number(actual) - wanted) < 1e-8, label + ": " + actual + " versus " + wanted);
  const numeral = text => Number(String(text).replace(/\u2212/g, "-").replace(/,/g, ".").replace(/[^0-9.+-]/g, ""));
  const name = "تاجر فحص الحساب الموحد", productName = "منتج فحص بيع وشراء التاجر";
  await evaluate('window.__smokeNotesReadMode=false;window.__smokeSetLocale("ar")');
  await evaluate('window.__smokeSetView("traders")');
  await until(() => evaluate('Boolean(document.querySelector(".trader-workspace .party-create-toggle"))'), "native management view");
  await click(".trader-workspace .party-create-toggle");
  await until(() => evaluate('Boolean(document.querySelector(".trader-workspace .parties-create"))'), "native create form");
  await fill('.trader-workspace .parties-create input[aria-label="اسم التاجر"]', name);
  await fill('.trader-workspace .parties-create input[aria-label="رقم الهاتف"]', "00009913");
  await evaluate('document.querySelector(".trader-workspace .parties-create").requestSubmit()');
  let trader;
  await until(async () => { trader = await database.collection("parties").findOne({ name }); return trader?.partyType === "trader" && await evaluate('!window.__payrollBusy&&!document.querySelector(".trader-workspace .parties-create")'); }, "canonical account created");
  assert.equal(await database.collection("parties").countDocuments({ name }), 1, "A trader is one canonical party, not a customer/supplier pair");
  const data = await bootstrap(), warehouse = data.warehouses.find(row => !row.isArchived && row.isSalesDefault);
  assert(warehouse, "Use the same sales-default warehouse as the real POS");
  const productId = await command({ type: "product.create", name: productName, pieceCost: 10, piecePrice: 30, openingStock: 10, openingWarehouseId: warehouse.id });
  const cashBefore = await cash();
  for (const kind of ["purchase", "sale"]) {
    const workspace = kind === "sale" ? ".pos-workspace" : ".purchase-workspace";
    await evaluate(`window.__smokeSetView(${JSON.stringify(kind)})`);
    await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(workspace)}))`), kind + " view");
    if (kind === "purchase") await choose(workspace + " .purchase-details > label .combobox-trigger", warehouse.name);
    await fill(workspace + ' .search-panel input[aria-label="بحث المنتج"]', productName);
    await until(() => evaluate(`Boolean(document.getElementById(${JSON.stringify("product-result-" + productId)}))`), kind + " product search");
    assert.equal(await evaluate(`document.getElementById(${JSON.stringify("product-result-" + productId)}).querySelector('button').disabled`), false);
    await evaluate(`document.getElementById(${JSON.stringify("product-result-" + productId)}).click()`);
    const row = workspace + " .invoice-table tbody tr:not(.invoice-empty-row)";
    await until(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(row + " .invoice-line-total-input")}))`), kind + " product added");
    await fill(row + " td:nth-child(2) input", kind === "purchase" ? 2 : 1);
    await fill(row + " td:nth-child(3) input", kind === "purchase" ? 10 : 30);
    await click(workspace + " .invoice-meta-row .secondary");
    await choose(workspace + (kind === "sale" ? " .pos-customer-compact" : " .purchase-supplier") + " .combobox-trigger", name + " (تاجر)");
    await click(workspace + " .checkout-footer button.primary.wide");
    let document;
    await until(async () => { document = (await database.collection("documents").find({ kind, status: "posted", partyId: trader.id }).toArray()).find(item => item.lines?.some(line => line.productId === productId)); return document && await evaluate(`!window.__payrollBusy&&!document.querySelector(${JSON.stringify(row + " .invoice-line-total-input")})`); }, kind + " committed through form");
    close(document.total, kind === "purchase" ? 20 : 30, "Saved native invoice total");
    close(document.partyBalanceDelta, kind === "purchase" ? -20 : 30, "Each invoice contributes exactly once to the shared signed account");
    assert.equal(document.paymentMethod, "note"); assert.equal(document.warehouseId, warehouse.id);
    invoices.push({ id: document.id, kind, total: document.total });
  }
  trader = await database.collection("parties").findOne({ id: trader.id });
  close(Number(trader.receivable ?? 0) - Number(trader.payable ?? 0), 10, "One trader owes the shop the net ten");
  close((await database.collection("products").findOne({ id: productId })).stocks[warehouse.id], 11, "Two purchased and one sold units share the same stock");
  assert.deepEqual(await cash(), cashBefore, "Credit purchase and sale do not invent cash movements");
  await evaluate('window.__smokeSetView("traders")');
  await until(() => evaluate(`[...document.querySelectorAll('.trader-workspace .party-grid tbody tr')].some(row=>row.querySelector('.name-cell')?.textContent===${JSON.stringify(name)})`), "trader account row");
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.trader-workspace .party-grid tbody tr')].find(row=>row.querySelector('.name-cell')?.textContent===${JSON.stringify(name)});row.click()})()`);
  await until(() => evaluate('Boolean(document.querySelector(".trader-detail"))'), "shared detail page");
  assert.equal(await evaluate("window.__openedParty"), trader.id);
  const metricValues = await evaluate("[...document.querySelectorAll('.trader-detail .party-trade-metrics>span')].map(e=>({label:e.querySelector('small')?.textContent,value:e.querySelector('.financial-amount')?.textContent}))");
  assert.equal(metricValues[0]?.label, "مبيعاتنا للتاجر"); assert.equal(metricValues[1]?.label, "مشترياتنا من التاجر");
  close(numeral(metricValues[0]?.value), 30, "Detail sales total"); close(numeral(metricValues[1]?.value), 20, "Detail purchase total");
  for (const invoice of invoices) { const document = await database.collection("documents").findOne({ id: invoice.id }); const { displayDocumentNumber } = await import("../lib/document-sequences.ts"); assert(await evaluate(`[...document.querySelectorAll('.trader-detail .party-history tbody tr')].some(row=>row.children[2]?.textContent.trim()===${JSON.stringify(String(displayDocumentNumber(document)))})`), "Both sides retain their native history sources"); }
  layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: ".trader-detail .party-payment-panel", name: "trader-shared-account-ar", widths: [1280, 760] }));
  const snapshot = async () => Object.fromEntries(await Promise.all(["parties", "products", "documents", "financialMovements", "stockMovements", "paymentAccounts"].map(async key => [key, await database.collection(key).find().toArray()])));
  const beforeRead = await snapshot();
  await evaluate('window.__smokeSetView("party-ledger")');
  await until(() => evaluate('Boolean(document.querySelector(".party-ledger-role-select"))'), "ledger role picker");
  await fill(".party-ledger-role-select", "trader");
  await choose(".party-ledger-filter .combobox-trigger", name);
  await click(".compact-date-range button[aria-pressed]");
  const footer = () => evaluate("[...document.querySelectorAll('.reports-workspace .report-kpi-value b')].map(e=>e.textContent.trim())");
  await until(async () => JSON.stringify((await footer()).map(numeral)) === JSON.stringify([30, 20, 0, 0, 10, 0]), "six trader totals");
  const response = await fetch(origin + "/api/reports?" + new URLSearchParams({ type: "party-ledger", partyType: "trader", partyId: trader.id, allTime: "true", unpaged: "true" })), report = await response.json();
  assert.equal(response.status, 200, JSON.stringify(report)); assert.equal(report.rows.length, 2); assert.equal(report.summary.partyCount, 1);
  for (const [key, value] of Object.entries({ salesTotal: 30, purchasesTotal: 20, receivedTotal: 0, paidTotal: 0, closingReceivable: 10, closingPayable: 0, tradeTotal: 0, reconciliationDifference: 0 })) close(report.summary[key], value, "Canonical trader report " + key);
  for (const invoice of invoices) assert(report.rows.some(row => row.documentId === invoice.id && row.partyId === trader.id));
  const ledgerGeometry = [], geometryFailures = [];
  const ledgerLabels = {
    ar: ["صافي المبيعات", "صافي المشتريات", "تحصيلات الحساب", "دفعات الحساب", "لنا بنهاية الفترة", "علينا بنهاية الفترة"],
    fr: ["Ventes nettes", "Achats nets", "Encaissements du compte", "Paiements du compte", "À recevoir en fin de période", "À payer en fin de période"],
  };
  try {
    for (const locale of ["ar", "fr"]) {
      await evaluate(`window.__smokeSetLocale(${JSON.stringify(locale)})`);
      await until(() => evaluate(`document.documentElement.lang===${JSON.stringify(locale)}`), "ledger locale " + locale);
      layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: ".party-ledger-toolbar", name: "trader-ledger-" + locale, widths: [1280, 760, 480] }));
      for (const width of [1280, 760, 480]) {
        await cdp.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const geometry = await evaluate(`(()=>{
          const box=e=>{if(!e)throw Error('Missing trader ledger layout element');const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,centerY:r.top+r.height/2}};
          const toolbar=document.querySelector('.party-ledger-toolbar'),scope=toolbar?.querySelector(':scope>.party-ledger-toolbar-scope'),actions=toolbar?.querySelector(':scope>.party-ledger-toolbar-actions');
          if(!scope||!actions||!scope.querySelector('.party-ledger-sign'))throw Error('Missing scoped trader toolbar sections');
          const footer=document.querySelector('.reports-workspace .party-ledger-kpis'),cards=[...footer.querySelectorAll(':scope>.report-kpi')];
          const contentFits=(element,card)=>{const range=document.createRange();range.selectNodeContents(element);const c=card.getBoundingClientRect();return element.scrollWidth<=element.clientWidth+1&&element.scrollHeight<=element.clientHeight+1&&[...range.getClientRects()].every(r=>r.left>=c.left-1&&r.right<=c.right+1&&r.top>=c.top-1&&r.bottom<=c.bottom+1)};
          const role=scope.querySelector('.party-ledger-role-select'),roleStyle=getComputedStyle(role),roleLabel=role.selectedOptions[0]?.textContent.trim()??'',context=document.createElement('canvas').getContext('2d');
          context.font=roleStyle.font||roleStyle.fontWeight+' '+roleStyle.fontSize+' '+roleStyle.fontFamily;
          const roleTextWidth=context.measureText(roleLabel).width+Math.max(0,roleLabel.length-1)*(parseFloat(roleStyle.letterSpacing)||0),roleArrowAllowance=20;
          const roleRequiredWidth=roleTextWidth+['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+(parseFloat(roleStyle[key])||0),0)+roleArrowAllowance;
          const dateLabels=[...actions.querySelectorAll('.compact-date-range label>span')].map(label=>{const range=document.createRange();range.selectNodeContents(label);return{text:label.textContent.trim(),...box(label),textWidth:range.getBoundingClientRect().width,fits:contentFits(label,label)&&contentFits(label,label.parentElement)}});
          return{width:innerWidth,viewportHeight:innerHeight,locale:document.documentElement.lang,toolbar:box(toolbar),role:box(role),roleText:{label:roleLabel,textWidth:roleTextWidth,arrowAllowance:roleArrowAllowance,requiredWidth:roleRequiredWidth},dateLabels,name:box(scope.querySelector('.combobox-trigger')),dates:box(actions.querySelector('.compact-date-range')),print:box(actions.querySelector('.report-print-button')),footer:box(footer),body:box(document.querySelector('.reports-workspace>.report-body')),cards:cards.map(card=>{const label=card.querySelector('small'),value=card.querySelector('.report-kpi-value');return{...box(card),label:label.textContent.trim(),value:value.textContent.trim(),labelFits:contentFits(label,card),valueFits:contentFits(value,card)}}),creditCells:[...document.querySelectorAll('.report-table-party-ledger tbody [data-column=paymentMethod]')].map(cell=>cell.textContent.trim()),pageOverflow:document.documentElement.scrollWidth>innerWidth+1};
        })()`);
        ledgerGeometry.push(geometry);
        const caseName = locale + "/" + width;
        try {
          assert.deepEqual(geometry.cards.map(card => card.label), ledgerLabels[locale], caseName + " exact compact footer labels");
          assert.deepEqual(geometry.cards.map(card => numeral(card.value)), [30, 20, 0, 0, 10, 0], caseName + " footer values never change with locale/layout");
          assert.deepEqual(geometry.creditCells, Array(2).fill(locale === "ar" ? "آجل" : "À crédit"), caseName + " credit invoices have an honest payment label");
          assert.equal(geometry.pageOverflow, false, caseName + " page stays within its viewport");
          assert.equal(geometry.roleText.label, locale === "ar" ? "التجار" : "Commerçants", caseName + " selected role uses its full translated name");
          assert(geometry.role.width + 1 >= geometry.roleText.requiredWidth, caseName + " native role text fits with padding, borders and a20px dropdown-arrow allowance: " + JSON.stringify(geometry.roleText));
          assert.equal(geometry.dateLabels.length, 2, caseName + " both date captions remain present");
          for (const label of geometry.dateLabels) assert(label.fits, caseName + " full date caption fits its own span and date control: " + JSON.stringify(label));
          if (width === 1280) {
            const centers = [geometry.role, geometry.name, geometry.dates, geometry.print].map(item => item.centerY);
            assert(Math.max(...centers) - Math.min(...centers) <= 2, caseName + " role, name, date actions and print share one vertical center");
          }
          const rows = [];
          for (const card of geometry.cards) {
            let row = rows.find(item => Math.abs(item.top - card.top) <= 1);
            if (!row) rows.push(row = { top: card.top, count: 0 });
            row.count++;
            assert(card.labelFits && card.valueFits, caseName + " complete label and amount remain inside their card: " + card.label);
            assert(card.left >= geometry.footer.left - 1 && card.right <= geometry.footer.right + 1 && card.top >= 0 && card.bottom <= geometry.viewportHeight + 1, caseName + " each footer tile remains fully visible");
          }
          const columns = width === 1280 ? 6 : width === 760 ? 3 : 2;
          assert.equal(rows.length, 6 / columns, caseName + " footer row count");
          assert(rows.every(row => row.count === columns), caseName + " balanced footer columns");
          assert(geometry.body.bottom <= geometry.footer.top + 1, caseName + " report body does not overlap footer");
        } catch (error) { geometryFailures.push(caseName + ": " + (error instanceof Error ? error.message : String(error))); }
      }
    }
  } finally {
    await evaluate('window.__smokeSetLocale("ar")');
    await until(() => evaluate('document.documentElement.lang==="ar"'), "restored Arabic locale");
    await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  }
  assert.deepEqual(geometryFailures, [], "Trader ledger responsive semantics: " + JSON.stringify(geometryFailures));
  assert.deepEqual(await snapshot(), beforeRead, "Detail/report navigation never rewrites the trader's cash, debt, stock or source history");
  checkpoints.push("A trader created through its native form is selectable in both actual credit purchase and POS forms; purchase20 and sale30 yield one net receivable10, stock11 and unchanged cash, with both native sources visible in the shared account");
  checkpoints.push("The distinct trader ledger shows both invoice sides once and six exact sales/purchase/received/paid/receivable/payable totals30/20/0/0/10/0; account navigation and reports preserve every saved business record");
  return { checkpoints, layouts, ledgerGeometry, traderId: trader.id, productId, invoices, metricValues, footer: [30, 20, 0, 0, 10, 0], cashUnchanged: true, sourceSnapshotsUnchanged: true };
}
