import { requireCapability } from "../../../../lib/auth.ts";
import { getMongo } from "../../../../lib/mongodb.ts";
import { listImportRuns } from "../../../../legacy/import-run.ts";
export async function GET(request:Request){const denied=await requireCapability(request,"settings.legacy.import");if(denied)return denied;return Response.json({runs:await listImportRuns(await getMongo())},{headers:{"cache-control":"no-store"}})}
