from pathlib import Path
import re


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Branding shape: keep the existing appSettings record and add a backward-compatible logo field.
replace_once(
    "app/domain.ts",
    'export type InvoiceBrandingSettings = {\n  storeName: string;\n  storePhone: string;',
    'export type InvoiceBrandingSettings = {\n  storeName: string;\n  storeLogoDataUrl: string;\n  storePhone: string;',
)

replace_once(
    "app/conta-app.tsx",
    'branding: { storeName:APP_NAME,storePhone:"",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800 },',
    'branding: { storeName:APP_NAME,storeLogoDataUrl:"",storePhone:"",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800 },',
)

replace_once(
    "lib/invoice-branding.ts",
    'export const DEFAULT_INVOICE_BRANDING: InvoiceBrandingSettings = { storeName: APP_NAME, storePhone: "", storeAddress: "", registrationNumber: "", taxNumber: "", footerNote: "", nameFont: "tahoma", nameFontSize: 24, nameFontWeight: 800 };',
    'export const DEFAULT_INVOICE_BRANDING: InvoiceBrandingSettings = { storeName: APP_NAME, storeLogoDataUrl: "", storePhone: "", storeAddress: "", registrationNumber: "", taxNumber: "", footerNote: "", nameFont: "tahoma", nameFontSize: 24, nameFontWeight: 800 };',
)

replace_once(
    "lib/invoice-branding.ts",
    '  const optional=(key:string,max:number)=>{const result=String(body?.[key]??"").trim();if(result.length>max)throw new Error("إحدى معلومات النشاط أطول من الحد المسموح");return result};\n  return{storeName,storePhone:optional("storePhone",40),storeAddress:optional("storeAddress",160),registrationNumber:optional("registrationNumber",60),taxNumber:optional("taxNumber",60),footerNote:optional("footerNote",160),nameFont:body!.nameFont as InvoiceFont,nameFontSize,nameFontWeight:nameFontWeight as 400|600|800};',
    '  const optional=(key:string,max:number)=>{const result=String(body?.[key]??"").trim();if(result.length>max)throw new Error("إحدى معلومات النشاط أطول من الحد المسموح");return result};\n  const storeLogoDataUrl=optional("storeLogoDataUrl",500000);\n  if(storeLogoDataUrl&&!/^data:image\\/(?:png|jpeg|webp);base64,/i.test(storeLogoDataUrl))throw new Error("صورة الشعار غير صالحة. استخدم PNG أو JPG أو WebP");\n  return{storeName,storeLogoDataUrl,storePhone:optional("storePhone",80),storeAddress:optional("storeAddress",160),registrationNumber:optional("registrationNumber",60),taxNumber:optional("taxNumber",60),footerNote:optional("footerNote",160),nameFont:body!.nameFont as InvoiceFont,nameFontSize,nameFontWeight:nameFontWeight as 400|600|800};',
)

# Resize the selected logo before putting it in appSettings, so backups remain portable and small.
helper = '''async function prepareInvoiceLogo(file:File){
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("logo-format");
  if(file.size>5*1024*1024)throw new Error("logo-size");
  const bitmap=await createImageBitmap(file);
  try{
    if(!bitmap.width||!bitmap.height)throw new Error("logo-format");
    const maxSide=256,scale=Math.min(1,maxSide/bitmap.width,maxSide/bitmap.height),canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext("2d");if(!context)throw new Error("logo-format");
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const dataUrl=canvas.toDataURL("image/webp",.9);if(dataUrl.length>500000)throw new Error("logo-size");
    return dataUrl;
  }finally{bitmap.close()}
}
'''
replace_once(
    "app/conta-app.tsx",
    'function GeneralSettings({data,reload}:{data:BootstrapData;reload:()=>Promise<void>}) {',
    helper + 'function GeneralSettings({data,reload}:{data:BootstrapData;reload:()=>Promise<void>}) {',
)

replace_once(
    "app/conta-app.tsx",
    '  const dirty=JSON.stringify(branding)!==JSON.stringify(data.branding);\n  const save=async()=>{',
    '  const dirty=JSON.stringify(branding)!==JSON.stringify(data.branding);\n  const chooseLogo=async(file:File|null)=>{if(!file)return;setNotice("");try{const storeLogoDataUrl=await prepareInvoiceLogo(file);setBranding(current=>({...current,storeLogoDataUrl}))}catch(error){const code=error instanceof Error?error.message:"logo-format";setNotice(locale==="ar"?(code==="logo-size"?"صورة الشعار كبيرة جدًا. اختر صورة أصغر.":"صيغة الشعار غير مدعومة. استخدم PNG أو JPG أو WebP."):(code==="logo-size"?"Le logo est trop volumineux. Choisissez une image plus petite.":"Format de logo non pris en charge. Utilisez PNG, JPG ou WebP."))}};\n  const save=async()=>{',
)

replace_once(
    "app/conta-app.tsx",
    '<label>{tr("رقم الهاتف")}<input maxLength={40} disabled={!canBrand} value={branding.storePhone} onChange={e=>setBranding({...branding,storePhone:e.target.value})}/></label>',
    '<label>{locale==="ar"?"أرقام الهواتف":"Numéros de téléphone"}<input maxLength={80} disabled={!canBrand} value={branding.storePhone} placeholder={locale==="ar"?"مثال: 49823328 / 46991122":"Ex. : 49823328 / 46991122"} onChange={e=>setBranding({...branding,storePhone:e.target.value})}/><small className="business-field-hint">{locale==="ar"?"تظهر بجانب اسم المحل على الفاتورة":"Ils apparaissent à côté du nom du magasin sur la facture"}</small></label>',
)

logo_setting = '''<div className="branding-logo-setting"><div className="branding-logo-swatch">{branding.storeLogoDataUrl?<img src={branding.storeLogoDataUrl} alt=""/>:<span>{locale==="ar"?"لا يوجد شعار":"Aucun logo"}</span>}</div><div className="branding-logo-actions"><strong>{locale==="ar"?"شعار الفاتورة":"Logo de la facture"}</strong><small>{locale==="ar"?"يظهر داخل مربع صغير بجانب اسم المحل":"Affiché dans un petit carré à côté du nom du magasin"}</small><div><label className="file-button branding-logo-upload">{locale==="ar"?"رفع صورة":"Choisir une image"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!canBrand} onChange={event=>{const file=event.currentTarget.files?.[0]??null;event.currentTarget.value="";void chooseLogo(file)}}/></label>{branding.storeLogoDataUrl&&<button className="soft" type="button" disabled={!canBrand} onClick={()=>setBranding(current=>({...current,storeLogoDataUrl:""}))}>{locale==="ar"?"إزالة الصورة":"Supprimer l’image"}</button>}</div></div></div>'''
replace_once(
    "app/conta-app.tsx",
    '<FramedSection title={tr("هوية المستندات")} className="branding-settings"><div className="branding-fields">',
    '<FramedSection title={tr("هوية المستندات")} className="branding-settings">' + logo_setting + '<div className="branding-fields">',
)

# Put the logo and phone on the same brand row. Address stays below the name.
p = Path("app/conta-app.tsx")
text = p.read_text(encoding="utf-8")
pattern = r'function OfficialRecordSheet\(\{presentation,branding\}:\{presentation:OfficialPresentation;branding:InvoiceBrandingSettings\}\)\{.*?\}\nfunction PrintableDocument'
replacement = '''function OfficialRecordSheet({presentation,branding}:{presentation:OfficialPresentation;branding:InvoiceBrandingSettings}){const style={fontFamily:invoiceFontFamilies[branding.nameFont],fontSize:`${branding.nameFontSize}pt`,fontWeight:branding.nameFontWeight} as CSSProperties,businessLine=branding.storeAddress.trim(),registrationLine=[branding.registrationNumber&&`السجل التجاري: ${branding.registrationNumber}`,branding.taxNumber&&`الرقم الضريبي: ${branding.taxNumber}`].filter(Boolean).join(" · ");return <article className="official-record-sheet"><header className="official-record-header"><div className="official-record-brand">{branding.storeLogoDataUrl&&<img className="official-record-logo" src={branding.storeLogoDataUrl} alt=""/>}<div className="official-record-brand-copy"><div className="official-record-name-line"><strong style={style}>{branding.storeName}</strong>{branding.storePhone&&<span className="official-brand-phone" dir="ltr">{branding.storePhone}</span>}</div>{businessLine&&<span className="official-business-meta">{businessLine}</span>}</div></div>{registrationLine&&<span className="official-business-meta">{registrationLine}</span>}<h1>{presentation.title}</h1><span>{presentation.meta.slice(0,2).map(x=>x[1]).join(" · ")}</span></header><div className="official-record-meta">{presentation.meta.slice(2).map(([label,value])=><span key={label}><small>{label}</small><b>{value}</b></span>)}</div>{presentation.columns&&<div className="official-record-table-wrap"><table className="official-record-table"><thead><tr>{presentation.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{presentation.rows?.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} data-label={presentation.columns?.[j]??""}>{v}</td>)}</tr>)}</tbody></table></div>}{presentation.totals&&<div className={`official-record-totals ${presentation.tone??"neutral"}`}>{presentation.totals.map(([label,value])=><span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>}<footer>{branding.footerNote&&<span>{branding.footerNote}</span>}<small>{tr("تم إنشاء هذا المستند بواسطة")} {APP_NAME}</small></footer></article>}
function PrintableDocument'''
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"app/conta-app.tsx: OfficialRecordSheet replacement count={count}")
p.write_text(text, encoding="utf-8")

# Make the full A4 paper fill the thumbnail height rather than floating as a tiny strip.
replace_once(
    "app/printing.css",
    'transform:translate(-50%,-50%) scale(.105)!important',
    'transform:translate(-50%,-50%) scale(.132)!important',
)
replace_once(
    "app/printing.css",
    '.print-profile-preview.profile-a4 .official-record-sheet{transform:translate(-50%,-50%) scale(.083)!important}',
    '.print-profile-preview.profile-a4 .official-record-sheet{transform:translate(-50%,-50%) scale(.105)!important}',
)

printing_css = Path("app/printing.css")
css = printing_css.read_text(encoding="utf-8")
marker = "/* Invoice branding logo and phone */"
if marker in css:
    raise SystemExit("app/printing.css: branding marker already present")
css += '''\n\n/* Invoice branding logo and phone */\n.official-record-brand{display:flex;align-items:center;justify-content:center;gap:10px;min-width:0}.official-record-brand-copy{display:grid;justify-items:center;gap:3px;min-width:0}.official-record-name-line{display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap;min-width:0}.official-record-name-line strong{display:inline-block}.official-brand-phone{direction:ltr;unicode-bidi:isolate;font-size:10px!important;font-weight:700;color:#333!important;white-space:nowrap}.official-record-logo{display:block;width:50px;height:50px;flex:0 0 50px;object-fit:contain;padding:3px;border:1px solid #b8bec4;border-radius:6px;background:#fff}.print-profile-preview.profile-thermal80 .official-record-logo{width:38px;height:38px;flex-basis:38px}.print-profile-preview.profile-thermal58 .official-record-logo{width:32px;height:32px;flex-basis:32px}.branding-logo-setting{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;align-items:center;padding:9px;border:1px solid #d6dde1;border-radius:8px;background:#fafbfb}.branding-logo-swatch{display:grid;place-items:center;width:70px;height:70px;overflow:hidden;border:1px solid #bfc8cd;border-radius:8px;background:#fff;color:var(--text-muted);font-size:9px;text-align:center}.branding-logo-swatch img{display:block;width:100%;height:100%;object-fit:contain;padding:4px}.branding-logo-actions{display:grid;gap:4px;min-width:0}.branding-logo-actions>small,.business-field-hint{color:var(--text-muted);font-size:9px;font-weight:400}.branding-logo-actions>div{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.branding-logo-upload{min-height:34px}.branding-logo-upload input{display:none}html.print-document-mode:is([data-print-profile="thermal80"],[data-print-profile="thermal58"]) .official-record-brand{gap:2mm}html.print-document-mode:is([data-print-profile="thermal80"],[data-print-profile="thermal58"]) .official-record-name-line{gap:1.5mm}html.print-document-mode:is([data-print-profile="thermal80"],[data-print-profile="thermal58"]) .official-brand-phone{font-size:7pt!important}html.print-document-mode[data-print-profile="thermal80"] .official-record-logo{width:11mm;height:11mm;flex-basis:11mm;padding:.5mm;border-radius:1mm}html.print-document-mode[data-print-profile="thermal58"] .official-record-logo{width:9mm;height:9mm;flex-basis:9mm;padding:.4mm;border-radius:.8mm}@media(max-width:650px){.branding-logo-setting{grid-template-columns:1fr;justify-items:start}.branding-logo-actions>div{align-items:stretch}}\n'''
printing_css.write_text(css, encoding="utf-8")

# Focused regression tests: legacy branding must still load, and only safe compact raster data URLs are accepted.
Path("tests/invoice-branding-logo.test.mjs").write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport {validateInvoiceBranding} from "../lib/invoice-branding.ts";\nconst base={storeName:"الكرنه",storePhone:"49823328 / 46991122",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800};\ntest("legacy invoice branding gets an empty logo and keeps multiple phone numbers",()=>{const value=validateInvoiceBranding(base);assert.equal(value.storeLogoDataUrl,"");assert.equal(value.storePhone,base.storePhone)});\ntest("invoice branding accepts compact raster logos and rejects SVG data URLs",()=>{const logo="data:image/png;base64,AA==";assert.equal(validateInvoiceBranding({...base,storeLogoDataUrl:logo}).storeLogoDataUrl,logo);assert.throws(()=>validateInvoiceBranding({...base,storeLogoDataUrl:"data:image/svg+xml;base64,AA=="}),/صورة الشعار غير صالحة/)});\n''', encoding="utf-8")

# Extend the existing print tests to pin the requested small-card behavior and brand row.
p = Path("tests/printing.test.mjs")
t = p.read_text(encoding="utf-8")
if 'A4 thumbnail fills the preview card' in t:
    raise SystemExit("tests/printing.test.mjs: regression test already present")
t += '\ntest("A4 thumbnail fills the preview card and invoice header supports logo plus phones",()=>{assert.match(css,/profile-a4[\\s\\S]*scale\\(\\.132\\)/);assert.match(app,/official-record-logo/);assert.match(app,/official-brand-phone/);assert.match(app,/storeLogoDataUrl/);assert.match(app,/أرقام الهواتف/)});\n'
p.write_text(t, encoding="utf-8")
