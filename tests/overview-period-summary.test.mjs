import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("overview separates current position from period performance", async () => {
  const [ui, reports] = await Promise.all([source("app/conta-app.tsx"), source("lib/reports.ts")]);
  assert.match(ui, /overview-summary-groups/);
  assert.match(ui, /tr\("الوضع الحالي"\)/);
  assert.match(ui, /tr\("أداء الفترة"\)/);
  for (const key of ["currentAccountsBalance","currentInventoryValue","currentReceivable","currentPayable","sales","purchases","expenses","netOperatingResult"]) assert.match(ui, new RegExp(`summary\.${key}`));
  assert.match(reports, /netOperatingResult:p\.profit-expenses/);
});

test("overview KPI details keep only calculation contributors in one signed money column",async()=>{const ui=await source("app/conta-app.tsx");for(const key of ["currentAccountsBalance","currentInventoryValue","currentReceivable","currentPayable","sales","purchases","expenses","netOperatingResult"])assert.match(ui,new RegExp(`openOverviewSummary\\("${key}"\\)`));assert.match(ui,/label:tr\("صافي المبيعات"\),value:sales/);assert.match(ui,/label:tr\("تكلفة المبيعات"\),value:-salesCost/);assert.match(ui,/label:tr\("إجمالي المصاريف"\),value:-expenses/);assert.doesNotMatch(ui,/excludedProfitMeta/);assert.doesNotMatch(ui,/impact:/);assert.doesNotMatch(ui,/الأثر في المجموع/);assert.match(ui,/overview-sales-total/);assert.match(ui,/overview-returns-total/);});
