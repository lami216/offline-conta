import {desktopAccessAllowed} from "../../../../../lib/desktop-access.ts";
import {getLicenseStatus,readInstalledLicense} from "../../../../../lib/license.ts";
import {getDatabase} from "../../../../../lib/sqlite.ts";
import {prepareRemoteLocalAccount} from "../../../../../lib/desktop-access-local-account.ts";
export const runtime="nodejs";
export async function POST(request:Request){
 if(!desktopAccessAllowed(request))return Response.json({error:"غير مصرح"},{status:403});
 if(Number(request.headers.get("content-length")||0)>4096)return Response.json({error:"الطلب كبير"},{status:413});
 try{
  const bytes=await request.arrayBuffer();if(bytes.byteLength>4096)return Response.json({error:"الطلب كبير"},{status:413});
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||Object.keys(body).sort().join("|")!=="code|identifier|licenseDocumentHash"||typeof body.identifier!=="string"||typeof body.code!=="string"||typeof body.licenseDocumentHash!=="string")return Response.json({error:"طلب غير صالح"},{status:400});
  const result=await prepareRemoteLocalAccount(getDatabase(),body,await getLicenseStatus(),await readInstalledLicense());
  return Response.json(result,{headers:{"cache-control":"no-store"}});
 }catch{return Response.json({error:"تعذّر إكمال إعداد الحساب المحلي",code:"LOCAL_ACCOUNT_SETUP_FAILED"},{status:409});}
}
