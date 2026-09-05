from pathlib import Path

path = Path('app/conta-app.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    'import { translateApiError } from "./i18n/api-errors";\n',
    'import { translateApiError } from "./i18n/api-errors";\nimport { DEFAULT_PRINT_SETTINGS, PRINT_PROFILES, desktopPrintingAvailable, listPrinters, loadPrintSettings, printPreparedDocument, savePrintSettings, type PrintProfile, type PrintSettings, type PrinterInfo } from "./printing";\n',
    'printing import',
)

replace_once(
'''  useEffect(() => {\n    if (!autoPrintId || !data.documents.some(document => document.id === autoPrintId)) return;\n    const root = window.document.documentElement, timer = window.setTimeout(() => {\n      root.classList.add("print-document-mode"); window.print(); root.classList.remove("print-document-mode"); setAutoPrintId(null);\n    }, 50);\n    return () => window.clearTimeout(timer);\n  }, [autoPrintId, data.documents]);''',
'''  useEffect(() => {\n    if (!autoPrintId || !data.documents.some(document => document.id === autoPrintId)) return;\n    let cancelled=false;\n    const timer=window.setTimeout(()=>{void (async()=>{\n      try { await printPreparedDocument(await loadPrintSettings(), true); }\n      catch { if(!cancelled)setNotice(locale==="ar"?"تم حفظ الفاتورة، لكن تعذرت طباعتها.":"La facture a été enregistrée, mais l’impression a échoué."); }\n      finally { if(!cancelled)setAutoPrintId(null); }\n    })()},80);\n    return()=>{cancelled=true;window.clearTimeout(timer)};\n  }, [autoPrintId, data.documents, locale]);''',
    'auto print lifecycle',
)

panel = r'''
function PrintSettingsPanel({branding}:{branding:InvoiceBrandingSettings}) {
  const {locale}=useI18n();
  const copy=locale==="ar"?{
    title:"إعدادات الطباعة",printer:"الطابعة الافتراضية",windows:"طابعة Windows الافتراضية",format:"تنسيق الفاتورة",
    a4:"A4",thermal80:"حرارية 80 مم",thermal58:"حرارية 58 مم",save:"حفظ إعدادات الطباعة",saving:"جاري الحفظ…",
    test:"طباعة تجريبية",testing:"جاري فتح الطباعة…",saved:"تم حفظ إعدادات الطباعة",loadError:"تعذر تحميل إعدادات الطباعة",
    printError:"تعذرت الطباعة التجريبية",missing:"الطابعة المحفوظة غير متاحة حاليًا",desktopOnly:"اختيار الطابعة وحفظها متاحان في تطبيق سطح المكتب.",
    testInvoice:"فاتورة تجريبية",product:"المنتج",qty:"الكمية",price:"السعر",total:"الإجمالي",payment:"طريقة الدفع",cash:"نقدي",direct:"بيع مباشر"
  }:{
    title:"Paramètres d’impression",printer:"Imprimante par défaut",windows:"Imprimante Windows par défaut",format:"Format de facture",
    a4:"A4",thermal80:"Thermique 80 mm",thermal58:"Thermique 58 mm",save:"Enregistrer l’impression",saving:"Enregistrement…",
    test:"Impression test",testing:"Ouverture de l’impression…",saved:"Paramètres d’impression enregistrés",loadError:"Impossible de charger les paramètres d’impression",
    printError:"Échec de l’impression test",missing:"L’imprimante enregistrée n’est pas disponible actuellement",desktopOnly:"Le choix et l’enregistrement de l’imprimante sont disponibles dans l’application de bureau.",
    testInvoice:"Facture test",product:"Produit",qty:"Qté",price:"Prix",total:"Total",payment:"Paiement",cash:"Espèces",direct:"Vente directe"
  };
  const [printers,setPrinters]=useState<PrinterInfo[]>([]),[settings,setSettings]=useState<PrintSettings>(DEFAULT_PRINT_SETTINGS),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[testMounted,setTestMounted]=useState(false);
  useEffect(()=>{let active=true;void Promise.all([loadPrintSettings(),listPrinters()]).then(([saved,found])=>{if(!active)return;setSettings(saved);setPrinters(found.slice().sort((a,b)=>Number(Boolean(b.isDefault))-Number(Boolean(a.isDefault))||a.displayName.localeCompare(b.displayName)))}).catch(()=>{if(active)setMessage(copy.loadError)});return()=>{active=false}},[copy.loadError]);
  const defaultPrinter=printers.find(printer=>printer.isDefault),missing=!!settings.deviceName&&!printers.some(printer=>printer.name===settings.deviceName),desktop=desktopPrintingAvailable();
  const names:Record<PrintProfile,string>={a4:copy.a4,thermal80:copy.thermal80,thermal58:copy.thermal58};
  const sample:OfficialPresentation={title:copy.testInvoice,meta:[["#","000"],["05/09/2026","12:00"],[locale==="ar"?"العميل":"Client",copy.direct],[copy.payment,copy.cash]],columns:["#",copy.product,copy.qty,copy.price,copy.total],rows:[["1",locale==="ar"?"منتج تجريبي":"Produit test","2",money(500),money(1000)],["2",locale==="ar"?"منتج آخر":"Autre produit","1",money(750),money(750)]],totals:[[copy.total,money(1750)]],tone:"neutral"};
  const save=async()=>{if(!desktop)return;setBusy("save");setMessage("");try{const saved=await savePrintSettings(settings);setSettings(saved);setMessage(copy.saved)}catch{setMessage(copy.loadError)}finally{setBusy("")}};
  const test=async()=>{setBusy("test");setMessage("");setTestMounted(true);await new Promise<void>(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>resolve())));try{await printPreparedDocument(settings,false)}catch{setMessage(copy.printError)}finally{setTestMounted(false);setBusy("")}};
  return <FramedSection title={copy.title} className="print-settings-panel">
    <div className="print-settings-row"><label>{copy.printer}<select disabled={!desktop||busy!==""} value={settings.deviceName??""} onChange={event=>setSettings(current=>({...current,deviceName:event.target.value||null}))}><option value="">{copy.windows}{defaultPrinter?` — ${defaultPrinter.displayName}`:""}</option>{missing&&<option value={settings.deviceName??""}>{settings.deviceName}</option>}{printers.map(printer=><option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault?" ✓":""}</option>)}</select></label><span className={`print-device-state${missing?" warning":""}`}>{!desktop?copy.desktopOnly:missing?copy.missing:""}</span></div>
    <strong>{copy.format}</strong>
    <div className="print-profile-grid">{PRINT_PROFILES.map(profile=><button type="button" key={profile} className="print-profile-card" aria-pressed={settings.profile===profile} onClick={()=>setSettings(current=>({...current,profile}))}><div className={`print-profile-preview profile-${profile}`}><OfficialRecordSheet presentation={sample} branding={branding}/></div><strong>{names[profile]}</strong></button>)}</div>
    <div className="print-settings-actions"><button type="button" className="primary" disabled={!desktop||busy!==""} onClick={()=>void save()}>{busy==="save"?copy.saving:copy.save}</button><button type="button" className="soft" disabled={busy!==""} onClick={()=>void test()}><Printer/>{busy==="test"?copy.testing:copy.test}</button>{message&&<span className={`print-settings-message ${message===copy.saved?"success":"error"}`}>{message}</span>}</div>
    {testMounted&&createPortal(<div className="document-print-portal"><OfficialRecordSheet presentation={sample} branding={branding}/></div>,document.body)}
  </FramedSection>;
}
'''

replace_once(
    '    <FramedSection title={tr("معلومات المستند")} className="document-info-settings"><label>{tr("ملاحظة التذييل")}<textarea maxLength={160} disabled={!canBrand} value={branding.footerNote} onChange={e=>setBranding({...branding,footerNote:e.target.value})}/></label></FramedSection>\n    {canBrand&&<button className="primary settings-save"',
    '    <FramedSection title={tr("معلومات المستند")} className="document-info-settings"><label>{tr("ملاحظة التذييل")}<textarea maxLength={160} disabled={!canBrand} value={branding.footerNote} onChange={e=>setBranding({...branding,footerNote:e.target.value})}/></label></FramedSection>\n    <PrintSettingsPanel branding={branding}/>\n    {canBrand&&<button className="primary settings-save"',
    'general settings print panel placement',
)

# Keep the UsersPermissions -> GeneralSettings structural boundary intact for the
# existing regression tests: the printer panel is a sibling declared after the
# GeneralSettings implementation and before DataSettings.
replace_once('function DataSettings', panel + '\nfunction DataSettings', 'print settings panel declaration')

replace_once(
    'const print=()=>{const root=document.documentElement,cleanup=()=>root.classList.remove("print-document-mode");root.classList.add("print-document-mode");window.addEventListener("afterprint",cleanup,{once:true});window.print();window.setTimeout(cleanup,1500)};',
    'const {locale}=useI18n();const print=async()=>{try{await printPreparedDocument(await loadPrintSettings(),false)}catch{showTransientNotice(locale==="ar"?"تعذرت الطباعة.":"Échec de l’impression.")}};',
    'financial print lifecycle',
)
replace_once(
    ' function printDocument(){const root=window.document.documentElement,cleanup=()=>root.classList.remove("print-document-mode");root.classList.add("print-document-mode");window.addEventListener("afterprint",cleanup,{once:true});window.print();window.setTimeout(cleanup,1500)}',
    ' const {locale}=useI18n();\n function printDocument(){void (async()=>{try{await printPreparedDocument(await loadPrintSettings(),false)}catch{showTransientNotice(locale==="ar"?"تعذرت الطباعة.":"Échec de l’impression.")}})()}',
    'document print lifecycle',
)
replace_once('<td key={j}>{v}</td>', '<td key={j} data-label={presentation.columns?.[j]??""}>{v}</td>', 'thermal table labels')

path.write_text(text, encoding='utf-8')

visual_path = Path('tests/visual-consistency.test.mjs')
visual = visual_path.read_text(encoding='utf-8')
old_print_assert = '  assert.match(app, /root\\.classList\\.add\\("print-document-mode"\\); window\\.print\\(\\)/);\n'
new_print_assert = '  assert.match(app, /printPreparedDocument\\(await loadPrintSettings\\(\\), true\\)/);\n'
if visual.count(old_print_assert) != 1:
    raise SystemExit(f'visual print lifecycle assertion: expected exactly one match, found {visual.count(old_print_assert)}')
visual_path.write_text(visual.replace(old_print_assert, new_print_assert, 1), encoding='utf-8')

Path('tests/printing.test.mjs').write_text(r'''import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),printing=readFileSync(new URL("../app/printing.ts",import.meta.url),"utf8"),css=readFileSync(new URL("../app/printing.css",import.meta.url),"utf8"),main=readFileSync(new URL("../desktop/main.cjs",import.meta.url),"utf8"),preload=readFileSync(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
test("printing supports one invoice source with three profiles",()=>{for(const profile of ["a4","thermal80","thermal58"])assert.match(printing,new RegExp(`\\"${profile}\\"`));assert.match(app,/function OfficialRecordSheet/);assert.match(app,/data-label=\{presentation\.columns/);assert.match(css,/data-print-profile="thermal80"/);assert.match(css,/data-print-profile="thermal58"/);assert.match(css,/data-print-profile="a4"/)});
test("desktop printing bridge is narrow and packaged",()=>{for(const channel of ["alkarna:printing:list","alkarna:printing:get-settings","alkarna:printing:set-settings","alkarna:printing:print"]){assert.ok(main.includes(channel));assert.ok(preload.includes(channel))}assert.match(main,/getPrintersAsync/);assert.match(main,/event\.sender\.print/);assert.match(main,/silent,printBackground:true/);assert.equal(pkg.build.files.includes("desktop/preload.cjs"),true);assert.doesNotMatch(preload,/require\(['\"](?:node:fs|child_process|node:child_process)/)});
test("automatic printing no longer removes print mode immediately",()=>{assert.match(app,/printPreparedDocument\(await loadPrintSettings\(\), true\)/);assert.doesNotMatch(app,/window\.print\(\); root\.classList\.remove\("print-document-mode"\)/);assert.match(printing,/document\.fonts\?\.ready/);assert.match(printing,/afterprint/)});
test("general settings exposes printer, three previews and test print",()=>{assert.match(app,/function PrintSettingsPanel/);assert.match(app,/PRINT_PROFILES\.map/);assert.match(app,/PrintSettingsPanel branding=\{branding\}/);assert.match(app,/print-profile-preview/);assert.match(app,/printPreparedDocument\(settings,false\)/)});
test("printer choice is device local and defaults to A4 Windows printer",()=>{assert.match(main,/printing-settings\.json/);assert.match(main,/DEFAULT_PRINT_SETTINGS=\{deviceName:null,profile:'a4'\}/);assert.match(printing,/DEFAULT_PRINT_SETTINGS: PrintSettings = \{ deviceName: null, profile: "a4" \}/)});
''',encoding='utf-8')
