from pathlib import Path

# 1) Do not hide the invoice's own <header> when printing.
p = Path('app/globals.css')
s = p.read_text()
old = """@media print {
  .sidebar,
  header,
  .doc-actions,"""
new = """@media print {
  .sidebar,
  .page-bar,
  .doc-actions,"""
if old not in s:
    raise SystemExit('global print header selector not found')
p.write_text(s.replace(old, new, 1))

# 2) Preview fidelity, large preview lightbox, and hidden offscreen measurement target.
p = Path('app/printing.css')
s = p.read_text()
marker = '/* Preview fidelity v2 */'
if marker not in s:
    s += r'''

/* Preview fidelity v2 */
.print-profile-preview{position:relative;display:block;height:150px;min-width:0;overflow:hidden;border:1px solid #cbd1d7;background:#e8ebee;padding:0;cursor:zoom-in}
.print-profile-preview .official-record-sheet{position:absolute;inset:50% auto auto 50%;box-sizing:border-box;margin:0;box-shadow:none;transform-origin:center center!important;pointer-events:none}
.print-profile-preview.profile-a4 .official-record-sheet{width:760px!important;min-height:1075px;padding:26px 30px!important;transform:translate(-50%,-50%) scale(.105)!important}
.print-profile-preview.profile-thermal80 .official-record-sheet{width:302px!important;min-height:540px;padding:10px 11px!important;transform:translate(-50%,-50%) scale(.235)!important}
.print-profile-preview.profile-thermal58 .official-record-sheet{width:219px!important;min-height:520px;padding:8px!important;transform:translate(-50%,-50%) scale(.245)!important}
html.print-document-mode body>.document-print-portal{display:block!important;position:fixed!important;left:-100000px!important;top:0!important;width:max-content!important;visibility:hidden!important;pointer-events:none!important}
.print-preview-lightbox{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:28px;background:rgba(20,28,32,.78);cursor:default}
.print-preview-lightbox-close{position:fixed;top:18px;right:22px;z-index:1202;width:42px;height:42px;border:1px solid #cbd5dc;border-radius:50%;background:#fff;color:#1f2937;font:700 28px/1 Arial,sans-serif;box-shadow:0 8px 24px #0003;cursor:pointer}
.print-preview-lightbox .print-profile-preview{position:relative;display:block;height:auto;min-height:0;width:auto;overflow:visible;border:0;background:transparent;padding:24px;cursor:default}
.print-preview-lightbox .print-profile-preview .official-record-sheet{position:static!important;inset:auto!important;margin:0 auto!important;transform:none!important;transform-origin:initial!important;background:#fff;box-shadow:0 18px 55px #0004;pointer-events:none}
.print-preview-lightbox .print-profile-preview.profile-a4 .official-record-sheet{width:760px!important;min-height:1075px;padding:26px 30px!important}
.print-preview-lightbox .print-profile-preview.profile-thermal80 .official-record-sheet{width:302px!important;min-height:0;padding:10px 11px!important}
.print-preview-lightbox .print-profile-preview.profile-thermal58 .official-record-sheet{width:219px!important;min-height:0;padding:8px!important}
@media(max-width:900px){.print-preview-lightbox{padding:64px 12px 20px}.print-preview-lightbox .print-profile-preview{padding:0}.print-preview-lightbox .print-profile-preview.profile-a4{width:100%;overflow:auto}.print-preview-lightbox-close{top:12px;right:12px}}
@media(max-width:760px){.print-profile-preview{height:120px}.print-profile-preview.profile-a4 .official-record-sheet{transform:translate(-50%,-50%) scale(.083)!important}.print-profile-preview.profile-thermal80 .official-record-sheet{transform:translate(-50%,-50%) scale(.19)!important}.print-profile-preview.profile-thermal58 .official-record-sheet{transform:translate(-50%,-50%) scale(.205)!important}}
@media print{html.print-document-mode body>.document-print-portal{position:static!important;left:auto!important;top:auto!important;width:auto!important;visibility:visible!important}}
'''
p.write_text(s)

# 3) Renderer: open a real-size cloned preview and measure thermal content height.
p = Path('app/printing.ts')
s = p.read_text()
old_sig = '  print: (options: PrintSettings & { silent: boolean }) => Promise<PrintResult>;'
new_sig = '  print: (options: PrintSettings & { silent: boolean; paperHeightMicrons?: number }) => Promise<PrintResult>;'
if old_sig not in s:
    raise SystemExit('printing bridge signature not found')
s = s.replace(old_sig, new_sig, 1)
anchor = 'async function browserPrintFallback() {\n'
helper = r'''const MICRONS_PER_CSS_PIXEL = 25400 / 96;

function thermalPaperHeightMicrons(profile: PrintProfile) {
  if (profile === "a4") return undefined;
  const sheet = document.querySelector<HTMLElement>(".document-print-portal .official-record-sheet");
  if (!sheet) return undefined;
  const heightPx = Math.max(sheet.scrollHeight, sheet.getBoundingClientRect().height);
  if (!Number.isFinite(heightPx) || heightPx <= 0) return undefined;
  return Math.max(50000, Math.min(1000000, Math.ceil((heightPx + 24) * MICRONS_PER_CSS_PIXEL)));
}

let previewLightboxInstalled = false;
function installPrintProfilePreviewLightbox() {
  if (previewLightboxInstalled || typeof document === "undefined") return;
  previewLightboxInstalled = true;
  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const preview = target.closest<HTMLElement>(".print-profile-preview");
    if (!preview || preview.closest(".print-preview-lightbox")) return;
    if (!preview.querySelector(".official-record-sheet")) return;
    event.preventDefault();
    event.stopPropagation();
    const profile: PrintProfile = preview.classList.contains("profile-thermal80") ? "thermal80" : preview.classList.contains("profile-thermal58") ? "thermal58" : "a4";
    const overlay = document.createElement("div");
    overlay.className = `print-preview-lightbox profile-${profile}`;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Invoice print preview");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "print-preview-lightbox-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close preview");
    const clonedPreview = preview.cloneNode(true) as HTMLElement;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
      previousFocus?.focus();
    };
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cleanup();
    };
    close.addEventListener("click", cleanup);
    overlay.addEventListener("click", overlayEvent => { if (overlayEvent.target === overlay) cleanup(); });
    overlay.append(close, clonedPreview);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeyDown, true);
    close.focus();
  }, true);
}

if (typeof window !== "undefined") installPrintProfilePreviewLightbox();

'''
if helper.strip() not in s:
    if anchor not in s:
        raise SystemExit('browser fallback anchor not found')
    s = s.replace(anchor, helper + anchor, 1)
old_call = '      const result = await window.alkarnaPrinting.print({ ...normalized, silent });'
new_call = '      const paperHeightMicrons = thermalPaperHeightMicrons(normalized.profile);\n      const result = await window.alkarnaPrinting.print({ ...normalized, silent, ...(paperHeightMicrons ? { paperHeightMicrons } : {}) });'
if old_call not in s:
    raise SystemExit('desktop print call not found')
s = s.replace(old_call, new_call, 1)
p.write_text(s)

# 4) Electron: use a real 80/58 mm page when measurable, with safe driver fallback.
p = Path('desktop/main.cjs')
s = p.read_text()
old_const = "const DEFAULT_PRINT_SETTINGS={deviceName:null,profile:'a4'};"
new_const = "const DEFAULT_PRINT_SETTINGS={deviceName:null,profile:'a4'};\nconst THERMAL_PAPER_WIDTH_MICRONS={thermal80:80000,thermal58:58000};"
if old_const not in s:
    raise SystemExit('default print settings constant not found')
s = s.replace(old_const, new_const, 1)
old_handler = " ipcMain.handle('alkarna:printing:print',async(event,value)=>{const settings=normalizePrintSettings(value),silent=Boolean(value?.silent),printers=await event.sender.getPrintersAsync();if(settings.deviceName&&!printers.some(printer=>printer.name===settings.deviceName))return{ok:false,error:'printer-not-found'};const options={silent,printBackground:true,deviceName:settings.deviceName||undefined,usePrinterDefaultPageSize:settings.profile!=='a4',pageSize:settings.profile==='a4'?'A4':undefined};return new Promise(resolve=>event.sender.print(options,(success,failureReason)=>{stamp(`print profile=${settings.profile} printer=${settings.deviceName||'windows-default'} silent=${silent} success=${success}${failureReason?` reason=${failureReason}`:''}`);resolve(success?{ok:true}:{ok:false,error:failureReason||'print-failed'})}))});"
new_handler = r''' ipcMain.handle('alkarna:printing:print',async(event,value)=>{
  const settings=normalizePrintSettings(value),silent=Boolean(value?.silent),printers=await event.sender.getPrintersAsync();
  if(settings.deviceName&&!printers.some(printer=>printer.name===settings.deviceName))return{ok:false,error:'printer-not-found'};
  const thermalWidth=THERMAL_PAPER_WIDTH_MICRONS[settings.profile],rawHeight=Number(value?.paperHeightMicrons),thermalHeight=Number.isFinite(rawHeight)?Math.max(50000,Math.min(1000000,Math.round(rawHeight))):null;
  const baseOptions={silent,printBackground:true,deviceName:settings.deviceName||undefined};
  const options=settings.profile==='a4'?{...baseOptions,pageSize:'A4'}:thermalWidth&&thermalHeight?{...baseOptions,pageSize:{width:thermalWidth,height:thermalHeight},margins:{marginType:'none'},landscape:false}:{...baseOptions,usePrinterDefaultPageSize:true};
  const runPrint=printOptions=>new Promise(resolve=>event.sender.print(printOptions,(success,failureReason)=>{stamp(`print profile=${settings.profile} printer=${settings.deviceName||'windows-default'} silent=${silent} success=${success}${failureReason?` reason=${failureReason}`:''}`);resolve(success?{ok:true}:{ok:false,error:failureReason||'print-failed'})}));
  const result=await runPrint(options);
  if(result.ok||!thermalWidth||!thermalHeight||!/invalid printer settings/i.test(result.error))return result;
  stamp(`retry print profile=${settings.profile} with printer default page size`);
  return runPrint({...baseOptions,usePrinterDefaultPageSize:true});
 });'''
if old_handler not in s:
    raise SystemExit('printing IPC handler not found')
s = s.replace(old_handler, new_handler, 1)
p.write_text(s)

# 5) Focused regressions.
p = Path('tests/printing.test.mjs')
s = p.read_text()
old_decl = 'const app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),printing=readFileSync(new URL("../app/printing.ts",import.meta.url),"utf8"),css=readFileSync(new URL("../app/printing.css",import.meta.url),"utf8"),main=readFileSync(new URL("../desktop/main.cjs",import.meta.url),"utf8"),preload=readFileSync(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));'
new_decl = 'const app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),printing=readFileSync(new URL("../app/printing.ts",import.meta.url),"utf8"),css=readFileSync(new URL("../app/printing.css",import.meta.url),"utf8"),globals=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8"),main=readFileSync(new URL("../desktop/main.cjs",import.meta.url),"utf8"),preload=readFileSync(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));'
if old_decl not in s:
    raise SystemExit('printing test declaration not found')
s = s.replace(old_decl, new_decl, 1)
extra = r'''
test("invoice header remains printable",()=>{assert.doesNotMatch(globals,/@media print\s*\{\s*\.sidebar,\s*header,/);assert.match(globals,/@media print\s*\{\s*\.sidebar,\s*\.page-bar,/)});
test("print profile thumbnails show whole sheets and open a large preview",()=>{assert.match(css,/Preview fidelity v2/);assert.match(css,/print-preview-lightbox/);assert.match(css,/translate\(-50%,-50%\) scale/);assert.match(printing,/installPrintProfilePreviewLightbox/);assert.match(printing,/cloneNode\(true\)/)});
test("thermal jobs use real roll widths with measured height and safe fallback",()=>{assert.match(printing,/thermalPaperHeightMicrons/);assert.match(printing,/paperHeightMicrons/);assert.match(main,/thermal80:80000/);assert.match(main,/thermal58:58000/);assert.match(main,/pageSize:\{width:thermalWidth,height:thermalHeight\}/);assert.match(main,/retry print profile=/)});
'''
if 'invoice header remains printable' not in s:
    s += extra
p.write_text(s)
