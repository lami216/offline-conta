import { createNativeBackup, stringifyBackup } from "../../../../lib/backup.ts";
import { requireCapability } from "../../../../lib/auth.ts";
import { getMongo } from "../../../../lib/mongodb.ts";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = await requireCapability(request, "settings.backup.manage"); if (denied) return denied;
  const backup = await createNativeBackup(await getMongo());
  const filename = `conta-backup-${backup.createdAt.slice(0, 10)}.conta.json`;
  return new Response(stringifyBackup(backup), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
}
