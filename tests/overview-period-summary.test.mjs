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

test("overview KPIs open exact source breakdowns including net profit formula",async()=>{const ui=await source("app/conta-app.tsx");for(const key of ["currentAccountsBalance","currentInventoryValue","currentReceivable","currentPayable","sales","purchases","expenses","netOperatingResult"])assert.match(ui,new RegExp(`openOverviewSummary\\("${key}"\\)`));assert.match(ui,/formula:\[\{label:tr\("ربح المبيعات"\)/);assert.match(ui,/value:-reportNumber\(result\.summary\.expenses\)/);assert.match(ui,/net-sales-zero/);assert.match(ui,/net-expenses-zero/);assert.match(ui,/overview-returns-zero/);assert.match(ui,/overview-purchases-zero/);assert.match(ui,/overview-expenses-zero/);});
