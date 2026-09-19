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

test("overview KPIs show category totals and net profit exposes the exact coded formula",async()=>{const ui=await source("app/conta-app.tsx");for(const key of ["currentAccountsBalance","currentInventoryValue","currentReceivable","currentPayable","sales","purchases","expenses","netOperatingResult"])assert.match(ui,new RegExp(`openOverviewSummary\\("${key}"\\)`));assert.match(ui,/label:tr\("صافي المبيعات"\),value:sales,impact:sales/);assert.match(ui,/label:tr\("تكلفة المبيعات"\),value:salesCost,impact:-salesCost/);assert.match(ui,/label:tr\("إجمالي المصاريف"\),value:expenses,impact:-expenses/);assert.match(ui,/label:tr\("إجمالي المشتريات"\),meta:excludedProfitMeta,value:purchases,impact:0/);assert.match(ui,/label:tr\("السحب اليدوي"\),meta:excludedProfitMeta,value:withdrawals,impact:0/);assert.match(ui,/overview-sales-total/);assert.match(ui,/overview-returns-total/);});
