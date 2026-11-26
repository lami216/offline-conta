import { requireValidLicense } from "../../../lib/license.ts";
import { getDatabase } from "../../../lib/sqlite.ts";
import { getPrincipalFromRequest, hasCapability, type Capability } from "../../../lib/auth.ts";
import { canReadDocument, canReadDocumentKind, resolveCurrentPartyName } from "../../../lib/document-read-model.ts";
import { resolvePartyType } from "../../domain.ts";
import { validateRequiredDateRange } from "../../date-range-validation.ts";
import { classifyStockMovementType, collapseLegacyStockEditMovements } from "../../stock-movement.ts";

import { ensureStockSettlementNumberingReady, displayStockMovementDocumentNumber } from "../../../lib/document-sequences.ts";

const bounded = (value:string|null, fallback:number, max:number) => {
  const parsed=Number(value);return Number.isInteger(parsed)&&parsed>0?Math.min(parsed,max):fallback;
};

const documentCapabilities: Capability[] = [
  "employees.view", "party.opening.manage", "records.view", "pos.view", "purchases.view", "expenses.view",
  "customers.view", "suppliers.view", "warehouses.transfer", "warehouses.adjust",
  "banks.view", "banks.movements.view",
];

/** Paginated audit history uses the same per-document authorization as bootstrap. */
export async function GET(request:Request){
 const licenseDenied=await requireValidLicense();if(licenseDenied)return licenseDenied;
 const principal=await getPrincipalFromRequest(request);if(!principal)return Response.json({error:"غير مصرح"},{status:401});
 const url=new URL(request.url),resource=url.searchParams.get("resource")??"documents",page=bounded(url.searchParams.get("page"),1,1_000_000),pageSize=bounded(url.searchParams.get("pageSize"),100,250),kind=url.searchParams.get("kind"),from=url.searchParams.get("from"),to=url.searchParams.get("to"),id=url.searchParams.get("id")?.trim()??"",search=url.searchParams.get("q")?.trim().toLocaleLowerCase()??"";
 if(!["documents","stockMovements","financialMovements"].includes(resource))return Response.json({error:"غير مصرح"},{status:403});
 const reportDocumentLookup=resource==="documents"&&Boolean(id)&&hasCapability(principal,"reports.view");
 const recordsAccess=hasCapability(principal,"records.view");
 const allowed=resource==="documents"?(documentCapabilities.some(capability=>hasCapability(principal,capability))||reportDocumentLookup):resource==="stockMovements"?(recordsAccess||hasCapability(principal,"warehouses.inventory.view")):(recordsAccess||hasCapability(principal,"banks.movements.view"));
 if(!allowed)return Response.json({error:"غير مصرح"},{status:403});
 const coarseAccess={can:(capability:string)=>hasCapability(principal,capability as Capability)};
 if(resource==="documents"&&kind&&!reportDocumentLookup&&!canReadDocumentKind(kind,coarseAccess))return Response.json({error:"غير مصرح"},{status:403});
 const status=url.searchParams.get("status")?.trim()??"";
 if(resource==="documents"&&status&&!["all","posted","voided"].includes(status))return Response.json({error:"حالة المستند غير صالحة"},{status:400});
 const query:Record<string,unknown>={};
 if(resource==="documents"&&(status==="posted"||status==="voided"))query.status=status;
 if(id)query.id=id;
 if(kind)query[resource==="documents"?"kind":"type"]=kind;
 if(from||to){
   const start=from?.slice(0,10)??to!.slice(0,10),end=to?.slice(0,10)??from!.slice(0,10);
   if(validateRequiredDateRange(start,end))return Response.json({error:"الفترة غير صالحة"},{status:400});
   query.occurredAt={...(from?{$gte:`${start}T00:00:00.000Z`}:{}),...(to?{$lte:`${end}T23:59:59.999Z`}:{})};
 }
 const db=await getDatabase();await ensureStockSettlementNumberingReady(db);const collection=db.collection(resource);
 if(resource==="documents"){
   const [parties,candidates]=await Promise.all([
     db.collection("parties").find().toArray(),
     collection.find(query).sort({occurredAt:-1,id:-1}).toArray(),
   ]);
   const customerPartyIds=new Set(parties.filter(party=>resolvePartyType(party)==="customer").map(party=>String(party.id??party._id??"")));
   const supplierPartyIds=new Set(parties.filter(party=>resolvePartyType(party)==="supplier").map(party=>String(party.id??party._id??"")));
   const traderPartyIds=new Set(parties.filter(party=>resolvePartyType(party)==="trader").map(party=>String(party.id??party._id??"")));
   const currentPartyNames=new Map(parties.map(party=>[String(party.id??party._id??""),String(party.name??"")] as const));
   const access={...coarseAccess,customerPartyIds,supplierPartyIds,traderPartyIds};
   const authorized=candidates.filter(document=>reportDocumentLookup||canReadDocument(document,access)).filter(document=>document.kind!=="employee-opening"||hasCapability(principal,"employees.view")).map(document=>resolveCurrentPartyName(document,currentPartyNames));
   const visible=search?authorized.filter(document=>[document.number,document.sequence,document.settlementSequence,document.legacyBillCode,document.partyName,document.title,document.kind,document.status].map(value=>String(value??"")).join(" ").toLocaleLowerCase().includes(search)):authorized;
   const total=visible.length,rows=visible.slice((page-1)*pageSize,page*pageSize);
   return Response.json({resource,page,pageSize,total,totalPages:Math.ceil(total/pageSize),rows:rows.map(({_id,...row})=>({id:row.id??String(_id),...row}))});
 }
 if(resource==="stockMovements"){
   const candidates=await collection.find(query).sort({occurredAt:-1,id:-1}).toArray();
   const documentIds=[...new Set(candidates.map(row=>String(row.documentId??"")).filter(Boolean))];
   const documents=documentIds.length?await db.collection("documents").find({id:{$in:documentIds}}).toArray():[],documentMap=new Map(documents.map(document=>[String(document.id),document]));
   const presented=collapseLegacyStockEditMovements(candidates.map(({_id,...row})=>({id:row.id??String(_id),...row,documentReference:row.documentNumber,documentNumber:displayStockMovementDocumentNumber(row,documentMap.get(String(row.documentId))),type:classifyStockMovementType(row.type,documentMap.get(String(row.documentId)))})));
   const total=presented.length,rows=presented.slice((page-1)*pageSize,page*pageSize);
   return Response.json({resource,page,pageSize,total,totalPages:Math.ceil(total/pageSize),rows});
 }
 const total=await collection.countDocuments(query),rows=await collection.find(query).sort({occurredAt:-1,id:-1}).skip((page-1)*pageSize).limit(pageSize).toArray();
 return Response.json({resource,page,pageSize,total,totalPages:Math.ceil(total/pageSize),rows:rows.map(({_id,...row})=>({id:row.id??String(_id),...row}))});
}
