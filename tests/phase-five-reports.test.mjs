import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),reports=readFileSync(new URL("../lib/reports.ts",import.meta.url),"utf8");
test("draft dates commit explicitly and filters auto-refresh the last committed scope",()=>{
  assert.match(app,/applyDraftPeriod/);assert.match(app,/setCommittedPeriod\(period\)/);
  assert.match(app,/applyAllTime/);assert.match(app,/setCommittedPeriod\(null\)/);
  assert.match(app,/setTimeout\(\(\)\s*=>\s*void runReport\(committedPeriod,\s*1\),\s*180\)/);
  assert.match(app,/AbortController/);assert.doesNotMatch(app,/runReport\(.*draftFrom/);
  const run=app.slice(app.indexOf("const runReport"),app.indexOf("const changeSalesGroup"));
  assert.match(run,/window\.clearTimeout\(reportFilterTimer\.current\)[\s\S]*reportRequest\.current\?\.abort\(\)/,
    "An explicit query cancels any older debounced query before starting its own request");
  assert.match(app,/reportFilterTimer\.current\s*=\s*timer/);
  assert.match(app,/window\.clearTimeout\(timer\)/);
});
test("product movement name and sortable headers replace standalone sort selector",()=>{assert.match(app,/"product-sales":"حركة المنتجات"/);assert.doesNotMatch(app,/الأعلى كمية|الأعلى مبيعات|الأعلى ربحًا/);assert.match(app,/report-sort-header/);assert.doesNotMatch(app,/reportOrder[^\n]+"profit"/)});
test("report cost resolution preloads bounded datasets without per-line queries",()=>{const facts=reports.slice(reports.indexOf("async function saleFacts"),reports.indexOf("function profitSummary"));assert.doesNotMatch(facts,/findOne/);assert.match(facts,/Promise\.all/);assert.match(facts,/purchaseRows/);assert.match(facts,/latestReportCost/);assert.match(reports,/f\.unpaged \? rows/)});

test("interactive reports are paged while printing deliberately requests the full report",()=>{
  assert.match(app,/reportPageSize=100/);
  const query=app.slice(app.indexOf("const reportQuery"),app.indexOf("const fetchReport"));
  assert.match(query,/new URLSearchParams\(\{type,page:String\(requestedPage\),pageSize:String\(reportPageSize\)\}\)/);
  assert.doesNotMatch(query,/\.set\(["']unpaged["']/);
  const output=app.slice(app.indexOf("const printReport"),app.indexOf("const applyDraftPeriod"));
  assert.match(output,/new URLSearchParams\(completedSalesQuery\)/,
    "Sales output reuses the successfully displayed query, not pending draft filters");
  assert.match(output,/query\.set\("page",\s*"1"\)[\s\S]*query\.set\("unpaged",\s*"true"\)[\s\S]*await fetchReport\(query\)/);
  assert.match(app,/className="report-pagination no-print"/);
  assert.match(query,/sortKey/);assert.match(query,/sortDirection/);
  assert.doesNotMatch(app,/new URLSearchParams\(\{type,unpaged:"true"\}\)/);
});
