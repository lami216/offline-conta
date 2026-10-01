import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { translate } from "../app/i18n/messages.ts";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../app/conta-app.tsx");
const reports = read("../lib/reports.ts");

test("legacy direct-sale and direct-purchase identities localize at presentation time", () => {
  assert.equal(translate("fr", "بيع مباشر"), "Vente directe");
  assert.equal(translate("fr", "شراء مباشر"), "Achat direct");
  assert.equal(translate("fr", "مدفوعة"), "Payé");
  assert.match(app, /document\.partyId == null && document\.kind === "sale"\) return tr\("بيع مباشر"\)/);
  assert.match(app, /document\.partyId == null && document\.kind === "purchase"\) return tr\("شراء مباشر"\)/);
  assert.match(app, /const customer = invoicePartyName\(document\) \|\| tr\("بيع مباشر"\)/);
  assert.match(app, /tr\("مدفوعة"\)/);
  assert.match(app, /partyName=invoicePartyName\(record\)/);
});

test("financial audit and reports use semantic identity instead of translating arbitrary user names", () => {
  assert.match(app, /movement\.partyId == null && kind==="sale"/);
  assert.match(app, /movement\.partyId == null && kind==="purchase"/);
  assert.match(app, /<td>\{financialMovementPartyName\(row\)\}<\/td>/);
  assert.match(reports, /partyId:String\(document\.partyId\?\?""\)/);
  assert.match(reports, /partyId:String\(row\.partyId\?\?""\)/);
  assert.match(app, /if\(!partyId&&type==="sales"\)return tr\("بيع مباشر"\)/);
  assert.match(app, /if\(!partyId&&type==="purchases"\)return tr\("شراء مباشر"\)/);
});

test("party-ledger labels carry stable semantic codes for localized presentation", () => {
  assert.match(reports, /movementCode=\(document:Document\)=>/);
  assert.match(reports, /movementCode:movementCode\(document\)/);
  assert.match(reports, /descriptionCode:document\.kind==="payment"/);
  assert.match(app, /code==="party-receipt"/);
  assert.match(app, /code==="party-payment"/);
  assert.match(app, /row\?\.descriptionCode==="party-receipt"/);
});

test("bank operation presentation no longer depends on Arabic display words", () => {
  const financialBlock = app.slice(app.indexOf("type FinancialDetail"), app.indexOf("function Banks("));
  assert.match(financialBlock, /detail\.kind==="manual-deposit"/);
  assert.match(financialBlock, /detail\.kind==="manual-withdrawal"/);
  assert.doesNotMatch(financialBlock, /\/إيداع\/\.test\(detail\.type\)/);
  assert.doesNotMatch(financialBlock, /\/سحب\/\.test\(detail\.type\)/);
  assert.match(app, /tr\(label\)/);
  assert.match(app, /Object\.entries\(movementLabels\)\.map\(\(\[key,label\]\)=>\[key,tr\(label\)\]\)/);
});

test("specific system confirmations and official document metadata are localized", () => {
  assert.match(app, /tr\("expense\.deleteConfirm"/);
  assert.match(app, /tr\("bank\.transferDeleteConfirm"/);
  assert.match(app, /tr\("bank\.adjustmentDeleteConfirm"/);
  assert.match(app, /tr\("party\.movementDeleteConfirm"/);
  assert.match(app, /tr\("stock\.transferDeleteConfirm"/);
  assert.match(app, /tr\("stock\.adjustmentDeleteConfirm"/);
  assert.match(app, /tr\("رقم السجل التجاري"\)/);
  assert.match(app, /tr\("الرقم الضريبي"\)/);
  assert.match(app, /record\.partyCashDirection\?\(receive\?tr\("استلام من الطرف"\):tr\("دفع للطرف"\)\)/);
});

test("French import progress uses semantic phase keys while unknown source labels remain untouched", () => {
  assert.match(app, /const importPhaseLabels:Record<string,MessageKey>/);
  assert.match(app, /tr\("import\.progress"/);
  assert.match(app, /importGroupLabels\[g\.key\]\?tr\(importGroupLabels\[g\.key\]\):g\.label/);
  assert.equal(translate("fr", "فحص الملف"), "Analyse du fichier");
  assert.equal(translate("fr", "أرصدة المخزون"), "Soldes de stock");
});
