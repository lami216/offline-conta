import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const write = (path, value) => writeFileSync(path, value);
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

// Keep date validation pure and shared. UI callers decide how to present the issue.
write("app/date-range-validation.ts", `export type DateRangeIssue = "missing" | "invalid" | "reversed" | "too-long";\n\nconst DATE = /^\\d{4}-\\d{2}-\\d{2}$/;\nexport const MAX_REPORT_RANGE_DAYS = 3660;\n\nfunction parseCalendarDate(value: string) {\n  if (!DATE.test(value)) return null;\n  const parsed = new Date(\`${'${value}'}T00:00:00.000Z\`);\n  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;\n}\n\n/** Complete ranges are required by every Apply action. Show-all is represented separately. */\nexport function validateRequiredDateRange(from: string, to: string): DateRangeIssue | null {\n  const start = from.trim(), end = to.trim();\n  if (!start || !end) return "missing";\n  const startDate = parseCalendarDate(start), endDate = parseCalendarDate(end);\n  if (!startDate || !endDate) return "invalid";\n  if (startDate > endDate) return "reversed";\n  if ((endDate.valueOf() - startDate.valueOf()) / 86400000 > MAX_REPORT_RANGE_DAYS) return "too-long";\n  return null;\n}\n`);

// Remove the global DOM click interceptor: validation belongs to the shared control/handlers.
{
  const path = "app/layout.tsx";
  let s = read(path);
  s = s.replace('import DateRangeActionGuard from "./date-range-action-guard";\n', "");
  s = s.replace('<body><LocaleProvider initialLocale={locale}><DateRangeActionGuard />{children}</LocaleProvider></body>', '<body><LocaleProvider initialLocale={locale}>{children}</LocaleProvider></body>');
  write(path, s);
}
if (existsSync("app/date-range-action-guard.tsx")) unlinkSync("app/date-range-action-guard.tsx");

// Report API returns accounting rows unchanged; presentation chooses the correct total field.
{
  const path = "app/api/reports/route.ts";
  let s = read(path);
  s = s.replace('import { presentReportResponse } from "../../report-presentation";\n', "");
  s = s.replace('const report=await buildReport(await getDatabase(),filters); return Response.json(presentReportResponse(filters,report));', 'return Response.json(await buildReport(await getDatabase(),filters));');
  write(path, s);
}
if (existsSync("app/report-presentation.ts")) unlinkSync("app/report-presentation.ts");

{
  const path = "app/conta-app.tsx";
  let s = read(path);
  s = replaceOnce(s,
    'import { bankScopeMetrics, filterFinancialMovements, filterTransfers, type CommittedPeriod } from "./bank-filters";\n',
    'import { bankScopeMetrics, filterFinancialMovements, filterTransfers, type CommittedPeriod } from "./bank-filters";\nimport { validateRequiredDateRange, type DateRangeIssue } from "./date-range-validation";\n',
    "date validation import");

  s = replaceOnce(s,
`function CompactDateRange({ from, to, onFromChange, onToChange, allTime, onApply, onAllTime }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void; allTime: boolean; onApply?: () => void; onAllTime: () => void }) {\n  return <div className="compact-date-range"><label><span>{tr("من")}</span><input aria-label={tr("من")} type="date" dir="ltr" value={from} onChange={event => onFromChange(event.target.value)} /></label><label><span>{tr("إلى")}</span><input aria-label={tr("إلى")} type="date" dir="ltr" value={to} onChange={event => onToChange(event.target.value)} /></label>{onApply&&<button type="button" className="primary date-apply" onClick={onApply}>{tr("عرض")}</button>}<button type="button" className={allTime ? "soft active" : "soft"} aria-pressed={allTime} onClick={onAllTime}>{tr("عرض الكل")}</button></div>;\n}`,
`function dateRangeIssueMessage(issue: DateRangeIssue) {\n  if (issue === "missing") return \`${'${tr("الفترة مطلوبة")} — ${tr("اختر الفترة ثم اضغط عرض، أو اختر عرض الكل")}'}\`;\n  if (issue === "invalid") return tr("التاريخ غير صالح");\n  if (issue === "reversed") return tr("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية");\n  return tr("الفترة طويلة جدًا");\n}\nfunction CompactDateRange({ from, to, onFromChange, onToChange, allTime, onApply, onAllTime }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void; allTime: boolean; onApply?: () => void; onAllTime: () => void }) {\n  const apply=()=>{if(!onApply)return;const issue=validateRequiredDateRange(from,to);if(issue){showTransientNotice(dateRangeIssueMessage(issue));return}onApply()};\n  return <div className="compact-date-range"><label><span>{tr("من")}</span><input aria-label={tr("من")} type="date" dir="ltr" value={from} onChange={event => onFromChange(event.target.value)} /></label><label><span>{tr("إلى")}</span><input aria-label={tr("إلى")} type="date" dir="ltr" value={to} onChange={event => onToChange(event.target.value)} /></label>{onApply&&<button type="button" className="primary date-apply" onClick={apply}>{tr("عرض")}</button>}<button type="button" className={allTime ? "soft active" : "soft"} aria-pressed={allTime} onClick={onAllTime}>{tr("عرض الكل")}</button></div>;\n}`,
    "central CompactDateRange guard");

  s = replaceOnce(s,
`  const applyDraftPeriod=()=>{if(draftFrom&&draftTo&&draftFrom>draftTo){setReportError(tr("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية"));return}const period={from:draftFrom,to:draftTo};setCommittedPeriod(period);void runReport(period)};`,
`  const applyDraftPeriod=()=>{const issue=validateRequiredDateRange(draftFrom,draftTo);if(issue){setReportError(dateRangeIssueMessage(issue));return}const period={from:draftFrom,to:draftTo};setCommittedPeriod(period);void runReport(period)};`,
    "report apply guard");

  s = replaceOnce(s,
`function useBankScope(){const today=localBusinessDay(),[draftFrom,setDraftFrom]=useState(today),[draftTo,setDraftTo]=useState(today),[period,setPeriod]=useState<CommittedPeriod>(()=>({from:today,to:today}));const resetAllFilters=()=>{setDraftFrom("");setDraftTo("");setPeriod(null)};return {draftFrom,draftTo,setDraftFrom,setDraftTo,period,commit:()=>setPeriod({from:draftFrom,to:draftTo}),all:resetAllFilters}}`,
`function useBankScope(){const today=localBusinessDay(),[draftFrom,setDraftFrom]=useState(today),[draftTo,setDraftTo]=useState(today),[period,setPeriod]=useState<CommittedPeriod>(()=>({from:today,to:today}));const resetAllFilters=()=>{setDraftFrom("");setDraftTo("");setPeriod(null)};const commit=()=>{const issue=validateRequiredDateRange(draftFrom,draftTo);if(issue){showTransientNotice(dateRangeIssueMessage(issue));return}setPeriod({from:draftFrom,to:draftTo})};return {draftFrom,draftTo,setDraftFrom,setDraftTo,period,commit,all:resetAllFilters}}`,
    "bank scope guard");

  s = replaceOnce(s,
`  const commitPeriod=()=>{if(draftFrom&&draftTo&&draftFrom>draftTo){setPeriodError(tr("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية"));return}setPeriodError("");setCommittedPeriod({from:draftFrom,to:draftTo});setHasInventoryView(true)};`,
`  const commitPeriod=()=>{const issue=validateRequiredDateRange(draftFrom,draftTo);if(issue){setPeriodError(dateRangeIssueMessage(issue));return}setPeriodError("");setCommittedPeriod({from:draftFrom,to:draftTo});setHasInventoryView(true)};`,
    "inventory apply guard");

  s = replaceOnce(s,
`sales:productId?[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["product",tr("المنتج"),"text"],["quantity",tr("الكمية"),"number"],["unitPrice",tr("سعر البيع"),"money"],["cost",tr("تكلفة الشراء"),"money"],["profit",tr("الربح"),"money"]]`,
`sales:productId?[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["product",tr("المنتج"),"text"],["quantity",tr("الكمية"),"number"],["revenue",tr("قيمة البيع"),"money"],["cost",tr("تكلفة الشراء"),"money"],["profit",tr("الربح"),"money"]]`,
    "filtered sales total column");

  s = replaceOnce(s,
`  const numericKeys=new Set(["quantity","unitPrice","total","cost","profit","margin","paid","due","sales","purchases","expenses","received","net","soldQuantity","currentQuantity","purchasedQuantity","netPurchases","netSales","averagePrice","averagePurchasePrice","invoiceCount","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit","products"]);`,
`  const numericKeys=new Set(["quantity","unitPrice","revenue","total","cost","profit","margin","paid","due","sales","purchases","expenses","received","net","soldQuantity","currentQuantity","purchasedQuantity","netPurchases","netSales","averagePrice","averagePurchasePrice","invoiceCount","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit","products"]);`,
    "revenue numeric display");
  s = replaceOnce(s,
`  const monetaryKeys=new Set(["unitPrice","total","cost","profit","paid","due","sales","purchases","expenses","received","net","netPurchases","netSales","averagePrice","averagePurchasePrice","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit"]);`,
`  const monetaryKeys=new Set(["unitPrice","revenue","total","cost","profit","paid","due","sales","purchases","expenses","received","net","netPurchases","netSales","averagePrice","averagePurchasePrice","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit"]);`,
    "revenue money display");
  write(path, s);
}

// If a later main-frame navigation fails after startup, replace Chromium's raw error page
// with an in-app recovery screen. API 4xx responses do not trigger this path.
{
  const path = "desktop/main.cjs";
  let s = read(path);
  s = replaceOnce(s,
` await window.loadURL(url);window.maximize();`,
` await window.loadURL(url);\n window.webContents.on('did-fail-load',(_event,errorCode,errorDescription,validatedURL,isMainFrame)=>{\n  if(!isMainFrame||quitting||!isLocal(validatedURL))return;\n  stamp(\`main-frame load failed code=${'${errorCode}'} description=${'${errorDescription}'} url=${'${validatedURL}'}\`);\n  const recovery=\`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${'${PRODUCT_NAME}'}</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f8fa;color:#1f2937}.card{width:min(520px,88vw);background:white;border:1px solid #ddd;border-radius:14px;padding:28px;text-align:center;box-shadow:0 12px 36px #0002}button{border:0;border-radius:9px;padding:10px 18px;background:#1967d2;color:white;font-weight:700;cursor:pointer}</style><body><div class="card"><h2>تعذر تحميل الصفحة داخل الكرنه</h2><p>لم يتم إغلاق البرنامج أو تغيير البيانات. اضغط إعادة المحاولة للرجوع إلى النظام.</p><button onclick="location.replace('${'${url}'}')">إعادة المحاولة</button></div></body></html>\`;\n  void window.loadURL(\`data:text/html;charset=utf-8,${'${encodeURIComponent(recovery)}'}\`).catch(error=>stamp(\`recovery page failed: ${'${error.stack||error}'}\`));\n });\n window.maximize();`,
    "renderer load recovery");
  write(path, s);
}

write("tests/report-date-and-sales-presentation.test.mjs", `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { readFileSync } from "node:fs";\nimport { validateRequiredDateRange, MAX_REPORT_RANGE_DAYS } from "../app/date-range-validation.ts";\nimport { parseReportFilters } from "../lib/reports.ts";\n\ntest("required date ranges reject empty, malformed, reversed and overlong periods", () => {\n  assert.equal(validateRequiredDateRange("", ""), "missing");\n  assert.equal(validateRequiredDateRange("2026-09-10", ""), "missing");\n  assert.equal(validateRequiredDateRange("", "2026-09-10"), "missing");\n  assert.equal(validateRequiredDateRange("2026-02-30", "2026-09-10"), "invalid");\n  assert.equal(validateRequiredDateRange("not-a-date", "2026-09-10"), "invalid");\n  assert.equal(validateRequiredDateRange("2026-09-11", "2026-09-10"), "reversed");\n  assert.equal(validateRequiredDateRange("2010-01-01", "2026-09-10"), "too-long");\n  assert.equal(validateRequiredDateRange("2026-09-10", "2026-09-10"), null);\n  assert.equal(MAX_REPORT_RANGE_DAYS, 3660);\n});\n\ntest("report API remains a second line of defense for missing dates while all-time is valid", () => {\n  assert.throws(() => parseReportFilters(new URL("http://local/api/reports?type=sales&from=&to=")), /الفترة مطلوبة/);\n  const all = parseReportFilters(new URL("http://local/api/reports?type=sales&allTime=true"));\n  assert.equal(all.allTime, true);\n});\n\ntest("filtered sales UI displays line revenue total without overwriting unit price semantics", () => {\n  const source = readFileSync(new URL("../app/conta-app.tsx", import.meta.url), "utf8");\n  assert.match(source, /sales:productId\\?\\[\\["number"[\\s\\S]*?\\["revenue",tr\\("قيمة البيع"\\),"money"\\]/);\n  assert.doesNotMatch(source, /sales:productId\\?\\[\\["number"[\\s\\S]{0,500}?\\["unitPrice",tr\\("سعر البيع"\\),"money"\\]/);\n  assert.match(source, /validateRequiredDateRange\\(from,to\\)/);\n  assert.match(source, /const applyDraftPeriod=\\(\\)=>\\{const issue=validateRequiredDateRange\\(draftFrom,draftTo\\)/);\n});\n\ntest("desktop renderer has a local recovery path instead of leaving Chromium raw error UI", () => {\n  const source = readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");\n  assert.match(source, /did-fail-load/);\n  assert.match(source, /تعذر تحميل الصفحة داخل الكرنه/);\n  assert.match(source, /إعادة المحاولة/);\n});\n`);

console.log("PR59 refinement applied");
