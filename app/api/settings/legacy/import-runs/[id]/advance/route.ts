import { requireCapability, validSameOrigin } from "../../../../../../../lib/auth.ts";
import { getMongo } from "../../../../../../../lib/mongodb.ts";
import { advanceLegacyImportRun } from "../../../../../../../legacy/import-run.ts";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const denied=await requireCapability(request,"settings.legacy.import");if(denied)return denied;
 if(!validSameOrigin(request)){
  const url=new URL(request.url);
  console.warn(JSON.stringify({event:"legacy_import_origin_rejected",method:request.method,originPresent:request.headers.has("origin"),host:request.headers.get("host"),forwardedHost:request.headers.get("x-forwarded-host"),forwardedProto:request.headers.get("x-forwarded-proto"),pathname:url.pathname}));
  return Response.json({error:"طلب غير صالح"},{status:403});
 }
 try{return Response.json(await advanceLegacyImportRun(await getMongo(),(await params).id));}catch(error){const e=error as Error&{status?:number};return Response.json({error:e.message},{status:e.status??500});}
}
