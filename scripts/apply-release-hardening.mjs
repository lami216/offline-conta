import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(path, from, to) {
  const raw = readFileSync(path, "utf8");
  const source = raw.replace(/\r\n/g, "\n");
  if (source.includes(from)) {
    writeFileSync(path, source.replace(from, to), "utf8");
    return true;
  }
  if (to && source.includes(to)) {
    if (raw !== source) writeFileSync(path, source, "utf8");
    return false;
  }
  if (!to) {
    if (raw !== source) writeFileSync(path, source, "utf8");
    return false;
  }
  throw new Error(`Expected source fragment not found in ${path}`);
}

replaceExact(
  "lib/backup.ts",
  'export const MAX_BACKUP_ITEMS = 500_000;\nexport const MAX_BACKUP_BYTES = 50 * 1024 * 1024;\n',
  '// Backups are local, user-selected files. Do not impose an artificial size or record-count cap;\n// validation below still enforces the accounting and reference invariants before restore.\n',
);
replaceExact(
  "lib/backup.ts",
  '  if (Buffer.byteLength(input) > MAX_BACKUP_BYTES) throw new Error("ملف النسخة أكبر من الحد المسموح");\n',
  '',
);
replaceExact(
  "lib/backup.ts",
  '  const total = BACKUP_COLLECTIONS.reduce((n, k) => n + b.collections![k].length, 0); if (total > MAX_BACKUP_ITEMS) throw new Error("عدد السجلات أكبر من الحد المسموح");\n',
  '',
);

replaceExact(
  "app/api/command/route.ts",
  '    if (original.legacyKey) throw new CommandError("الفواتير المرحلة متاحة للعرض فقط", 409);\n    const originalTotal = Number(original.total ?? 0), originalPaid = Number(original.paidTotal ?? original.cashAmount ?? 0);\n    if (Number.isFinite(originalTotal) && Number.isFinite(originalPaid) && originalPaid > 0 && originalPaid < originalTotal) throw new CommandError("هذه فاتورة قديمة تحتوي دفعًا جزئيًا داخل الفاتورة، لذلك هي متاحة للعرض فقط حفاظًا على الرصيد التاريخي.", 409);\n    if (isSale && await db.collection("documents").findOne({ kind: "return", status: "posted", parentDocumentId: documentId }, { session })) throw new CommandError("لا يمكن تعديل هذه الفاتورة القديمة لوجود حركة تاريخية مرتبطة بها.", 409);',
  '    if (original.legacyKey) throw new CommandError("الفواتير المرحلة متاحة للعرض فقط", 409);\n    if (isSale && await db.collection("documents").findOne({ kind: "return", status: "posted", parentDocumentId: documentId }, { session })) throw new CommandError("لا يمكن تعديل هذه الفاتورة القديمة لوجود حركة تاريخية مرتبطة بها.", 409);',
);
replaceExact(
  "app/api/command/route.ts",
  '    const partyId = text(body.partyId), party = await db.collection("parties").findOne({ id: partyId }, { session }); if (!party) throw new CommandError("الطرف غير موجود", 404); const requested = positive(body.amount, "المبلغ"); let receivable = Number(party.receivable), payable = Number(party.payable); const side = text(body.side); if (type === "offset.post") {',
  '    const partyId = text(body.partyId), party = await db.collection("parties").findOne({ id: partyId }, { session }); if (!party) throw new CommandError("الطرف غير موجود", 404); const requested = positive(body.amount, "المبلغ"); let receivable = Number(party.receivable), payable = Number(party.payable); const side = text(body.side); if (type !== "offset.post" && side !== "receivable" && side !== "payable") throw new CommandError("جهة الرصيد غير صالحة"); if (type === "offset.post") {',
);

replaceExact(
  "package.json",
  '    "better-sqlite3": "^11.10.0",',
  '    "better-sqlite3": "13.0.3",',
);
replaceExact(
  "package.json",
  '    "@electron/rebuild": "^3.7.0",\n',
  '',
);
replaceExact(
  "package.json",
  '    "electron": "^37.2.6",',
  '    "electron": "44.3.0",',
);

console.log("Release hardening patch applied.");
