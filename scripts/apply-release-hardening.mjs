import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(path, from, to) {
  const raw = readFileSync(path, "utf8");
  const source = raw.replace(/\r\n/g, "\n");
  if (source.includes(from)) {
    writeFileSync(path, source.replace(from, to), "utf8");
    return true;
  }
  if (to && source.includes(to)) {
    if (raw !== source) writeFileSync(path, source, "utf8");
    return false;
  }
  throw new Error(`Expected source fragment not found in ${path}`);
}

replaceExact(
  "lib/reports.ts",
  'export const OPERATING_FINANCIAL_TYPES = new Set(["sale", "purchase", "expense", "party-receipt", "party-payment"]);\nexport const isOperatingFinancialMovement = (type: unknown) => OPERATING_FINANCIAL_TYPES.has(String(type));',
  'export const OPERATING_FINANCIAL_TYPES = new Set(["sale", "purchase", "expense", "party-receipt", "party-payment"]);\nexport const financialMovementKind = (type: unknown) => { const value=String(type??""); if(value.startsWith("sale:"))return "sale"; if(value.startsWith("purchase:"))return "purchase"; return value; };\nexport const isOperatingFinancialMovement = (type: unknown) => OPERATING_FINANCIAL_TYPES.has(financialMovementKind(type));',
);
replaceExact(
  "lib/reports.ts",
  '    const rows = found.rows.flatMap(document => { const selected = ((document.lines ?? []) as Document[]).filter(line => lineMatches(line, f, categoryScope)); if (f.type === "purchases" && hasProductFilter) return selected.map(line => ({ id:`${document.id}-${line.id ?? line.productId}`,documentId:String(document.id),number:displayDocumentNumber(document),occurredAt:String(document.occurredAt),party:String(document.partyName??""),product:String(identities.get(String(line.productId))?.name??line.description??"").trim()||"منتج غير متاح",sku:String(identities.get(String(line.productId))?.sku??line.sku??"—")||"—",quantity:n(line.quantity),unitPrice:n(line.unitPrice),total:n(line.lineTotal) })); return [{ id:String(document.id),documentId:String(document.id),number:displayDocumentNumber(document),occurredAt:String(document.occurredAt),party:String(document.partyName??""),paymentMethod:String(document.paymentMethod??""),title:String(document.title??""),recurring:Boolean(document.recurringId),total:n(document.total),paid:n(document.paidTotal),due:n(document.dueTotal) }]; });',
  '    const partyIds=[...new Set(found.all.map(document=>String(document.partyId??"")).filter(Boolean))],partyNames=new Map((partyIds.length?await db.collection("parties").find({id:{$in:partyIds}}).project({id:1,name:1}).toArray():[]).map(party=>[String(party.id),String(party.name)]));\n    const rows: ReportRow[] = found.rows.flatMap<ReportRow>(document => { const selected = ((document.lines ?? []) as Document[]).filter(line => lineMatches(line, f, categoryScope)),party=String(document.partyName??partyNames.get(String(document.partyId))??""); if (f.type === "purchases" && hasProductFilter) return selected.map(line => ({ id:`${document.id}-${line.id ?? line.productId}`,documentId:String(document.id),number:displayDocumentNumber(document),occurredAt:String(document.occurredAt),party,product:String(identities.get(String(line.productId))?.name??line.description??"").trim()||"منتج غير متاح",sku:String(identities.get(String(line.productId))?.sku??line.sku??"—")||"—",quantity:n(line.quantity),unitPrice:n(line.unitPrice),total:n(line.lineTotal) })); return [{ id:String(document.id),documentId:String(document.id),number:displayDocumentNumber(document),occurredAt:String(document.occurredAt),party,paymentMethod:String(document.paymentMethod??""),title:String(document.title??""),recurring:Boolean(document.recurringId),total:n(document.total),paid:n(document.paidTotal),due:n(document.dueTotal) }]; });',
);
replaceExact(
  "lib/reports.ts",
  '    if (f.type === "stock" && constraint) query.productId=constraint; if(f.movementType)query.type=f.movementType;if(f.paymentAccountId&&f.type==="financial")query.paymentMethod=f.paymentAccountId;if(f.direction&&f.type==="financial")query.direction=f.direction;',
  '    if (f.type === "stock" && constraint) query.productId=constraint; if(f.movementType)query.type=f.type==="financial"&&["sale","purchase"].includes(f.movementType)?{$regex:`^${f.movementType}(?::|$)`}:f.movementType;if(f.paymentAccountId&&f.type==="financial")query.paymentMethod=f.paymentAccountId;if(f.direction&&f.type==="financial")query.direction=f.direction;',
);
replaceExact(
  "lib/reports.ts",
  '    rows=raw.map(x=>({id:String(x.id),documentId:String(x.documentId),occurredAt:String(x.occurredAt),paymentMethod:String(x.paymentMethod),movementType:String(x.type),incoming:x.direction==="in"?n(x.amount):0,outgoing:x.direction==="out"?n(x.amount):0,party:String(x.partyName??""),documentNumber:String(x.documentNumber??"")}));',
  '    rows=raw.map(x=>({id:String(x.id),documentId:String(x.documentId),occurredAt:String(x.occurredAt),paymentMethod:String(x.paymentMethod),movementType:financialMovementKind(x.type),incoming:x.direction==="in"?n(x.amount):0,outgoing:x.direction==="out"?n(x.amount):0,party:String(x.partyName??""),documentNumber:String(x.documentNumber??"")}));',
);

replaceExact(
  "app/conta-app.tsx",
  'import { bankScopeMetrics, filterFinancialMovements, filterTransfers, type CommittedPeriod } from "./bank-filters";',
  'import { bankScopeMetrics, financialMovementKind, filterFinancialMovements, filterTransfers, type CommittedPeriod } from "./bank-filters";',
);
replaceExact(
  "app/conta-app.tsx",
  'get:(m:BootstrapData["financialMovements"][number])=>movementLabels[m.type]??m.type',
  'get:(m:BootstrapData["financialMovements"][number])=>movementLabels[financialMovementKind(m.type)]??m.type',
);
replaceExact(
  "app/conta-app.tsx",
  'type:movementLabels[movement.type]??movement.type',
  'type:movementLabels[financialMovementKind(movement.type)]??movement.type',
);
replaceExact(
  "app/conta-app.tsx",
  ' const remaining=Math.max(0,record.dueTotal),reference=displayDocumentNumber(record),date=formatDateTime(record.occurredAt),payment=paymentName(record,data);\n const common:Array<[string,string]>=[[tr("المرجع"),reference],[tr("التاريخ"),date]];\n if(record.kind==="sale"||record.kind==="purchase")return{title:record.kind==="sale"?tr("فاتورة بيع"):tr("فاتورة شراء"),meta:[...common,[record.kind==="sale"?tr("العميل"):tr("المورد"),record.partyName||(record.kind==="sale"?tr("بيع مباشر"):tr("شراء مباشر"))],[record.kind==="sale"?tr("المخزن"):tr("المخزن المستلم"),record.warehouseName||"—"],',
  ' const remaining=Math.max(0,record.dueTotal),reference=displayDocumentNumber(record),date=formatDateTime(record.occurredAt),payment=paymentName(record,data),partyName=record.partyName?.trim()||(record.partyId?data.parties.find(p=>p.id===record.partyId)?.name:null)||(record.kind==="sale"?tr("بيع مباشر"):tr("شراء مباشر")),warehouseName=record.warehouseName?.trim()||(record.warehouseId?data.warehouses.find(w=>w.id===record.warehouseId)?.name:null)||"—";\n const common:Array<[string,string]>=[[tr("المرجع"),reference],[tr("التاريخ"),date]];\n if(record.kind==="sale"||record.kind==="purchase")return{title:record.kind==="sale"?tr("فاتورة بيع"):tr("فاتورة شراء"),meta:[...common,[record.kind==="sale"?tr("العميل"):tr("المورد"),partyName],[record.kind==="sale"?tr("المخزن"):tr("المخزن المستلم"),warehouseName],',
);

replaceExact(
  "legacy/dataacc-sqlite.ts",
  '  const storeRows=read("storesTB"), warehouseMap=new Map<string,string>(); for(const r of storeRows){const old=text(get(r,"id")),lk=key("storesTB",old),name=text(get(r,"title","name","StoreName"))||`مخزن ${old}`;warehouseMap.set(old,whByLegacy.get(lk)??whByName.get(normalize(name))??id("wh",lk));}',
  '  const storeRows=read("storesTB"), warehouseMap=new Map<string,string>(),warehouseNameMap=new Map<string,string>(); for(const r of storeRows){const old=text(get(r,"id")),lk=key("storesTB",old),name=text(get(r,"title","name","StoreName"))||`مخزن ${old}`;warehouseMap.set(old,whByLegacy.get(lk)??whByName.get(normalize(name))??id("wh",lk));warehouseNameMap.set(old,name);}',
);
replaceExact(
  "legacy/dataacc-sqlite.ts",
  '  const parties=await db.collection("parties").find({}).toArray(); result.mongoRoundTrips++; const partyMap=new Map<string,string>();',
  '  const parties=await db.collection("parties").find({}).toArray(); result.mongoRoundTrips++; const partyMap=new Map<string,string>(),partyNameMap=new Map<string,string>();',
);
replaceExact(
  "legacy/dataacc-sqlite.ts",
  'partyMap.set(`${role}:${old}`,found?String(found.id):id("party",lk));}',
  'partyMap.set(`${role}:${old}`,found?String(found.id):id("party",lk));partyNameMap.set(`${role}:${old}`,name);}',
);
replaceExact(
  "legacy/dataacc-sqlite.ts",
  'partyId:partyMap.get(`${partyRole}:${text(get(h,kind==="sale"?"CustomerFK":"SuppFK"))}`)??null,partyName:null,warehouseId:warehouseMap.get(text(get(h,"StoreFK")))??warehouseMap.values().next().value??null,warehouseName:null,',
  'partyId:partyMap.get(`${partyRole}:${text(get(h,kind==="sale"?"CustomerFK":"SuppFK"))}`)??null,partyName:partyNameMap.get(`${partyRole}:${text(get(h,kind==="sale"?"CustomerFK":"SuppFK"))}`)??null,warehouseId:warehouseMap.get(text(get(h,"StoreFK")))??warehouseMap.values().next().value??null,warehouseName:warehouseNameMap.get(text(get(h,"StoreFK")))??null,',
);

console.log("Release hardening patch applied.");
