import { requireCapability } from "../../../../lib/auth.ts";
const message="غير متاح في النسخة الحالية ذات المستخدم الواحد";
export async function GET(request:Request){const denied=await requireCapability(request,"settings.users.manage");if(denied)return denied;return Response.json({users:[],disabled:true,message},{headers:{"cache-control":"no-store"}})}
export async function POST(request:Request){const denied=await requireCapability(request,"settings.users.manage");if(denied)return denied;return Response.json({error:message},{status:403})}
