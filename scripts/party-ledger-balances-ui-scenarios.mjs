import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { captureControlLayouts } from "./ui-control-bounds.mjs";

function workbook(bytes) {
  const data = Buffer.from(bytes), sheets = []; let offset = 0;
  const decode = text => text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const method = data.readUInt16LE(offset + 8), size = data.readUInt32LE(offset + 18), names = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28), name = data.subarray(offset + 30, offset + 30 + names).toString("utf8"), start = offset + 30 + names + extra;
    assert([0, 8].includes(method)); assert(start + size <= data.length);
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const packed = data.subarray(start, start + size), xml = (method === 8 ? inflateRawSync(packed) : packed).toString("utf8");
      sheets.push([...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => {
        const value = /<v>([^<]+)<\/v>/.exec(cell[1]); return value ? Number(value[1]) : decode(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell[1])?.[1] ?? "");
      })));
    }
    offset = start + size;
  }
  assert.equal(sheets.length, 2); return sheets;
}

/** All figures below come from real synthetic commands; browsing/export is read-only. */
export async function runPartyLedgerBalancesScenarios({ cdp, origin, command, database, screenshot, output }) {
  assert.equal(process.env.CI, "true"); assert.equal(process.env.GITHUB_ACTIONS, "true"); assert.equal(process.platform, "win32");
  const evaluate = code => cdp.evaluate(code), checkpoints = [], layouts = [], exports = [], roleProofs = [], expected = new Map();
  const until = async (check, label) => { const end = Date.now() + 25000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error("Timed out waiting for " + label); };
  const click = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable ledger action');e.click()})()`);
  const fill = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing ledger field');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const number = text => Number(String(text).replace(/\u2212/g, "-").replace(/,/g, ".").replace(/[^0-9.+-]/g, ""));
  const close = (actual, wanted, label) => assert(Math.abs(actual - wanted) < 1e-7, label + ": " + actual + " versus " + wanted);
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const api = async (role, id = "", allTime = false) => {
    const query = new URLSearchParams({ type: "party-ledger", partyType: role, unpaged: "true", ...(allTime ? { allTime: "true" } : { from: today, to: today }), ...(id ? { partyId: id } : {}) });
    const response = await fetch(origin + "/api/reports?" + query), result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const baseline = Object.fromEntries(await Promise.all(["customer", "supplier", "employee"].map(async role => [role, await api(role)])));
  const accountId = await command({ type: "payment-account.create", name: "حساب فحص كشف الأطراف", openingBalance: 1000 });
  const add = async (role, name) => role === "employee" ? command({ type: "employee.create", name, startDate: today, amount: 0, intervalMonths: 1, entitlement: "end" }) : command({ type: "party.create", partyType: role, name });
  const remember = async (id, party, before, change, after) => {
    const document = await database.collection("documents").findOne({ id }); assert(document);
    const { displayDocumentNumber } = await import("../lib/document-sequences.ts");
    expected.set(id, { id, number: String(displayDocumentNumber(document)), party, before, change, after }); return id;
  };
  const opening = async (role, id, name, value) => remember(await command(role === "employee" ? { type: "employee-opening.post", employeeId: id, direction: value < 0 ? "payable" : "receivable", amount: Math.abs(value), occurredAt: yesterday, note: "رصيد قبل فترة الفحص" } : { type: "party-opening.post", partyId: id, direction: value > 0 ? "receivable" : "payable", amount: Math.abs(value), occurredAt: yesterday, note: "رصيد قبل فترة الفحص" }), name, 0, value, value);
  const cash = async (role, id, name, direction, amount, before, after) => remember(await command(role === "employee" ? { type: "employee-payment.post", employeeId: id, direction, amount, paymentMethod: accountId, occurredAt: today, note: "حركة عامل محفوظة" } : { type: "party-cash.post", partyId: id, direction, amount, paymentMethod: accountId, note: "شراء\nTexte littéral du mouvement" }), name, before, after - before, after);
  const definitions = [
    { role: "customer", name: "عميل فحص الرصيد ألف", start: 100, moves: [["receive", 30, 100, 70], ["pay", 10, 70, 80]], footer: [0, 30, 80, 0] },
    { role: "customer", name: "عميل فحص الرصيد باء", start: -40, moves: [["pay", 15, -40, -25]], footer: [0, 0, 0, 25] },
    { role: "supplier", name: "مورد فحص الرصيد ألف", start: -120, moves: [["pay", 20, -120, -100], ["receive", 10, -100, -110]], footer: [0, 20, 0, 110] },
    { role: "supplier", name: "مورد فحص الرصيد باء", start: 50, moves: [["receive", 15, 50, 35]], footer: [0, 0, 35, 0] },
    { role: "employee", name: "عامل فحص الرصيد ألف", start: -90, moves: [["withdraw", 25, -90, -65], ["deposit", 5, -65, -70]], footer: [0, 25, 5, 0, 70] },
    { role: "employee", name: "عامل فحص الرصيد باء", start: 30, moves: [["deposit", 10, 30, 20]], footer: [0, 0, 10, 20, 0] },
  ];
  for (const definition of definitions) {
    definition.id = await add(definition.role, definition.name); definition.documents = [];
    definition.opening = await opening(definition.role, definition.id, definition.name, definition.start);
    for (const [direction, amount, before, after] of definition.moves) definition.documents.push(await cash(definition.role, definition.id, definition.name, direction, amount, before, after));
  }
  assert.equal((await database.collection("paymentAccounts").findOne({ id: accountId })).balance, 1000, "The deliberately balanced cash fixture finishes where it started");
  const snapshot = async () => Promise.all(["products", "documents", "stockMovements", "financialMovements", "paymentAccounts", "parties", "employees", "auditEvents", "commandReceipts"].map(name => database.collection(name).find().sort({ id: 1 }).toArray()));
  const beforeReads = await snapshot();
  await evaluate('window.__smokeSetLocale("ar")'); await evaluate('window.__smokeSetView("party-ledger")');
  await until(() => evaluate('Boolean(document.querySelector(".party-ledger-role-select"))'), "actual party ledger");
  const choose = async definition => {
    await click(".party-ledger-filter .combobox-trigger"); await until(() => evaluate('Boolean(document.querySelector(".combobox-popover"))'), "ledger account choices");
    await evaluate(`(()=>{const option=${definition ? "[...document.querySelectorAll('.combobox-popover [role=option]')].find(e=>e.title===" + JSON.stringify(definition.name) + ")" : "document.querySelector('.combobox-popover .combobox-results>button:not([role])')"};if(!option)throw Error('Missing ledger account option');option.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}))})()`);
    await until(() => evaluate('!document.querySelector(".combobox-popover")'), "ledger account chosen");
  };
  const footer = () => evaluate("[...document.querySelectorAll('.reports-workspace .report-kpi-value b')].map(e=>e.textContent.trim())");
  const expectFooter = async values => until(async () => { const actual = (await footer()).map(number); return !await evaluate('Boolean(document.querySelector(".report-loading"))') && actual.length === values.length && actual.every((value, index) => Math.abs(value - values[index]) < 1e-7); }, "role-specific ledger totals " + values.join(","));
  const grid = () => evaluate("[...document.querySelectorAll('.reports-workspace .report-table-party-ledger tbody tr')].filter(row=>row.querySelector('[data-column=documentNumber]')).map(row=>({number:row.querySelector('[data-column=documentNumber]').textContent.trim(),party:row.querySelector('[data-column=party]')?.textContent.trim(),before:row.querySelector('[data-column=balanceBefore]')?.textContent.trim(),change:row.querySelector('[data-column=balanceChange]')?.textContent.trim(),after:row.querySelector('[data-column=balanceAfter]')?.textContent.trim()}))");
  const expectRow = async id => {
    const wanted = expected.get(id); let actual;
    await until(async () => { actual = (await grid()).find(row => row.number === wanted.number && row.party === wanted.party); return Boolean(actual); }, "ledger source row " + wanted.number);
    close(number(actual.before), wanted.before, "Balance before source"); close(number(actual.change), wanted.change, "Signed movement"); close(number(actual.after), wanted.after, "Balance after source");
    if (wanted.change > 0) assert(actual.change.includes("+"), "An increase has an explicit positive sign");
  };
  const keys = role => role === "employee" ? ["workersAccrued", "workersPaid", "workersDeposited", "closingReceivable", "closingPayable"] : ["tradeTotal", role === "customer" ? "receivedTotal" : "paidTotal", "closingReceivable", "closingPayable"];
  const roleDeltas = { customer: [0, 30, 80, 25], supplier: [0, 20, 35, 110], employee: [0, 25, 15, 20, 70] };
  await evaluate(`(()=>{window.__ledgerPriorFetch=window.fetch;window.__ledgerRequests=[];window.fetch=async function(input,init){const response=await window.__ledgerPriorFetch.call(this,input,init),url=String(input?.url??input);if(url.includes('/api/reports?'))window.__ledgerRequests.push({url,status:response.status});return response};window.__ledgerPriorPrinting=window.alkarnaPrinting;window.__ledgerOutput=null;const capture=async(kind,settings)=>{const p=document.querySelector('.report-print-portal');if(!p)throw Error('Missing real ledger print portal');window.__ledgerOutput={kind,settings,headers:[...p.querySelectorAll('thead th')].map(e=>e.textContent.trim()),rows:[...p.querySelectorAll('tbody tr')].map(row=>[...row.children].map(e=>e.textContent.trim())),footer:[...p.querySelectorAll('.report-kpi-value b')].map(e=>e.textContent.trim())};await new Promise(resolve=>window.__ledgerFinishOutput=resolve);return{ok:true}};window.alkarnaPrinting={getSettings:async()=>({deviceName:null,profile:'a4'}),print:s=>capture('printer',s),pdf:s=>capture('pdf',s),saveExport:async request=>{window.__ledgerOutput={kind:'excel',bytes:Array.from(request.data)};return{ok:true}}}})()`);
  const exportView = async (role, id, report, locale, kind) => {
    const schema = await evaluate("({headers:[...document.querySelectorAll('.reports-workspace .report-table-party-ledger thead th')].map(e=>e.textContent.replace(/[↑↓]/g,'').trim()),keys:[...document.querySelector('.reports-workspace .report-table-party-ledger tbody tr').children].map(e=>e.dataset.column||'serial')})");
    await evaluate('window.__ledgerOutput=null;window.__ledgerRequests=[]'); await click(".report-print-button"); await until(() => evaluate('Boolean(document.querySelector(".output-choice-dialog"))'), "ledger output choices"); await click(".output-choice-card:nth-child(" + ({ printer: 1, pdf: 2, excel: 3 })[kind] + ")"); await until(() => evaluate('Boolean(window.__ledgerOutput)'), "real ledger output");
    const captured = await evaluate("window.__ledgerOutput"), requests = await evaluate("window.__ledgerRequests");
    assert.equal(captured.kind, kind); assert(requests.some(item => { const q = new URL(item.url, origin).searchParams; return item.status === 200 && q.get("unpaged") === "true" && q.get("partyType") === role && (q.get("partyId") || "") === id; }), "Exports keep the complete selected role/account scope");
    const file = "party-ledger-balances-" + role + "-" + (id ? "single" : "all") + "-" + locale + "-" + kind + (kind === "excel" ? ".xlsx" : ".pdf");
    const checkRows = dataRows => {
      assert.equal(dataRows.length, report.rows.length, "Unpaged export retains every source movement");
      const index = key => { const result = schema.keys.indexOf(key); assert(result >= 0, "Missing ledger column " + key); return result; };
      for (const source of report.rows) {
        const row = dataRows.find(row => String(row[index("documentNumber")]) === String(source.documentNumber) && String(row[index("party")]) === String(source.partyName ?? source.party)); assert(row, "Exported source and owner identity");
        for (const [key, value] of [["balanceBefore", source.balanceBefore], ["balanceChange", source.balanceChange], ["balanceAfter", source.balanceAfter]]) close(typeof row[index(key)] === "number" ? row[index(key)] : number(row[index(key)]), Number(value), "Exported " + key);
      }
    };
    const values = keys(role).map(key => Number(report.summary[key]));
    if (kind === "excel") {
      const sheets = workbook(captured.bytes), header = sheets[0].findIndex(row => JSON.stringify(row) === JSON.stringify(schema.headers)); assert(header >= 0, "Actual Excel has the same ledger business columns"); checkRows(sheets[0].slice(header + 1));
      assert.deepEqual(sheets[1].slice(1).map(row => Number(row[1])), values); fs.writeFileSync(path.join(output, file), Buffer.from(captured.bytes));
    } else {
      assert.deepEqual(captured.headers, schema.headers); checkRows(captured.rows); assert.deepEqual(captured.footer.map(number), values); assert.equal(captured.settings.profile, "a4");
      const rendered = await cdp.call("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }), bytes = Buffer.from(rendered.data, "base64"); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-"); assert(bytes.length > 1000); fs.writeFileSync(path.join(output, file), bytes); await evaluate('window.__ledgerFinishOutput();delete window.__ledgerFinishOutput');
    }
    await until(() => evaluate('!document.querySelector(".report-print-portal")&&!document.querySelector(".output-choice-dialog")&&!document.querySelector(".report-error")'), "ledger output cleanup"); exports.push({ role, scope: id ? "single" : "all", locale, kind, file, rows: report.rows.length, unpaged: true });
  };
  try {
    // Reset only this report's date draft to today; changing role/account must keep it.
    await evaluate(`(()=>{const inputs=document.querySelectorAll('.compact-date-range input');for(const input of inputs){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(today)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
    await click(".compact-date-range .date-apply");
    for (const role of ["customer", "supplier", "employee"]) {
      await fill(".party-ledger-role-select", role); await choose(null);
      const report = await api(role), values = keys(role).map((key, index) => Number(baseline[role].summary[key]) + roleDeltas[role][index]);
      assert.equal(report.summary.partyCount, Number(baseline[role].summary.partyCount) + 2);
      for (const [index, key] of keys(role).entries()) close(Number(report.summary[key]), values[index], "Independent full-role total " + key);
      await expectFooter(values);
      for (const definition of definitions.filter(item => item.role === role)) for (const id of definition.documents) await expectRow(id);
      assert.equal(await evaluate('document.querySelector(".party-ledger-filter .combobox-trigger").textContent.trim()'), { customer: "كل العملاء", supplier: "كل الموردين", employee: "كل العمال" }[role]);
      roleProofs.push({ role, scope: "all", partyCount: report.summary.partyCount, rowCount: report.rows.length, footer: values });
      if (role === "supplier") await exportView(role, "", report, "ar", "excel");
    }
    for (const role of ["customer", "supplier", "employee"]) {
      const definition = definitions.find(item => item.role === role); await fill(".party-ledger-role-select", role); await choose(definition); await expectFooter(definition.footer);
      for (const id of definition.documents) await expectRow(id);
      const periodInputs = await evaluate("[...document.querySelectorAll('.compact-date-range input')].map(e=>e.value)"); assert.deepEqual(periodInputs, [today, today], "Role/account changes retain the committed period");
      // On today's first movement, the previous day's opening is still the before balance.
      await expectRow(definition.documents[0]);
      await click(".compact-date-range button[aria-pressed]"); await expectFooter(definition.footer); await expectRow(definition.opening);
      const report = await api(role, definition.id, true); assert.equal(report.summary.partyCount, 1); assert.equal(report.rows.length, definition.documents.length + 1);
      const source = expected.get(definition.documents[0]); await evaluate(`(()=>{window.__openedPayrollDocument=null;[...document.querySelectorAll('.report-table-party-ledger tbody tr')].find(row=>row.querySelector('[data-column=documentNumber]')?.textContent.trim()===${JSON.stringify(source.number)}).click()})()`); assert.equal(await evaluate("window.__openedPayrollDocument"), source.id, "Native row opens its actual source document");
      const locale = role === "employee" ? "fr" : "ar"; await evaluate(`window.__smokeSetLocale(${JSON.stringify(locale)})`); await until(() => evaluate(`document.documentElement.lang===${JSON.stringify(locale)}`), "ledger language"); await expectFooter(definition.footer);
      if (role !== "supplier") for (const kind of role === "employee" ? ["excel", "printer", "pdf"] : ["excel"]) await exportView(role, definition.id, report, locale, kind);
      layouts.push(...await captureControlLayouts({ cdp, screenshot, scope: ".report-toolbar", name: "party-ledger-balances-" + role + "-" + locale, widths: [role === "customer" ? 1280 : role === "supplier" ? 760 : 480] }));
      roleProofs.push({ role, scope: "single", name: definition.name, opening: definition.start, closing: definition.moves.at(-1)[3], rows: report.rows.length, footer: definition.footer });
      await evaluate('window.__smokeSetLocale("ar")');
      await fill(".party-ledger-role-select", { customer: "supplier", supplier: "employee", employee: "customer" }[role]);
      assert.equal(await evaluate('document.querySelector(".compact-date-range button[aria-pressed]").getAttribute("aria-pressed")'), "true", "Changing role also retains an explicit all-time period");
      // Restore today's period before moving on to the next individual account.
      await evaluate(`(()=>{for(const input of document.querySelectorAll('.compact-date-range input')){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(today)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))}})()`); await click(".compact-date-range .date-apply");
    }
    assert.deepEqual(await snapshot(), beforeReads, "Ledger filters, running balances, source navigation and output never rewrite stock/cash/debt/payroll/history");
    checkpoints.push("Customer/supplier/worker ledgers load all accounts of their own role or one selected account, retain the period, show independently proven signed before/change/after balances including yesterday's opening, and aggregate receivables/payables separately with role-specific totals");
    checkpoints.push("All-supplier and individual customer/worker actual Excel plus the worker print/PDF paths preserve complete unpaged identities, movements, running balances and summaries; original source navigation and every financial/stock/history snapshot remain unchanged");
    return { checkpoints, layouts, exports, roleProofs, accountCash: 1000, sourceSnapshotsUnchanged: true };
  } finally {
    await evaluate('(()=>{window.__ledgerFinishOutput?.();window.fetch=window.__ledgerPriorFetch;window.alkarnaPrinting=window.__ledgerPriorPrinting;delete window.__ledgerPriorFetch;delete window.__ledgerPriorPrinting;delete window.__ledgerRequests;delete window.__ledgerOutput;delete window.__ledgerFinishOutput})()');
  }
}
