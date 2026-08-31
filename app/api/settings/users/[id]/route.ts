import { requireCapability } from "../../../../../lib/auth.ts";
const message="غير متاح في النسخة الحالية ذات المستخدم الواحد";
export async function PATCH(request:Request){const denied=await requireCapability(request,"settings.users.manage");if(denied)return denied;return Response.json({error:message},{status:403})}
export const DELETE=PATCH;
