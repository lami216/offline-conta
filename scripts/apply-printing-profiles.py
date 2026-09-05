from pathlib import Path
import json


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# --- Desktop preload: narrow, print-only bridge ---
Path("desktop/preload.cjs").write_text(r'''/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("alkarnaDesktop", {
  getPrinters: () => ipcRenderer.invoke("alkarna:printers:list"),
  getPrintSettings: () => ipcRenderer.invoke("alkarna:print-settings:get"),
  savePrintSettings: settings => ipcRenderer.invoke("alkarna:print-settings:set", settings),
  print: options => ipcRenderer.invoke("alkarna:print", options),
});
''', encoding="utf-8")

# --- Renderer printing utility ---
Path("app/desktop-printing.ts").write_text(r'''"use client";

export type PrintProfile = "a4" | "thermal80" | "thermal58";
export type DevicePrintSettings = { printerName: string | null; profile: PrintProfile };
export type PrinterSummary = { name: string; displayName: string; description?: string; status?: number; isDefault?: boolean };
export type PrintResult = { ok: boolean; code?: string; error?: string; usedFallbackPageSize?: boolean };

export const DEFAULT_DEVICE_PRINT_SETTINGS: DevicePrintSettings = { printerName: null, profile: "a4" };
const STORAGE_KEY = "alkarna-device-print-settings-v1";

interface DesktopPrintBridge {
  getPrinters(): Promise<PrinterSummary[]>;
  getPrintSettings(): Promise<DevicePrintSettings>;
  savePrintSettings(settings: DevicePrintSettings): Promise<DevicePrintSettings>;
  print(options: { printerName: string | null; profile: PrintProfile; silent: boolean; contentHeightMicrons?: number }): Promise<PrintResult>;
}

declare global { interface Window { alkarnaDesktop?: DesktopPrintBridge } }

function normalizeSettings(value: unknown): DevicePrintSettings {
  const input = (value ?? {}) as Partial<DevicePrintSettings>;
  const profile: PrintProfile = input.profile === "thermal80" || input.profile === "thermal58" ? input.profile : "a4";
  const printerName = typeof input.printerName === "string" && input.printerName.trim() ? input.printerName : null;
  return { printerName, profile };
}

function localSettings(): DevicePrintSettings {
  if (typeof window === "undefined") return DEFAULT_DEVICE_PRINT_SETTINGS;
  try { return normalizeSettings(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")); }
  catch { return DEFAULT_DEVICE_PRINT_SETTINGS; }
}

export async function loadPrintEnvironment(): Promise<{ desktop: boolean; settings: DevicePrintSettings; printers: PrinterSummary[] }> {
  if (typeof window !== "undefined" && window.alkarnaDesktop) {
    try {
      const [settings, printers] = await Promise.all([window.alkarnaDesktop.getPrintSettings(), window.alkarnaDesktop.getPrinters()]);
      return { desktop: true, settings: normalizeSettings(settings), printers: Array.isArray(printers) ? printers : [] };
    } catch { /* fall through to the browser-safe profile store */ }
  }
  return { desktop: false, settings: localSettings(), printers: [] };
}

export async function saveDevicePrintSettings(settings: DevicePrintSettings) {
  const normalized = normalizeSettings(settings);
  if (typeof window !== "undefined" && window.alkarnaDesktop) return normalizeSettings(await window.alkarnaDesktop.savePrintSettings(normalized));
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

async function waitForAssets(portal: HTMLElement) {
  try { await document.fonts?.ready; } catch {}
  const images = [...portal.querySelectorAll("img")];
  await Promise.all(images.filter(image => !image.complete).map(image => new Promise<void>(resolve => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  })));
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function measureReceiptHeight(portal: HTMLElement, profile: PrintProfile) {
  if (profile === "a4") return undefined;
  const previous = portal.getAttribute("style");
  portal.style.display = "block";
  portal.style.position = "fixed";
  portal.style.visibility = "hidden";
  portal.style.pointerEvents = "none";
  portal.style.left = "-100000px";
  portal.style.top = "0";
  portal.style.zIndex = "-1";
  const sheet = portal.querySelector<HTMLElement>(".official-record-sheet");
  const heightPx = Math.max(sheet?.scrollHeight ?? 0, sheet?.getBoundingClientRect().height ?? 0, 190);
  if (previous === null) portal.removeAttribute("style"); else portal.setAttribute("style", previous);
  // CSS pixels are defined at 96dpi. Add a small roll-feed allowance after the footer.
  return Math.min(2_000_000, Math.max(50_000, Math.ceil(heightPx * (25_400 / 96) + 8_000)));
}

async function browserPrint(): Promise<PrintResult> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; window.removeEventListener("afterprint", finish); resolve({ ok: true }); };
    window.addEventListener("afterprint", finish, { once: true });
    try { window.print(); window.setTimeout(finish, 1800); }
    catch (error) { settled = true; window.removeEventListener("afterprint", finish); resolve({ ok: false, code: "PRINT_FAILED", error: error instanceof Error ? error.message : String(error) }); }
  });
}

export async function printDocumentPortal(options: { silent?: boolean; settings?: DevicePrintSettings; portal?: HTMLElement | null } = {}): Promise<PrintResult> {
  if (typeof window === "undefined") return { ok: false, code: "WINDOW_UNAVAILABLE" };
  const environment = options.settings ? { settings: normalizeSettings(options.settings) } : await loadPrintEnvironment();
  const settings = environment.settings;
  const portal = options.portal ?? [...document.querySelectorAll<HTMLElement>(".document-print-portal")].at(-1) ?? null;
  if (!portal) return { ok: false, code: "PRINT_TARGET_MISSING" };

  portal.dataset.printProfile = settings.profile;
  await waitForAssets(portal);
  const contentHeightMicrons = measureReceiptHeight(portal, settings.profile);
  const root = document.documentElement;
  root.classList.add("print-document-mode");
  try {
    if (window.alkarnaDesktop) {
      return await window.alkarnaDesktop.print({ printerName: settings.printerName, profile: settings.profile, silent: options.silent === true, contentHeightMicrons });
    }
    return await browserPrint();
  } catch (error) {
    return { ok: false, code: "PRINT_FAILED", error: error instanceof Error ? error.message : String(error) };
  } finally {
    root.classList.remove("print-document-mode");
  }
}

export function formatPrintError(locale: "ar" | "fr", result: PrintResult) {
  const ar = locale === "ar";
  if (result.code === "PRINT_CANCELLED") return ar ? "تم إلغاء الطباعة" : "Impression annulée";
  if (result.code === "NO_PRINTERS") return ar ? "لا توجد طابعة متاحة على هذا الجهاز" : "Aucune imprimante n’est disponible sur cet appareil";
  if (result.code === "PRINTER_NOT_FOUND") return ar ? "الطابعة الافتراضية المحفوظة غير موجودة. اختر طابعة أخرى من الإعدادات." : "L’imprimante enregistrée est introuvable. Choisissez-en une autre dans les paramètres.";
  if (result.code === "PRINT_TARGET_MISSING") return ar ? "تعذر تجهيز الفاتورة للطباعة" : "Impossible de préparer la facture pour l’impression";
  return ar ? `تعذرت الطباعة${result.error ? `: ${result.error}` : ""}` : `Échec de l’impression${result.error ? ` : ${result.error}` : ""}`;
}
''', encoding="utf-8")

# --- Device printer settings panel ---
Path("app/print-settings-panel.tsx").write_text(r'''"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import type { InvoiceBrandingSettings } from "./domain";
import { useI18n } from "./i18n/provider";
import { DEFAULT_DEVICE_PRINT_SETTINGS, formatPrintError, loadPrintEnvironment, printDocumentPortal, saveDevicePrintSettings, type DevicePrintSettings, type PrinterSummary, type PrintProfile } from "./desktop-printing";

const profileOrder: PrintProfile[] = ["a4", "thermal80", "thermal58"];

function TestInvoice({ branding, locale }: { branding: InvoiceBrandingSettings; locale: "ar" | "fr" }) {
  const t = (ar: string, fr: string) => locale === "ar" ? ar : fr;
  return <article className="official-record-sheet print-test-sheet">
    <header className="official-record-header"><strong>{branding.storeName}</strong><h1>{t("فاتورة تجريبية", "Facture test")}</h1><span>TEST-0001 · 05/09/2026</span></header>
    <div className="official-record-meta"><span><small>{t("العميل", "Client")}</small><b>{t("بيع مباشر", "Vente directe")}</b></span><span><small>{t("طريقة الدفع", "Paiement")}</small><b>{t("نقدي", "Espèces")}</b></span></div>
    <div className="official-record-table-wrap"><table className="official-record-table"><thead><tr><th>{t("رقم", "N°")}</th><th>{t("المنتج", "Produit")}</th><th>{t("الكمية", "Qté")}</th><th>{t("سعر الوحدة", "Prix")}</th><th>{t("المجموع", "Total")}</th></tr></thead><tbody><tr><td data-label={t("رقم", "N°")}>1</td><td data-label={t("المنتج", "Produit")}>{t("منتج تجريبي", "Produit test")}</td><td data-label={t("الكمية", "Qté")}>2</td><td data-label={t("سعر الوحدة", "Prix")}>500 MRU</td><td data-label={t("المجموع", "Total")}>1 000 MRU</td></tr><tr><td data-label={t("رقم", "N°")}>2</td><td data-label={t("المنتج", "Produit")}>{t("منتج آخر", "Autre produit")}</td><td data-label={t("الكمية", "Qté")}>1</td><td data-label={t("سعر الوحدة", "Prix")}>750 MRU</td><td data-label={t("المجموع", "Total")}>750 MRU</td></tr></tbody></table></div>
    <div className="official-record-totals"><span><small>{t("الإجمالي", "Total")}</small><strong>1 750 MRU</strong></span></div>
    <footer><small>{t("طباعة تجريبية من الكرنه", "Impression test AlKarna")}</small></footer>
  </article>;
}

function MiniPreview({ profile, storeName, locale }: { profile: PrintProfile; storeName: string; locale: "ar" | "fr" }) {
  const t = (ar: string, fr: string) => locale === "ar" ? ar : fr;
  return <div className={`print-profile-mini mini-${profile}`}><strong>{storeName}</strong><b>{t("فاتورة بيع", "Facture de vente")}</b><i/><span>{t("منتج", "Produit")}</span><span>2 × 500</span><i/><em>1 000 MRU</em></div>;
}

export function PrintSettingsPanel({ branding }: { branding: InvoiceBrandingSettings }) {
  const { locale } = useI18n();
  const t = (ar: string, fr: string) => locale === "ar" ? ar : fr;
  const [desktop, setDesktop] = useState(false), [printers, setPrinters] = useState<PrinterSummary[]>([]), [settings, setSettings] = useState<DevicePrintSettings>(DEFAULT_DEVICE_PRINT_SETTINGS), [saved, setSaved] = useState<DevicePrintSettings>(DEFAULT_DEVICE_PRINT_SETTINGS);
  const [busy, setBusy] = useState(""), [message, setMessage] = useState(""), [error, setError] = useState(""), [testPortal, setTestPortal] = useState(false);
  const refresh = async () => { setBusy("load"); setError(""); try { const env = await loadPrintEnvironment(); setDesktop(env.desktop); setPrinters(env.printers); setSettings(env.settings); setSaved(env.settings); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(""); } };
  useEffect(() => { void refresh(); }, []);
  const defaultPrinter = printers.find(printer => printer.isDefault), selectedPrinter = settings.printerName ? printers.find(printer => printer.name === settings.printerName) : defaultPrinter;
  const missingSelectedPrinter = Boolean(settings.printerName && !printers.some(printer => printer.name === settings.printerName));
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const profileLabel = (profile: PrintProfile) => profile === "a4" ? "A4" : profile === "thermal80" ? t("حرارية 80mm", "Thermique 80 mm") : t("حرارية 58mm", "Thermique 58 mm");
  const save = async () => { setBusy("save"); setError(""); setMessage(""); try { const value = await saveDevicePrintSettings(settings); setSettings(value); setSaved(value); setMessage(t("تم حفظ إعدادات الطباعة لهذا الجهاز", "Paramètres d’impression enregistrés pour cet appareil")); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(""); } };
  const test = async () => { setBusy("test"); setError(""); setMessage(""); setTestPortal(true); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); const result = await printDocumentPortal({ silent: false, settings }); setTestPortal(false); if (result.ok) setMessage(t("تم إرسال الفاتورة التجريبية للطباعة", "Facture test envoyée à l’impression")); else if (result.code === "PRINT_CANCELLED") setMessage(formatPrintError(locale, result)); else setError(formatPrintError(locale, result)); setBusy(""); };
  const options = useMemo(() => printers.map(printer => ({ ...printer, label: printer.displayName || printer.name })), [printers]);

  return <fieldset className="erp-fieldset print-settings-panel"><legend>{t("إعدادات الطباعة", "Paramètres d’impression")}</legend>
    <div className="print-settings-head"><label>{t("الطابعة الافتراضية", "Imprimante par défaut")}<select value={settings.printerName ?? ""} disabled={busy === "load" || !desktop} onChange={event => setSettings(current => ({ ...current, printerName: event.target.value || null }))}><option value="">{t("طابعة Windows الافتراضية", "Imprimante Windows par défaut")}{defaultPrinter ? ` — ${defaultPrinter.displayName || defaultPrinter.name}` : ""}</option>{options.map(printer => <option key={printer.name} value={printer.name}>{printer.label}</option>)}</select></label><button type="button" className="soft printer-refresh" disabled={busy === "load"} onClick={() => void refresh()}>{t("تحديث الطابعات", "Actualiser")}</button></div>
    {!desktop && <small className="print-device-note">{t("اختيار طابعة محددة متاح داخل تطبيق Windows. يمكنك هنا اختيار شكل الفاتورة.", "Le choix d’une imprimante précise est disponible dans l’application Windows. Vous pouvez choisir ici le format de facture.")}</small>}
    {desktop && !printers.length && busy !== "load" && <div className="print-warning">{t("لم يعثر Windows على أي طابعة مثبتة.", "Windows n’a détecté aucune imprimante installée.")}</div>}
    {missingSelectedPrinter && <div className="print-warning">{t("الطابعة المحفوظة غير موجودة حاليًا. اختر طابعة أخرى.", "L’imprimante enregistrée est actuellement introuvable. Choisissez-en une autre.")}</div>}
    {selectedPrinter && <small className="print-printer-status">{t("الطابعة المستخدمة:", "Imprimante utilisée :")} <b>{selectedPrinter.displayName || selectedPrinter.name}</b>{selectedPrinter.isDefault ? ` · ${t("افتراضية في Windows", "par défaut dans Windows")}` : ""}</small>}
    <div className="print-profile-options" role="group" aria-label={t("تنسيق الفاتورة", "Format de facture")}>{profileOrder.map(profile => <button type="button" key={profile} className="print-profile-card" aria-pressed={settings.profile === profile} onClick={() => setSettings(current => ({ ...current, profile }))}><span>{profileLabel(profile)}</span><MiniPreview profile={profile} storeName={branding.storeName || "الكرنه"} locale={locale}/>{settings.profile === profile && <b className="print-profile-default">{t("الافتراضي", "Par défaut")}</b>}</button>)}</div>
    <div className="print-settings-actions"><button type="button" className="primary" disabled={!dirty || busy === "save"} onClick={() => void save()}>{busy === "save" ? t("جاري الحفظ…", "Enregistrement…") : t("حفظ إعدادات الطباعة", "Enregistrer l’impression")}</button><button type="button" className="soft" disabled={busy === "test" || (desktop && !printers.length)} onClick={() => void test()}><Printer/>{busy === "test" ? t("جاري تجهيز الطباعة…", "Préparation…") : t("طباعة تجريبية", "Impression test")}</button></div>
    {message && <div className="success">{message}</div>}{error && <div className="error">{error}</div>}
    {testPortal && createPortal(<div className="document-print-portal"><TestInvoice branding={branding} locale={locale}/></div>, document.body)}
  </fieldset>;
}
''', encoding="utf-8")

# --- Printing/profile styles ---
Path("app/printing.css").write_text(r'''/* Device printer settings and the three invoice paper profiles. */
.print-settings-panel{display:grid;gap:10px}.print-settings-head{display:grid;grid-template-columns:minmax(260px,1fr) auto;align-items:end;gap:8px}.print-settings-head label{display:grid;gap:4px}.printer-refresh{min-height:36px}.print-device-note,.print-printer-status{color:var(--text-muted);line-height:1.6}.print-warning{padding:7px 9px;border:1px solid #d59b28;border-radius:6px;color:#7a4a00;background:#fff8e7}.print-profile-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.print-profile-card{display:grid;justify-items:center;align-content:start;gap:6px;min-height:190px;padding:9px;border:1px solid var(--border);border-radius:8px;color:var(--text);background:#f8fafb}.print-profile-card:hover{border-color:var(--section-color);background:var(--section-soft)}.print-profile-card[aria-pressed="true"]{border:2px solid var(--section-color);background:var(--section-soft);box-shadow:0 0 0 2px color-mix(in srgb,var(--section-color) 14%,transparent)}.print-profile-card>span{font-weight:850}.print-profile-default{font-size:9px;color:var(--section-color)}.print-profile-mini{box-sizing:border-box;display:grid;align-content:start;gap:3px;padding:7px;border:1px solid #b9c0c7;background:#fff;color:#1a1f24;font-size:7px;box-shadow:0 2px 5px #0001}.print-profile-mini strong,.print-profile-mini b,.print-profile-mini em{text-align:center;font-style:normal}.print-profile-mini i{height:1px;background:#c8ccd0}.mini-a4{width:104px;height:147px}.mini-thermal80{width:76px;height:150px}.mini-thermal58{width:58px;height:154px;font-size:6px}.print-settings-actions{display:flex;align-items:center;gap:8px}.print-settings-actions button{min-height:36px}.print-settings-actions svg{width:16px}.print-test-sheet{direction:inherit}

/* The same OfficialRecordSheet is reused for A4, 80 mm and 58 mm. */
.document-print-portal[data-print-profile="thermal80"] .official-record-sheet,.document-print-portal[data-print-profile="thermal58"] .official-record-sheet{box-sizing:border-box;margin:0;box-shadow:none;border:0}.document-print-portal[data-print-profile="thermal80"] .official-record-sheet{width:80mm;max-width:80mm;padding:3mm;font-size:9pt}.document-print-portal[data-print-profile="thermal58"] .official-record-sheet{width:58mm;max-width:58mm;padding:2.2mm;font-size:8pt}.document-print-portal[data-print-profile^="thermal"] .official-record-header{padding-bottom:2.5mm;border-bottom:1px dashed #777}.document-print-portal[data-print-profile="thermal80"] .official-record-header strong{font-size:14pt!important}.document-print-portal[data-print-profile="thermal58"] .official-record-header strong{font-size:12pt!important}.document-print-portal[data-print-profile^="thermal"] .official-record-header h1{margin:2mm 0 1mm;font-size:12pt}.document-print-portal[data-print-profile="thermal58"] .official-record-header h1{font-size:10.5pt}.document-print-portal[data-print-profile^="thermal"] .official-record-header span{font-size:7.5pt}.document-print-portal[data-print-profile^="thermal"] .official-record-meta{grid-template-columns:1fr;gap:0;padding:2mm 0}.document-print-portal[data-print-profile^="thermal"] .official-record-meta span{padding:1mm 0;border-bottom:1px dotted #bbb}.document-print-portal[data-print-profile^="thermal"] .official-record-table-wrap{overflow:visible}.document-print-portal[data-print-profile^="thermal"] .official-record-table,.document-print-portal[data-print-profile^="thermal"] .official-record-table tbody,.document-print-portal[data-print-profile^="thermal"] .official-record-table tr{display:block;width:100%}.document-print-portal[data-print-profile^="thermal"] .official-record-table thead{display:none!important}.document-print-portal[data-print-profile^="thermal"] .official-record-table tr{padding:1.5mm 0;border-bottom:1px dashed #999;break-inside:avoid}.document-print-portal[data-print-profile^="thermal"] .official-record-table td{display:flex;align-items:baseline;justify-content:space-between;gap:3mm;width:100%;padding:.7mm 0;border:0!important;text-align:end!important;font-size:8.5pt}.document-print-portal[data-print-profile="thermal58"] .official-record-table td{gap:2mm;font-size:7.5pt}.document-print-portal[data-print-profile^="thermal"] .official-record-table td::before{content:attr(data-label);flex:0 0 auto;color:#555;font-size:.9em;font-weight:700;text-align:start}.document-print-portal[data-print-profile^="thermal"] .official-record-totals{display:block;width:100%;min-width:0;margin:2.5mm 0}.document-print-portal[data-print-profile^="thermal"] .official-record-totals span{gap:4mm;padding:1.5mm 0}.document-print-portal[data-print-profile^="thermal"] .official-record-sheet footer{margin-top:3mm;padding-top:2mm;border-top:1px dashed #999;font-size:7pt}.document-print-portal[data-print-profile="thermal58"] .official-record-sheet footer{font-size:6.5pt}

@page receipt{margin:0}
@media print{
 html.print-document-mode body>.document-print-portal[data-print-profile="thermal80"] .official-record-sheet,html.print-document-mode body>.document-print-portal[data-print-profile="thermal58"] .official-record-sheet{page:receipt;width:100%;max-width:none;padding:3mm;border:0;box-shadow:none;font-family:Arial,sans-serif}
 html.print-document-mode body>.document-print-portal[data-print-profile="thermal58"] .official-record-sheet{padding:2.2mm}
}
@media(max-width:760px){.print-settings-head{grid-template-columns:1fr}.print-profile-options{grid-template-columns:1fr}.print-profile-card{min-height:0}.print-settings-actions{flex-wrap:wrap}}
''', encoding="utf-8")

# --- Main Electron process ---
replace_once("desktop/main.cjs", "const {app,BrowserWindow,Menu,shell,dialog,session}=require('electron');", "const {app,BrowserWindow,Menu,shell,dialog,session,ipcMain}=require('electron');")
replace_once("desktop/main.cjs", "const {writeFile}=require('node:fs/promises');", "const {readFile,writeFile}=require('node:fs/promises');")
replace_once("desktop/main.cjs", "const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)});", r'''const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)});
const PRINT_PROFILES=new Set(['a4','thermal80','thermal58']),DEFAULT_PRINT_SETTINGS={printerName:null,profile:'a4'};
const printSettingsPath=()=>join(app.getPath('userData'),'device-print-settings.json');
const normalizePrintSettings=value=>{const input=value&&typeof value==='object'?value:{};return{printerName:typeof input.printerName==='string'&&input.printerName.trim()?input.printerName:null,profile:PRINT_PROFILES.has(input.profile)?input.profile:'a4'}};
async function readPrintSettings(){try{return normalizePrintSettings(JSON.parse(await readFile(printSettingsPath(),'utf8')))}catch{return{...DEFAULT_PRINT_SETTINGS}}}
async function savePrintSettings(value){const settings=normalizePrintSettings(value);await writeFile(printSettingsPath(),JSON.stringify(settings,null,2),{encoding:'utf8',mode:0o600});return settings}
const trustedPrintSender=event=>!!window&&!window.isDestroyed()&&event.sender===window.webContents;
const printerSummary=printer=>({name:printer.name,displayName:printer.displayName||printer.name,description:printer.description||'',status:printer.status,isDefault:!!printer.isDefault});
const runNativePrint=options=>new Promise(resolve=>window.webContents.print(options,(success,failureReason)=>resolve({success,failureReason:failureReason||''})));
ipcMain.handle('alkarna:printers:list',async event=>{if(!trustedPrintSender(event))return[];return(await window.webContents.getPrintersAsync()).map(printerSummary)});
ipcMain.handle('alkarna:print-settings:get',async event=>trustedPrintSender(event)?readPrintSettings():DEFAULT_PRINT_SETTINGS);
ipcMain.handle('alkarna:print-settings:set',async(event,value)=>{if(!trustedPrintSender(event))throw new Error('unauthorized print settings request');return savePrintSettings(value)});
ipcMain.handle('alkarna:print',async(event,payload={})=>{if(!trustedPrintSender(event))return{ok:false,code:'WINDOW_UNAVAILABLE'};const persisted=await readPrintSettings(),profile=PRINT_PROFILES.has(payload.profile)?payload.profile:persisted.profile,printerName=typeof payload.printerName==='string'&&payload.printerName.trim()?payload.printerName:persisted.printerName,printers=await window.webContents.getPrintersAsync();if(!printers.length)return{ok:false,code:'NO_PRINTERS'};if(printerName&&!printers.some(printer=>printer.name===printerName))return{ok:false,code:'PRINTER_NOT_FOUND'};const base={silent:payload.silent===true,printBackground:true,landscape:false,margins:{marginType:'none'},...(printerName?{deviceName:printerName}:{})};let options={...base};if(profile==='a4')options.pageSize='A4';else{const width=profile==='thermal80'?80000:58000,height=Math.min(2000000,Math.max(50000,Number(payload.contentHeightMicrons)||180000));options.pageSize={width,height}}let result=await runNativePrint(options),usedFallbackPageSize=false;if(!result.success&&profile!=='a4'){const fallback={...base,usePrinterDefaultPageSize:true};result=await runNativePrint(fallback);usedFallbackPageSize=result.success}if(result.success)return{ok:true,usedFallbackPageSize};const reason=String(result.failureReason||'');return{ok:false,code:/cancel/i.test(reason)?'PRINT_CANCELLED':'PRINT_FAILED',error:reason}});''')
replace_once("desktop/main.cjs", "webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}", "webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:join(__dirname,'preload.cjs')}")

# --- Package the preload script ---
package_path = Path("package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
files = package["build"]["files"]
if "desktop/preload.cjs" not in files:
    files.insert(1, "desktop/preload.cjs")
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# --- Load profile CSS after the existing application CSS ---
replace_once("app/layout.tsx", 'import "./locale-layout.css";', 'import "./locale-layout.css";\nimport "./printing.css";')

# --- Connect the existing invoice UI to the print bridge without changing sale/accounting logic ---
replace_once("app/conta-app.tsx", 'import { translateApiError } from "./i18n/api-errors";', 'import { translateApiError } from "./i18n/api-errors";\nimport { formatPrintError, printDocumentPortal } from "./desktop-printing";\nimport { PrintSettingsPanel } from "./print-settings-panel";')
replace_once("app/conta-app.tsx", r'''  useEffect(() => {
    if (!autoPrintId || !data.documents.some(document => document.id === autoPrintId)) return;
    const root = window.document.documentElement, timer = window.setTimeout(() => {
      root.classList.add("print-document-mode"); window.print(); root.classList.remove("print-document-mode"); setAutoPrintId(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [autoPrintId, data.documents]);''', r'''  useEffect(() => {
    if (!autoPrintId || !data.documents.some(document => document.id === autoPrintId)) return;
    const timer = window.setTimeout(() => {
      void printDocumentPortal({silent:true}).then(result => { if (!result.ok) showTransientNotice(formatPrintError(locale,result)); }).finally(() => setAutoPrintId(null));
    }, 50);
    return () => window.clearTimeout(timer);
  }, [autoPrintId, data.documents, locale]);''')
replace_once("app/conta-app.tsx", '    <FramedSection title={tr("معلومات المستند")} className="document-info-settings">', '    <PrintSettingsPanel branding={branding}/>\n    <FramedSection title={tr("معلومات المستند")} className="document-info-settings">')
replace_once("app/conta-app.tsx", '{presentation.rows?.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}', '{presentation.rows?.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} data-label={presentation.columns?.[j]}>{v}</td>)}</tr>)}')
replace_once("app/conta-app.tsx", r'''function DocumentDetail({document,data,close,onEdit}:{document:DocumentRecord;data:BootstrapData;close:()=>void;onEdit?: () => void}){
 function printDocument(){const root=window.document.documentElement,cleanup=()=>root.classList.remove("print-document-mode");root.classList.add("print-document-mode");window.addEventListener("afterprint",cleanup,{once:true});window.print();window.setTimeout(cleanup,1500)}''', r'''function DocumentDetail({document,data,close,onEdit}:{document:DocumentRecord;data:BootstrapData;close:()=>void;onEdit?: () => void}){
 const {locale}=useI18n();
 function printDocument(){void printDocumentPortal({silent:false}).then(result=>{if(!result.ok&&result.code!=="PRINT_CANCELLED")showTransientNotice(formatPrintError(locale,result))})}''')

# --- Source-level regression tests for the bridge and profiles ---
Path("tests/desktop-printing.test.mjs").write_text(r'''import test from "node:test";import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const main=readFileSync(new URL("../desktop/main.cjs",import.meta.url),"utf8"),preload=readFileSync(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),css=readFileSync(new URL("../app/printing.css",import.meta.url),"utf8"),panel=readFileSync(new URL("../app/print-settings-panel.tsx",import.meta.url),"utf8"),pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
test("desktop exposes only the narrow printing bridge",()=>{assert.match(main,/ipcMain\.handle\('alkarna:printers:list'/);assert.match(main,/webContents\.getPrintersAsync\(\)/);assert.match(main,/ipcMain\.handle\('alkarna:print'/);assert.match(main,/webContents\.print\(/);assert.match(main,/trustedPrintSender/);assert.match(main,/preload:join\(__dirname,'preload\.cjs'\)/);assert.match(preload,/contextBridge\.exposeInMainWorld\("alkarnaDesktop"/);for(const method of ["getPrinters","getPrintSettings","savePrintSettings","print"])assert.match(preload,new RegExp(`${method}:`));assert.doesNotMatch(preload,/exposeInMainWorld\([^,]+,\s*ipcRenderer/);assert.ok(pkg.build.files.includes("desktop/preload.cjs"))});
test("invoice printing supports A4 and both thermal widths",()=>{for(const profile of ["a4","thermal80","thermal58"])assert.match(panel,new RegExp(`"${profile}"`));assert.match(css,/width:80mm/);assert.match(css,/width:58mm/);assert.match(css,/data-label/);assert.match(app,/data-label=\{presentation\.columns\?\.\[j\]\}/);assert.match(app,/printDocumentPortal\(\{silent:true\}\)/);assert.match(app,/PrintSettingsPanel branding=\{branding\}/)});
test("automatic invoice printing no longer tears down print mode immediately after window.print",()=>{assert.doesNotMatch(app,/root\.classList\.add\("print-document-mode"\); window\.print\(\); root\.classList\.remove\("print-document-mode"\)/)});
''', encoding="utf-8")

print("printing profiles patch applied")
