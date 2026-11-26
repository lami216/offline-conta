import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildReportFooterMetrics } from "../app/report-footer.ts";
import { translate } from "../app/i18n/messages.ts";
import { isOperatingFinancialMovement } from "../lib/reports.ts";

const result = summary => ({ report:"sales",from:null,to:null,summary,rows:[],meta:{page:1,pageSize:0,totalRows:0,totalPages:1} });
const keys = (type,summary={},context={}) => buildReportFooterMetrics({type,result:result(summary),...context}).map(x=>x.key);
test("visible reports expose exact semantic footer keys",()=>{
  assert.deepEqual(keys("sales"),["netSales","cost","profit","margin"]);
  assert.deepEqual(keys("purchases"),["total","paid","due","count"]);
  assert.deepEqual(keys("purchases",{total:100,quantity:4},{productFiltered:true}),["total","quantity","averagePurchasePrice","count"]);
  assert.deepEqual(keys("product-sales"),["sales","profit","quantity","products"]);
  assert.deepEqual(keys("stock"),["incoming","outgoing","netChange","movements"]);
  assert.deepEqual(keys("debts"),["receivable","payable","net","count"]);
  assert.deepEqual(keys("party-ledger"),["tradeTotal","receivedTotal","closingReceivable","closingPayable"]);
  assert.deepEqual(keys("party-ledger",{partyType:"supplier"}),["tradeTotal","paidTotal","closingReceivable","closingPayable"]);
  assert.deepEqual(keys("party-ledger",{partyType:"employee"}),["workersAccrued","workersPaid","workersDeposited","closingReceivable","closingPayable"]);
  assert.deepEqual(keys("financial"),["businessIncoming","businessOutgoing","businessNet","balanceNet"]);
  assert.deepEqual(keys("expenses"),["recurringTotal","nonrecurringTotal"]);
});
test("footer tones follow business meaning and meaningful zero stays visible",()=>{
  const debts=buildReportFooterMetrics({type:"debts",result:result({receivable:20,payable:10,net:10,count:2})});
  assert.deepEqual(debts.map(x=>x.tone),["positive","negative","positive","neutral"]);
  assert.equal(buildReportFooterMetrics({type:"debts",result:result({net:-1})})[2].tone,"negative");
  assert.deepEqual(buildReportFooterMetrics({type:"stock",result:result({})}).slice(0,2).map(x=>x.tone),["neutral","neutral"]);
  assert.equal(buildReportFooterMetrics({type:"purchases",result:result({})})[0].tone,"neutral");
  assert.equal(buildReportFooterMetrics({type:"expenses",result:result({})})[0].tone,"negative");
  assert.equal(buildReportFooterMetrics({type:"sales",result:result({profit:-2})})[2].tone,"negative");
  const balances=buildReportFooterMetrics({type:"party-ledger",result:result({closingReceivable:0,closingPayable:0})}).slice(-2);
  assert.deepEqual(balances.map(item=>item.value),[0,0]);
  assert.equal(buildReportFooterMetrics({type:"debts",result:result({net:0})})[2].note,"متوازن");
});

test("party ledger footers keep separate period-end claims and debts instead of netting or substituting today's balance",()=>{
  const summary=Object.freeze({partyType:"customer",tradeTotal:700,receivedTotal:60,paidTotal:900,
    closingBalance:330,closingReceivable:450,closingPayable:120,currentBalance:-1000,net:-1000,receivable:0,payable:1000});
  const input=result(summary),before=structuredClone(input);
  const customer=buildReportFooterMetrics({type:"party-ledger",result:input});
  assert.deepEqual(customer.map(item=>[item.key,item.value]),[["tradeTotal",700],["receivedTotal",60],["closingReceivable",450],["closingPayable",120]]);
  assert.deepEqual(customer.slice(-2).map(item=>item.tone),["positive","negative"]);
  assert.equal(customer[1].label,"تحصيلات حسابات العملاء في الفترة");
  const supplier=buildReportFooterMetrics({type:"party-ledger",result:input,partyType:"supplier"});
  assert.deepEqual(supplier.map(item=>item.value),[700,900,450,120]);
  assert.equal(supplier[1].label,"دفعات حسابات الموردين في الفترة");
  assert.equal(supplier[1].tone,"negative");
  assert.deepEqual(input,before,"Formatting never rewrites the period totals or saved current balance");
});

test("worker ledger footer distinguishes entitlement and cash movements without inventing salary expense or hiding zero deposits",()=>{
  const metrics=buildReportFooterMetrics({type:"party-ledger",result:result({partyType:"employee",
    workersAccrued:1000,workersPaid:1200,workersDeposited:0,workersExpense:300,
    closingReceivable:200,closingPayable:70,currentBalance:999,net:999})});
  assert.deepEqual(metrics.map(item=>[item.key,item.value]),[["workersAccrued",1000],["workersPaid",1200],["workersDeposited",0],["closingReceivable",200],["closingPayable",70]]);
  assert.equal(metrics[1].label,"المسحوب خلال الفترة");
  assert.equal(metrics[1].tone,"neutral","A cash withdrawal can include advances, so its label is not a wage expense");
  assert.equal(metrics[2].label,"المودع خلال الفترة");
  assert.equal(metrics.some(item=>["workersExpense","net","currentBalance"].includes(item.key)),false);
});

test("party ledger labels cover all three account roles, signed movement balances and reconciliation in Arabic and French",()=>{
  for(const key of ["الرصيد قبل الحركة","تغيّر الرصيد","الرصيد بعد الحركة","كل العملاء","كل الموردين","كل العمال",
    "+ مستحق لنا، − مستحق علينا","بعض الأرصدة المحسوبة من الحركات تختلف عن الأرصدة المسجلة."]){
    assert.equal(translate("ar",key),key);
    assert.equal(typeof translate("fr",key),"string");
    assert.notEqual(translate("fr",key),key);
  }
  assert.equal(translate("fr","كشف حسابات الأطراف"),"Relevé des comptes des tiers");
  const metrics=buildReportFooterMetrics({type:"party-ledger",result:result({partyType:"supplier"}),translate:key=>translate("fr",key)});
  assert.deepEqual(metrics.map(item=>item.label),["Achats auprès des fournisseurs sur la période","Règlements des comptes fournisseurs sur la période","À recevoir en fin de période","À payer en fin de période"]);
});
test("product purchase footer never presents invoice payment allocation",()=>{ const metrics=buildReportFooterMetrics({type:"purchases",result:result({total:100,quantity:4,paid:80,due:20,count:1}),productFiltered:true}); assert.equal(metrics[2].value,25); assert.ok(!metrics.some(x=>["paid","due"].includes(x.key))); });
test("financial operating classification excludes balance administration and transfers",()=>{ for(const type of ["transfer-in","transfer-out","opening-balance","manual-deposit","manual-withdrawal","balance-correction"]) assert.equal(isOperatingFinancialMovement(type),false); for(const type of ["sale","purchase","expense","party-receipt","party-payment"]) assert.equal(isOperatingFinancialMovement(type),true); });
test("party ledger composite filter has compact geometry and a separate sign legend on narrow screens",async()=>{
  const [css,ui]=await Promise.all([readFile(new URL("../app/globals.css",import.meta.url),"utf8"),readFile(new URL("../app/conta-app.tsx",import.meta.url),"utf8")]);
  assert.match(css,/\.report-filters>\.party-ledger-filter\{max-width:none/);
  assert.match(css,/\.party-ledger-filter\s*\{\s*grid-template-columns:\s*148px minmax\(185px,\s*230px\) auto;\s*min-width:\s*0;/);
  assert.match(css,/\.party-ledger-filter \.combobox\s*\{\s*min-width:\s*0;/);
  assert.match(css,/@media\s*\(max-width:\s*700px\)\s*\{\s*\.party-ledger-filter\s*\{\s*grid-template-columns:\s*minmax\(100px,\s*148px\) minmax\(0,\s*1fr\);\s*\}\s*\.party-ledger-sign\s*\{\s*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(ui,/العملاء/);assert.match(ui,/الموردون/);
});

test("expense screen, printable output and export share columns without the retired schedule type", async () => {
  const ui = await readFile(new URL("../app/conta-app.tsx", import.meta.url), "utf8");
  const expenseColumns = ui.match(/expenses:\[\[.*?\]\],/)[0];
  const voucher = ui.match(/if\(record.kind==="expense"\)return[^\n]+/)[0];
  assert.doesNotMatch(expenseColumns, /recurring|\["[^"]+",tr\("النوع"\)/);
  assert.match(expenseColumns, /expenseCategory/);
  assert.doesNotMatch(voucher, /recurringId|مصروف متكرر/);
  assert.match(ui, /printTable=reportTableModel\(reportColumns\(/);
  assert.match(ui, /buildReportFooterMetrics\(\{type,result:printResult/);
  const metrics = buildReportFooterMetrics({
    type: "expenses",
    result: result({ total: 600, count: 3, recurringTotal: 300, nonrecurringTotal: 300 }),
  });
  assert.deepEqual(metrics.map(metric => [metric.key, metric.value]), [["recurringTotal", 300], ["nonrecurringTotal", 300]]);
});
