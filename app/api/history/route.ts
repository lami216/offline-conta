import { requireValidLicense } from "../../../lib/license.ts";
import { getDatabase } from "../../../lib/sqlite.ts";
import { getPrincipalFromRequest, hasCapability } from "../../../lib/auth.ts";

const bounded = (value:string|null, fallback:number, max:number) => {
  const parsed=Number(value);return Number.isInteger(parsed)&&parsed>0?Math.min(parsed,max):fallback;
};

/** Full historical data is fetched on demand; bootstrap remains deliberately recent and bounded. */
export async function GET(request:Request){
 const licenseDenied=await requireValidLicense();if(licenseDenied)return licenseDenied;
 const principal=await getPrincipalFromRequest(request);if(!principal)return Response.json({error:"غير مصرح"},{status:401});
 const url=new URL(request.url),resource=url.searchParams.get("resource")??"documents",page=bounded(url.searchParams.get("page"),1,1_000_000),pageSize=bounded(url.searchParams.get("pageSize"),100,250),kind=url.searchParams.get("kind"),from=url.searchParams.get("from"),to=url.searchParams.get("to");
 const allowed=resource==="documents"?(hasCapability(principal,"records.view")||hasCapability(principal,"pos.view")||hasCapability(principal,"purchases.view")||hasCapability(principal,"expenses.view")):resource==="stockMovements"?hasCapability(principal,"warehouses.inventory.view"):(resource==="financialMovements"&&hasCapability(principal,"banks.movements.view"));
 if(!allowed||!["documents","stockMovements","financialMovements"].includes(resource))return Response.json({error:"غير مصرح"},{status:403});
 const query:Record<string,unknown>={};if(kind)query.kind=kind;if(from||to)query.occurredAt={...(from?{$gte:from}:{}),...(to?{$lte:to}: {})};
 const db=await getDatabase(),collection=db.collection(resource),total=await collection.countDocuments(query),rows=await collection.find(query).sort({occurredAt:-1,id:-1}).skip((page-1)*pageSize).limit(pageSize).toArray();
 return Response.json({resource,page,pageSize,total,totalPages:Math.ceil(total/pageSize),rows:rows.map(({_id,...row})=>({id:row.id??String(_id),...row}))});
}
