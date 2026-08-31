import { BACKUP_COLLECTIONS } from "../../../../../lib/backup.ts";
import { requireCapability } from "../../../../../lib/auth.ts";
import { getMongo } from "../../../../../lib/mongodb.ts";
export async function GET(request: Request) { const denied = await requireCapability(request, "settings.backup.manage"); if (denied) return denied; const db = await getMongo(); const values = await Promise.all(BACKUP_COLLECTIONS.map(async name => [name, await db.collection(name).countDocuments()])); return Response.json({ counts: Object.fromEntries(values) }, { headers: { "cache-control": "no-store" } }); }
