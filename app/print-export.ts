function cleanExportText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

export function exportRowsFromTarget(target: HTMLElement) {
  const rows: string[][] = [];
  const push = (values: string[]) => {
    const cleaned = values.map(cleanExportText);
    if (cleaned.some(Boolean)) rows.push(cleaned);
  };
  const title = target.querySelector<HTMLElement>(".workspace-print-header h1,.print-report-title h2,.official-record-header h1");
  const brand = target.querySelector<HTMLElement>(".workspace-print-header strong,.official-record-name-line strong");
  if (brand) push([brand.innerText || brand.textContent || ""]);
  if (title) push([title.innerText || title.textContent || ""]);
  for (const node of target.querySelectorAll<HTMLElement>(".workspace-print-meta span,.official-record-meta span")) {
    const label = node.querySelector<HTMLElement>("small");
    const value = node.querySelector<HTMLElement>("b,strong");
    push([label?.innerText || label?.textContent || "", value?.innerText || value?.textContent || ""]);
  }
  if (rows.length) rows.push([]);
  for (const table of target.querySelectorAll<HTMLTableElement>("table")) {
    const section = table.closest<HTMLElement>(".workspace-print-section,fieldset");
    const heading = section?.querySelector<HTMLElement>(":scope > h2,:scope > legend");
    if (heading) push([heading.innerText || heading.textContent || ""]);
    for (const row of table.querySelectorAll<HTMLTableRowElement>("tr")) {
      push([...row.querySelectorAll<HTMLElement>("th,td")].map(cell => cell.innerText || cell.textContent || ""));
    }
    rows.push([]);
  }
  for (const node of target.querySelectorAll<HTMLElement>(".workspace-print-kpis>span,.official-record-totals>span,.report-kpi")) {
    const label = node.querySelector<HTMLElement>("small");
    const value = node.querySelector<HTMLElement>("b,strong,.report-kpi-value");
    push([label?.innerText || label?.textContent || "", value?.innerText || value?.textContent || ""]);
  }
  while (rows.length && rows.at(-1)?.every(value => !value)) rows.pop();
  return rows.length ? rows : [[cleanExportText(target.innerText || target.textContent || "")]];
}

const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function xlsxCell(value: string) {
  const trimmed = value.trim();
  const money = /(?:^|\s)-?[\d\s.,]+(?:\s*MRU)?$/i.test(trimmed) && /MRU/i.test(trimmed);
  const compact = trimmed.replace(/\s+/g, "").replace(/MRU/gi, "").replace(",", ".");
  if ((money || (/^-?\d+(?:\.\d+)?$/.test(compact) && compact.replace(/[-.]/g, "").length < 10)) && Number.isFinite(Number(compact))) {
    return "<c><v>" + Number(compact) + "</v></c>";
  }
  return "<c t=\"inlineStr\"><is><t xml:space=\"preserve\">" + xmlEscape(value) + "</t></is></c>";
}

const u16 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255]);
const u32 = (value: number) => new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      crcTable[i] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concatBytes([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    locals.push(local);
    centrals.push(concatBytes([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length;
  }
  const central = concatBytes(centrals);
  const end = concatBytes([u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0)]);
  return concatBytes([...locals, central, end]);
}

export function buildXlsx(rows: string[][]) {
  const maxColumns = Math.max(1, ...rows.map(row => row.length));
  const sheetRows = rows.map((row, index) => "<row r=\"" + (index + 1) + "\">" + row.map(xlsxCell).join("") + "</row>").join("");
  const sheet = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView workbookViewId=\"0\" rightToLeft=\"1\"/></sheetViews><cols><col min=\"1\" max=\"" + maxColumns + "\" width=\"18\" customWidth=\"1\"/></cols><sheetData>" + sheetRows + "</sheetData></worksheet>";
  const workbook = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"البيانات\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
  const rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>";
  const rootRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>";
  const contentTypes = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>";
  return zipStored([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: rootRels },
    { name: "xl/workbook.xml", content: workbook },
    { name: "xl/_rels/workbook.xml.rels", content: rels },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
  ]);
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size));
  return btoa(binary);
}

export function downloadXlsx(bytes: Uint8Array, filename: string) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
