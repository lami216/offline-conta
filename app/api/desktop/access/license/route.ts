import {createHash} from "node:crypto";
import {desktopAccessAllowed} from "../../../../../lib/desktop-access";
import {getDeviceId,getLicenseStatus,readInstalledLicense,installLicenseIdempotently,MAX_LICENSE_BYTES,LicenseError} from "../../../../../lib/license";
export const runtime="nodejs";
export async function GET(request:Request){
 if(!desktopAccessAllowed(request))return Response.json({error:"غير مصرح"},{status:403});
 try{const content=await readInstalledLicense();return Response.json({deviceId:await getDeviceId(),status:await getLicenseStatus(),licenseDocument:content,installedDocumentHash:content?createHash("sha256").update(content).digest("hex"):null},{headers:{"cache-control":"no-store"}});}catch{return Response.json({error:"تعذر قراءة ترخيص الجهاز"},{status:503});}
}
export async function POST(request:Request){
 if(!desktopAccessAllowed(request))return Response.json({error:"غير مصرح"},{status:403});
 if(Number(request.headers.get("content-length")||0)>MAX_LICENSE_BYTES)return Response.json({error:"ملف الترخيص كبير"},{status:413});
 try{const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.byteLength>MAX_LICENSE_BYTES)return Response.json({error:"ملف الترخيص كبير"},{status:413});return Response.json(await installLicenseIdempotently(bytes),{headers:{"cache-control":"no-store"}});}catch(error){return Response.json({error:error instanceof Error?error.message:"تعذر التفعيل",code:error instanceof LicenseError?error.code:"ACTIVATION_FAILED"},{status:error instanceof LicenseError?error.status:503});}
}
