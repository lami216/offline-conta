import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(path, from, to) {
  const raw = readFileSync(path, "utf8");
  const source = raw.replace(/\r\n/g, "\n");
  if (source.includes(from)) {
    writeFileSync(path, source.replace(from, to), "utf8");
    return;
  }
  if (source.includes(to)) return;
  throw new Error(`Expected source fragment not found in ${path}`);
}

replaceExact(
  "app/api/command/route.ts",
  '  if (type === "expense.post") { const title = text(body.title), amount = positive(body.amount, "المبلغ"), occurredAt = text(body.occurredAt); if (!title || !/^\\d{4}-\\d{2}-\\d{2}$/.test(occurredAt)) throw new CommandError("العنوان والتاريخ مطلوبان"); const method = text(body.paymentMethod); await paymentAccount(db, session, method); const doc = { ...await numberedDocument(db, session, "expense", "EXP"), occurredAt: new Date(`${occurredAt}T12:00:00Z`).toISOString(),',
  '  if (type === "expense.post") { const title = text(body.title), amount = positive(body.amount, "المبلغ"), date = text(body.occurredAt), parsedDate = new Date(`${date}T12:00:00Z`); if (!title || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0,10) !== date) throw new CommandError("العنوان والتاريخ غير صالحين"); const method = text(body.paymentMethod); await paymentAccount(db, session, method); const doc = { ...await numberedDocument(db, session, "expense", "EXP"), occurredAt: parsedDate.toISOString(),',
);
replaceExact(
  "app/api/command/route.ts",
  '    const documentId=text(body.documentId),title=text(body.title),amount=positive(body.amount,"المبلغ"),date=text(body.occurredAt),method=text(body.paymentMethod);\n    if(!title||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new CommandError("العنوان والتاريخ مطلوبان");',
  '    const documentId=text(body.documentId),title=text(body.title),amount=positive(body.amount,"المبلغ"),date=text(body.occurredAt),method=text(body.paymentMethod),parsedDate=new Date(`${date}T12:00:00Z`);\n    if(!title||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||Number.isNaN(parsedDate.valueOf())||parsedDate.toISOString().slice(0,10)!==date)throw new CommandError("العنوان والتاريخ غير صالحين");',
);
replaceExact(
  "app/api/command/route.ts",
  '    const occurredAt=new Date(`${date}T12:00:00Z`).toISOString(),lineId=(original.lines as Line[]|undefined)?.[0]?.id??id("line");',
  '    const occurredAt=parsedDate.toISOString(),lineId=(original.lines as Line[]|undefined)?.[0]?.id??id("line");',
);

console.log("Expense date validation hardening applied.");
