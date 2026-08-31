import { requireCapability, validSameOrigin } from "../../../../lib/auth";
import { getMongo } from "../../../../lib/mongodb";
import { saveInvoiceBranding } from "../../../../lib/invoice-branding";
export async function PUT(request:Request){const denied=await requireCapability(request,"settings.branding.manage");if(denied)return denied;if(!validSameOrigin(request))return Response.json({error:"طلب غير صالح"},{status:403});try{return Response.json({branding:await saveInvoiceBranding(await getMongo(),await request.json())})}catch(error){return Response.json({error:error instanceof Error?error.message:"تعذر حفظ الهوية"},{status:400})}}
