"use client";
import { Fragment, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  ChevronDown,
  Globe,
  Landmark,
  LogOut,
  Menu,
  MessageCircle,
  PackagePlus,
  PencilLine,
  Phone,
  Plus,
  Printer,
  Receipt,
  ReceiptText,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  activeWarehouses,
  activeProducts,
  activePaymentAccounts,
  displayDocumentNumber,
  formatDate,
  isProductExpired,
  formatDateTime,
  kindLabels,
  visibleDocumentKindLabels,
  inventoryUnitCost,
  resolvePartyType,
  money,
  number,
  quantity,
  stockInWarehouse,
  totalProductStock,
  saleLineTotal,
  type BootstrapData,
  type DocumentRecord,
  type Party,
  type Product,
  type PaymentAccount,
  type InvoiceBrandingSettings,
} from "./domain";
import { invoiceFontFamilies } from "../lib/invoice-branding";
import { APP_LOGO_ALT, APP_LOGO_PATH, APP_NAME, APP_TAGLINE } from "../lib/app-brand";
import { calculatePartyFinancialSummaries, partyAggregateMetrics, partyTradeMetrics } from "./party-metrics";
import { reportDateQuery, reportNumber, reportTableModel, type ReportResponse, type ReportType } from "./report-types";
import { buildReportFooterMetrics } from "./report-footer";
import { applyPriceMode, clearPersistedSaleDraft, initialSaleUiState, sellingPrice, updateSaleDraftLine, validateSaleDraft, type PriceMode } from "./sale-draft";
import { readApiResponse } from "./api-response";
import { finishSuccessfulCommand } from "./command-lifecycle";
import { useHoverEnterActivation } from "./hover-enter";
import { expenseAllTimeMode, expenseDateMode, expenseSearchMode, filterDocumentsByDate, localBusinessDay, rankExpenseDocuments, type ExpenseHistoryFilters } from "./history-filters";
import { bankScopeMetrics, filterFinancialMovements, filterTransfers, type CommittedPeriod } from "./bank-filters";
import { allPermissions, permissionRows, setPermission, setRowFullControl, type PermissionAction } from "./user-permissions";

type View =
  | "pos"
  | "purchases"
  | "expenses"
  | "customers"
  | "suppliers"
  | "warehouses"
  | "warehouseAdmin"
  | "transfers"
  | "adjustments"
  | "products"
  | "records"
  | "reports"
  | "banks"
  | "settings";
type RunCommand = (
  body: Record<string, unknown>,
  message: string,
  afterSuccess?: () => void,
) => Promise<string & { disposition?: "deleted" | "archived" }>;
type AdjustmentPrefill = { productId: string; warehouseId: string };
type BankTab = "accounts" | "movements" | "transfers" | "adjustment";
type SettingsTab = "general" | "users" | "data" | "license" | "contact";
type LicenseInfo = {licenseId:string;storeId:string;customerName:string;storeName:string;deviceId:string;issuedAt:string;type:"perpetual"|"temporary";expiresAt:string|null};
type LicenseStatus = {valid:boolean;license?:LicenseInfo;reason?:string};
type DraftLine = {
  productId: string;
  quantity: string;
  piecePrice: string;
  unitPrice: string;
  actualQuantity: string;
};
const empty: BootstrapData = {
  principal: { principalType: "local", name: "دخول مباشر", permissions: [] },
  branding: { storeName:APP_NAME,storePhone:"",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800 },
  nextProductCode: 1,
  nextDocumentSequences: { sale: 1, purchase: 1, expense: 1 },
  parties: [],
  warehouses: [],
  products: [],
  documents: [],
  movements: [],
  financialMovements: [],
  partyFinancialSummaries: [],
  paymentAccounts: [],
  recurringExpenses: [],
  accountTransfers: [],
};
function useSessionDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try { const saved = sessionStorage.getItem(`conta:${key}`); return saved ? JSON.parse(saved) as T : initial; } catch { return initial; }
  });
  useEffect(() => { sessionStorage.setItem(`conta:${key}`, JSON.stringify(value)); }, [key, value]);
  return [value, setValue] as const;
}
const nav: Array<{ id: View; label: string; icon: typeof ShoppingCart }> = [
  { id: "pos", label: "نقطة البيع", icon: ShoppingCart },
  { id: "products", label: "المنتجات", icon: PackagePlus },

  { id: "banks", label: "البنوك", icon: Landmark },
  { id: "reports", label: "التقارير", icon: Receipt },
  { id: "settings", label: "الإعدادات", icon: SettingsIcon },
];
const partyNav: Array<{ id: View; label: string; icon: typeof Users }> = [
  { id: "customers", label: "العملاء", icon: Users },
  { id: "suppliers", label: "الموردون", icon: Users },
];
const invoiceNav: Array<{ id: View; label: string; icon: typeof Receipt }> = [
  { id: "purchases", label: "فواتير الشراء", icon: PackagePlus },
  { id: "expenses", label: "فواتير المصاريف", icon: WalletCards },
  { id: "records", label: "سجل الفواتير", icon: ReceiptText },
];
const warehouseNav: Array<{ id: View; label: string; icon: typeof Boxes }> = [
  { id: "warehouseAdmin", label: "إدارة المخازن", icon: Boxes },
  { id: "warehouses", label: "جرد المخازن", icon: Boxes },
  { id: "transfers", label: "التحويلات بين المخازن", icon: ArrowLeftRight },
  { id: "adjustments", label: "تصحيح المخزون", icon: ClipboardCheck },
];
const bankNav: Array<{ id: BankTab; label: string }> = [
  { id: "accounts", label: "وسائل الدفع" }, { id: "movements", label: "حركة الحسابات" },
  { id: "transfers", label: "التحويلات" }, { id: "adjustment", label: "السحب والإيداع" },
];
const reportOrder: ReportType[] = ["sales", "purchases", "product-sales", "stock", "debts", "party-ledger", "financial", "expenses", "overview"];
const NO_ACCESS_TITLE = "لا تملك صلاحية الوصول";
export const MAIN_NAV_ORDER = ["pos", "invoices", "warehouses", "products", "parties", "banks", "reports", "settings"] as const;
const val = (v: string) => (v === "" ? 0 : Number(v)),
  lineFor = (p: Product): DraftLine => ({
    productId: p.id,
    quantity: "1",
    piecePrice: String(p.piecePrice ?? 0),
    unitPrice: String(p.pieceCost ?? 0),
    actualQuantity: "",
  });

export type MoneyTone = "positive" | "negative" | "neutral";
export function MoneyValue({value,tone="neutral",className=""}:{value:number;tone?:MoneyTone;className?:string}) {
  return <span className={`financial-amount money-${tone} ${className}`.trim()}>{money(value)}</span>;
}

function PermissionNavItem({allowed,active,onClick,className="",children}:{allowed:boolean;active:boolean;onClick:()=>void;className?:string;children:ReactNode}) {
  return <button disabled={!allowed} aria-disabled={!allowed?"true":undefined} title={!allowed?NO_ACCESS_TITLE:undefined} className={`${className}${allowed&&active?`${className?" ":""}active`:""}`} onClick={onClick}>{children}</button>;
}

export default function ContaApp() {
  useHoverEnterActivation();
  const [data, setData] = useState<BootstrapData>(empty),
    [view, setView] = useState<View>("pos"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [menu, setMenu] = useState(false),
    [invoiceMenu, setInvoiceMenu] = useState(false),
    [warehouseMenu, setWarehouseMenu] = useState(false),
    [reportMenu, setReportMenu] = useState(false),
    [partyMenu, setPartyMenu] = useState(false),
    [bankMenu, setBankMenu] = useState(false),
    [settingsMenu, setSettingsMenu] = useState(false),
    [bankTab, setBankTab] = useState<BankTab>("accounts"),
    [settingsTab, setSettingsTab] = useState<SettingsTab>("general"),
    [licenseStatus,setLicenseStatus]=useState<LicenseStatus|null>(null),
    [reportType, setReportType] = useState<ReportType>("sales"),
    [doc, setDoc] = useState<DocumentRecord | null>(null),
    [saleEditRequest, setSaleEditRequest] = useState<string | null>(null),
    [purchaseEditRequest, setPurchaseEditRequest] = useState<string | null>(null),
    [autoPrintId, setAutoPrintId] = useState<string | null>(null),
    [partyDetail, setPartyDetail] = useState<Party | null>(null),
    [adjustmentPrefill, setAdjustmentPrefill] = useState<AdjustmentPrefill | null>(null);
  const warehouseMenuRef = useRef<HTMLDivElement>(null);
  const invoiceMenuRef = useRef<HTMLDivElement>(null);
  const reportMenuRef = useRef<HTMLDivElement>(null);
  const partyMenuRef = useRef<HTMLDivElement>(null);
  const bankMenuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null), dialogOpenerRef = useRef<HTMLElement | null>(null);
  const can=(capability:string)=>data.principal.principalType==="owner"||data.principal.permissions.includes(capability);
  const settingsAllowed=(target:SettingsTab)=>target==="license"||target==="contact"||can("settings.view")&&(target==="general"||(target==="users"?can("settings.users.manage"):can("settings.backup.manage")||can("settings.legacy.import")));
  const viewCapability:Record<View,string>={pos:"pos.view",purchases:"purchases.view",expenses:"expenses.view",customers:"customers.view",suppliers:"suppliers.view",warehouses:"warehouses.inventory.view",warehouseAdmin:"warehouses.view",transfers:"warehouses.transfer",adjustments:"warehouses.adjust",products:"products.view",records:"records.view",reports:"reports.view",banks:"banks.view",settings:"settings.view"};
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!warehouseMenuRef.current?.contains(event.target as Node)) setWarehouseMenu(false);
      if (!invoiceMenuRef.current?.contains(event.target as Node)) setInvoiceMenu(false);
      if (!reportMenuRef.current?.contains(event.target as Node)) setReportMenu(false);
      if (!partyMenuRef.current?.contains(event.target as Node)) setPartyMenu(false);
      if (!bankMenuRef.current?.contains(event.target as Node)) setBankMenu(false);
      if (!settingsMenuRef.current?.contains(event.target as Node)) setSettingsMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const navigate = (id: View) => {
    if (!can(viewCapability[id])) return;
    if (id !== "adjustments") setAdjustmentPrefill(null);
    setView(id); setDoc(null); setPartyDetail(null); setMenu(false); setWarehouseMenu(false); setInvoiceMenu(false); setReportMenu(false); setPartyMenu(false); setBankMenu(false); setSettingsMenu(false);
  };
  const closeNavigationMenus = () => { setWarehouseMenu(false); setInvoiceMenu(false); setReportMenu(false); setPartyMenu(false); setBankMenu(false); setSettingsMenu(false); };
  const navigationKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { closeNavigationMenus(); (event.target as HTMLElement).closest<HTMLElement>(".nav-menu")?.querySelector<HTMLButtonElement>(":scope > button")?.focus(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")], current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault(); buttons[(current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  const openStockAdjustment = (prefill: AdjustmentPrefill) => {
    setAdjustmentPrefill(prefill);
    navigate("adjustments");
  };
  async function reload(options: { blocking?: boolean } = {}) {
    const blocking = options.blocking ?? true;
    if (blocking) setLoading(true);
    try {
      const statusResponse=await fetch("/api/license/status"),status=await statusResponse.json() as LicenseStatus;
      if(!statusResponse.ok)throw new Error((status as {error?:string}).error??"تعذر التحقق من الترخيص");
      setLicenseStatus(status);
      if(!status.valid){setSettingsTab("license");setView("settings");setError("");return}
      const r = await fetch("/api/bootstrap");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j);
      const permitted=(id:View)=>j.principal.principalType==="owner"||j.principal.permissions.includes(viewCapability[id]);
      if(!permitted(view)){const first=(["pos","purchases","records","products","customers","suppliers","warehouses","expenses","banks","reports","settings"] as View[]).find(permitted);if(first)setView(first)}
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل البيانات");
    } finally {
      if (blocking) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void reload({ blocking: true }), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const inFlightCommands = useRef(new Map<string, Promise<unknown>>());
  async function run(body: Record<string, unknown>, message: string, afterSuccess?: () => void) {
    const fingerprint=JSON.stringify(body), existing=inFlightCommands.current.get(fingerprint);
    if(existing)return existing as ReturnType<RunCommand>;
    const operation=(async()=>{setError("");const r=await fetch("/api/command",{method:"POST",headers:{"content-type":"application/json","Idempotency-Key":crypto.randomUUID()},body:JSON.stringify(body)}),j=await r.json();if(!r.ok){setError(j.error??"تعذر تنفيذ العملية");throw new Error(j.error)}setNotice(message);window.setTimeout(()=>setNotice(""),2600);await finishSuccessfulCommand(afterSuccess,()=>reload({blocking:false}));return j.disposition?j:j.id as string})();
    inFlightCommands.current.set(fingerprint,operation);
    try{return await operation as Awaited<ReturnType<RunCommand>>}finally{inFlightCommands.current.delete(fingerprint)}
  }
  const openDoc = (id: string) => {
    const found = data.documents.find((x) => x.id === id);
    if (found) { dialogOpenerRef.current = document.activeElement as HTMLElement; setDoc(found); }
  };
  const closeDoc = () => { setDoc(null); window.requestAnimationFrame(() => dialogOpenerRef.current?.focus()); };
  useEffect(() => { if (doc) window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("button, input, select, textarea, [tabindex='0']")?.focus()); }, [doc]);
  const editInvoice = (id: string) => {
    const document = data.documents.find(item => item.id === id);
    if (!document || document.status !== "posted" || document.legacyKey || !["sale", "purchase"].includes(document.kind)) { openDoc(id); return; }
    setDoc(null); setPartyDetail(null);
    if (document.kind === "sale") { setSaleEditRequest(id); setView("pos"); }
    else { setPurchaseEditRequest(id); setView("purchases"); }
  };
  useEffect(() => {
    if (!autoPrintId || !data.documents.some(document => document.id === autoPrintId)) return;
    const root = window.document.documentElement, timer = window.setTimeout(() => {
      root.classList.add("print-document-mode"); window.print(); root.classList.remove("print-document-mode"); setAutoPrintId(null);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [autoPrintId, data.documents]);
  if(!loading&&licenseStatus&&!licenseStatus.valid)return <div className="unlicensed-shell" dir="rtl"><div className="unlicensed-session"><form action="/api/auth/logout" method="post"><button className="soft" type="submit"><LogOut/> خروج</button></form></div><SupportLicensePage initialStatus={licenseStatus} onActivated={()=>reload({blocking:true})}/></div>;
  return (
    <div className={`app-shell section-${view}`} dir="rtl">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="brand-logo"><img src={APP_LOGO_PATH} alt={APP_LOGO_ALT}/></div>
          <div>
            <strong>{APP_NAME}</strong>
            <span>{APP_TAGLINE}</span>
          </div>
          <button className="icon mobile" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav aria-label="التنقل الرئيسي" onKeyDown={navigationKeyDown}>
          {nav.slice(0,1).map(n=><PermissionNavItem key={n.id} allowed={can(viewCapability[n.id])} active={view===n.id} className="nav" onClick={()=>navigate(n.id)}><n.icon/><span>{n.label}</span></PermissionNavItem>)}
          <div className="nav-menu" ref={invoiceMenuRef}><button className={invoiceNav.some(n=>n.id===view)?"nav active":"nav"} aria-expanded={invoiceMenu} onClick={()=>setInvoiceMenu(x=>!x)}><ReceiptText/><span>الفواتير</span><ChevronDown className="chevron"/></button>{invoiceMenu&&<div className="nav-popover">{invoiceNav.map(n=><PermissionNavItem key={n.id} allowed={can(viewCapability[n.id])} active={view===n.id} onClick={()=>navigate(n.id)}><span>{n.label}</span></PermissionNavItem>)}</div>}</div>
          <div className="nav-menu" ref={warehouseMenuRef}><button className={warehouseNav.some(n=>n.id===view)?"nav active":"nav"} aria-expanded={warehouseMenu} onClick={()=>setWarehouseMenu(x=>!x)}><Boxes/><span>المخازن</span><ChevronDown className="chevron"/></button>{warehouseMenu&&<div className="nav-popover">{warehouseNav.map(n=><PermissionNavItem key={n.id} allowed={can(viewCapability[n.id])} active={view===n.id} onClick={()=>navigate(n.id)}><span>{n.label}</span></PermissionNavItem>)}</div>}</div>
          <div className="nav-menu party-nav-menu" ref={partyMenuRef}><button className={partyNav.some(item=>item.id===view)?"nav active":"nav"} aria-expanded={partyMenu} onClick={()=>setPartyMenu(value=>!value)}><Users/><span>العملاء والموردون</span><ChevronDown className="chevron"/></button>{partyMenu&&<div className="nav-popover party-nav-popover">{partyNav.map(item=><PermissionNavItem key={item.id} allowed={can(viewCapability[item.id])} active={view===item.id} onClick={()=>navigate(item.id)}><span>{item.label}</span></PermissionNavItem>)}</div>}</div>
          {nav.slice(1).filter(n=>n.id!=="reports"&&n.id!=="settings"&&n.id!=="banks").map(n=><PermissionNavItem key={n.id} allowed={can(viewCapability[n.id])} active={view===n.id} className="nav" onClick={()=>navigate(n.id)}><n.icon/><span>{n.label}</span></PermissionNavItem>)}
          <div className="nav-menu bank-nav-menu" ref={bankMenuRef}><button className={view==="banks"?"nav active":"nav"} aria-expanded={bankMenu} onClick={()=>setBankMenu(open=>!open)}><Landmark/><span>البنوك</span><ChevronDown className="chevron"/></button>{bankMenu&&<div className="nav-popover bank-nav-popover">{bankNav.map(item=><PermissionNavItem key={item.id} allowed={can("banks.view")} active={view==="banks"&&bankTab===item.id} onClick={()=>{setBankTab(item.id);navigate("banks")}}><span>{item.label}</span></PermissionNavItem>)}</div>}</div>
          <div className="nav-menu report-nav-menu" ref={reportMenuRef}><button className={view==="reports"?"nav active":"nav"} aria-expanded={reportMenu} onClick={()=>setReportMenu(value=>!value)}><Receipt/><span>التقارير</span><ChevronDown className="chevron"/></button>{reportMenu&&<div className="nav-popover report-nav-popover">{reportOrder.map(id=><PermissionNavItem key={id} allowed={can("reports.view")} active={view==="reports"&&reportType===id} onClick={()=>{setReportType(id);navigate("reports")}}><span>{reportNames[id]}</span></PermissionNavItem>)}</div>}</div>
          <div className="nav-menu settings-nav-menu" ref={settingsMenuRef}><button className={view==="settings"?"nav active":"nav"} aria-expanded={settingsMenu} onClick={()=>setSettingsMenu(value=>!value)}><SettingsIcon/><span>الإعدادات</span><ChevronDown className="chevron"/></button>{settingsMenu&&<div className="nav-popover">{([{id:"general",label:"إعدادات عامة"},{id:"users",label:"المستخدمون والصلاحيات"},{id:"data",label:"البيانات والنسخ الاحتياطي"},{id:"license",label:"رخصة التفعيل"},{id:"contact",label:"تواصل مع الدعم"}] as Array<{id:SettingsTab;label:string}>).map(item=><PermissionNavItem key={item.id} allowed={settingsAllowed(item.id)} active={view==="settings"&&settingsTab===item.id} onClick={()=>{setSettingsTab(item.id);if(item.id==="license"||item.id==="contact"){setView("settings");setSettingsMenu(false)}else navigate("settings")}}><span>{item.label}</span></PermissionNavItem>)}</div>}</div>
        </nav>
        <div className="account-session">
          <strong>{data.principal.name}</strong>
          <form action="/api/auth/logout" method="post"><button className="logout-button" type="submit" aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut aria-hidden="true"/><span>خروج</span></button></form>
        </div>
      </aside>
      <main>
        {autoPrintId && <PrintableDocument document={data.documents.find(document => document.id === autoPrintId)!} data={data} />}
        <header className="page-bar">
          <button className="icon mobile" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          {partyDetail?<button className="page-title-back" onClick={()=>setPartyDetail(null)}><h1>{resolvePartyType(partyDetail)==="customer"?"العملاء":"الموردون"}</h1></button>:<h1>{[...nav, ...invoiceNav, ...warehouseNav, ...partyNav].find((n) => n.id === view)?.label}</h1>}
          <button className="icon refresh" title="تحديث البيانات" aria-label="تحديث البيانات" onClick={() => void reload()}><RefreshCw /></button>
        </header>
        <div className="content">
          {notice && <div className="toast">{notice}</div>}
          {error && <div className="error">{error}</div>}
          {loading ? (
            <div className="loading">جاري تحميل السجلات…</div>
          ) : partyDetail ? (
            <PartyPage
              party={
                data.parties.find((p) => p.id === partyDetail.id) ?? partyDetail
              }
              data={data}
              openDoc={openDoc}
              run={run}
            />
          ) : (
            <>
              {view === "pos" && (
                <Pos data={data} run={run} openDoc={openDoc} editRequest={saleEditRequest} clearEditRequest={() => setSaleEditRequest(null)} requestPrint={setAutoPrintId} openStockAdjustment={openStockAdjustment} />
              )}{" "}
              {view === "purchases" && (
                <Purchases data={data} run={run} openDoc={openDoc} editRequest={purchaseEditRequest} clearEditRequest={() => setPurchaseEditRequest(null)} requestPrint={setAutoPrintId} />
              )}{" "}
              {view === "expenses" && (
                <Expenses data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {(view === "customers" || view === "suppliers") && (
                <Parties partyType={view === "customers" ? "customer" : "supplier"} data={data} run={run} openParty={setPartyDetail} />
              )}{" "}
              {view === "products" && <Products data={data} run={run} />}{" "}
              {view === "warehouseAdmin" && <WarehouseAdmin data={data} run={run} canDelete={can("warehouses.delete")} />} {view === "warehouses" && (
                <Warehouses data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "transfers" && (
                <Transfer data={data} run={run} openDoc={openDoc} />
              )}{" "}
              {view === "adjustments" && (
                <Adjustment data={data} run={run} openDoc={openDoc} prefill={adjustmentPrefill} clearPrefill={() => setAdjustmentPrefill(null)} />
              )}{" "}
              {view === "records" && <Records data={data} openDoc={openDoc} />}{" "}
              {view === "reports" && (
                <Reports key={reportType} data={data} openDoc={openDoc} type={reportType} />
              )}{" "}
              {view === "banks" && <Banks data={data} run={run} openDoc={openDoc} tab={bankTab} />}{" "}
              {view === "settings" && <SettingsPage data={data} reload={reload} tab={settingsTab} />}{" "}
            </>
          )}
          {doc && <div className="modal-overlay" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`سجل المعاملة ${doc.number}`} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeDoc(); } else if (event.key === "Tab") { const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]; if (controls.length && ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls.at(-1)))) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); } } }}><div className="official-document-viewer"><DocumentDetail document={doc} data={data} close={closeDoc} onEdit={doc.status === "posted" && !doc.legacyKey && (doc.kind === "sale" ? can("pos.edit") : doc.kind === "purchase" ? can("purchases.edit") : false) ? () => editInvoice(doc.id) : undefined} /></div></div>}
        </div>
      </main>
    </div>
  );
}

type PreviewGroup = {key:string;label:string;count:number;created:number;matched:number;review:number;skipped:number;unsupported:number};
type FilePreview = { format:string;uploadId?:string;source?:{filename?:string;fingerprint?:string};schemaVersion?:number;createdAt?:string;counts?:Record<string,number>;groups?:PreviewGroup[];unknownGroups?:Array<{key:string;label:string;count:number;reason:string;manualMappingSupported:boolean}>;warnings?:string[];criticalConflicts?:number };
type ImportRun = {importRunId:string;sourceType?:string;filename?:string;state:string;phase:string;progress?:{processed:number;total:number;label:string};counts?:Record<string,{processed:number;created:number;existing:number;skipped:number}>;reviewCount?:number;backupIdBeforeImport?:string;startedAt?:string;completedAt?:string;publicError?:string};
type ManagedUser={id:string;name:string;username:string;isActive:boolean;permissions:string[];owner?:boolean};
function UsersPermissions() {
  const [users,setUsers]=useState<ManagedUser[]>([]),[editing,setEditing]=useState<ManagedUser|null>(null);
  const [username,setUsername]=useState(""),[password,setPassword]=useState(""),[active,setActive]=useState(true),[permissions,setPermissions]=useState<string[]>([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[loadError,setLoadError]=useState(""),[error,setError]=useState(""),[success,setSuccess]=useState("");
  const select=useCallback((user:ManagedUser|null)=>{setEditing(user);setUsername(user?.username??"");setPassword("");setActive(user?.isActive??true);setPermissions(user?.permissions??[]);setError("");setSuccess("")},[]);
  const load=useCallback(async(selectedId?:string)=>{setLoading(true);setLoadError("");try{const value=await readApiResponse(await fetch("/api/settings/users")) as {users:ManagedUser[]};setUsers(value.users);if(selectedId){const selected=value.users.find(user=>user.id===selectedId);if(selected)select(selected)}return value.users}catch(reason){setLoadError(reason instanceof Error?reason.message:"تعذر تحميل المستخدمين");return null}finally{setLoading(false)}},[select]);
  useEffect(()=>{const timeout=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timeout)},[load]);
  const save=async()=>{setSaving(true);setError("");setSuccess("");try{const isEditing=!!editing;const response=await fetch(isEditing?`/api/settings/users/${editing.id}`:"/api/settings/users",{method:isEditing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password,...(isEditing?{isActive:active}:{}),permissions})});const result=await readApiResponse(response) as {user?:ManagedUser};const selectedId=editing?.id??result.user?.id;if(!selectedId)throw new Error("تم الحفظ لكن تعذر تحديد المستخدم");const refreshed=await load(selectedId);if(!refreshed)throw new Error("تم الحفظ، لكن تعذر تحديث قائمة المستخدمين");setSuccess(isEditing?"تم حفظ تعديلات المستخدم":"تم إنشاء المستخدم بنجاح")}catch(reason){setError(reason instanceof Error?reason.message:"تعذر الحفظ")}finally{setSaving(false)}};
  const remove=async(user:ManagedUser)=>{if(!confirm("هل تريد حذف هذا المستخدم؟"))return;setError("");try{const result=await readApiResponse(await fetch(`/api/settings/users/${user.id}`,{method:"DELETE"})) as {logoutRequired?:boolean};if(result.logoutRequired){await fetch("/api/auth/logout",{method:"POST"});window.location.assign("/login");return}if(editing?.id===user.id)select(null);await load();setSuccess("تم حذف المستخدم")}catch(reason){setError(reason instanceof Error?reason.message:"تعذر حذف المستخدم")}};
  const actionLabels:Record<PermissionAction,string>={view:"عرض",create:"إضافة",edit:"تعديل",delete:"حذف"};
  const everythingSelected=allPermissions.every(permission=>permissions.includes(permission));
  return <FramedSection title="المستخدمون والصلاحيات" className="users-permissions">
    <div className="users-permissions-layout">
      <fieldset className="permissions-pane"><legend>صلاحيات المستخدم</legend><div className="permission-toolbar"><span>اختر الصلاحيات الفعلية المطلوبة</span><button className="soft" type="button" disabled={editing?.owner===true} onClick={()=>setPermissions(everythingSelected?[]:[...allPermissions])}>{everythingSelected?"إلغاء الكل":"تحديد الكل"}</button></div><div className="permissions-grid"><table className="erp-table"><thead><tr><th>رقم</th><th>اسم الشاشة</th>{(["view","create","edit","delete"] as PermissionAction[]).map(action=><th key={action}>{actionLabels[action]}</th>)}<th>تحكم كامل</th></tr></thead><tbody>{permissionRows.map((row,i)=>{const keys=Object.values(row.actions),full=keys.every(key=>permissions.includes(key));return <tr key={row.name}><td>{number(i+1)}</td><td>{row.name}</td>{(["view","create","edit","delete"] as PermissionAction[]).map(action=>{const key=row.actions[action];return <td key={action}>{key&&<input aria-label={`${row.name} ${actionLabels[action]}`} type="checkbox" disabled={editing?.owner===true} checked={permissions.includes(key)} onChange={event=>setPermissions(setPermission(permissions,key,event.target.checked))}/>}</td>})}<td><input aria-label={`${row.name} تحكم كامل`} type="checkbox" disabled={editing?.owner===true} checked={full} onChange={event=>setPermissions(setRowFullControl(permissions,keys,event.target.checked))}/></td></tr>})}</tbody></table></div></fieldset>
      <aside className="user-admin-pane">
        <fieldset className="user-details-form"><legend>بيانات المستخدم</legend><div className="user-mode"><strong>{editing?"تعديل المستخدم":"مستخدم جديد"}</strong>{editing&&<span>{editing.username}</span>}</div><div className="user-fields"><label>اسم المستخدم<input dir="ltr" value={username} required disabled={editing?.owner===true} autoComplete="off" onChange={event=>setUsername(event.target.value)}/></label><label>{editing?"كلمة المرور الجديدة (اختياري)":"كلمة المرور"}<input type="password" value={password} minLength={4} autoComplete="new-password" placeholder={editing?"اتركها فارغة للاحتفاظ بكلمة المرور الحالية":"4 أحرف على الأقل"} onChange={event=>setPassword(event.target.value)}/></label></div><div className="user-actions"><button className="soft" type="button" onClick={()=>select(null)}>مستخدم جديد</button><button className="primary" type="button" disabled={saving||!username.trim()||(!editing&&password.length<4)||(!!password&&password.length<4)} onClick={()=>void save()}>{saving?"جاري الحفظ…":"حفظ المستخدم"}</button>{editing&&<button className={active?"status-disable":"soft"} type="button" onClick={()=>setActive(value=>!value)}>{active?"تعطيل المستخدم":"تفعيل المستخدم"}</button>}</div>{error&&<div className="error" role="alert">{error}</div>}{success&&<div className="success" role="status">{success}</div>}</fieldset>
        <fieldset className="users-list"><legend>قائمة المستخدمين</legend><div className="users-list-scroll"><table className="erp-table"><thead><tr><th>رقم</th><th>اسم المستخدم</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{loading?<tr><td colSpan={4}>جاري تحميل المستخدمين…</td></tr>:loadError?<tr className="users-load-error"><td colSpan={4}>تعذر تحميل المستخدمين: {loadError} <button className="soft" onClick={()=>void load()}>إعادة المحاولة</button></td></tr>:users.length===0?<tr><td colSpan={4}>لا يوجد مستخدمون بعد</td></tr>:users.map((user,i)=><tr className={editing?.id===user.id?"selected":""} key={user.id}><td>{number(i+1)}</td><td dir="ltr">{user.username}</td><td><span className={user.isActive?"user-status active":"user-status"}>{user.isActive?"مفعل":"معطل"}</span></td><td><button className="soft" onClick={()=>select(user)}>تعديل</button> <button className="danger" onClick={()=>void remove(user)}>حذف</button></td></tr>)}</tbody></table></div></fieldset>
      </aside>
    </div>
  </FramedSection>
}
function GeneralSettings({data,reload}:{data:BootstrapData;reload:()=>Promise<void>}) {
  const [branding,setBranding]=useState(data.branding),[saving,setSaving]=useState(false),[notice,setNotice]=useState("");
  const canBrand=data.principal.principalType==="owner"||data.principal.permissions.includes("settings.branding.manage");
  const dirty=JSON.stringify(branding)!==JSON.stringify(data.branding);
  const save=async()=>{setSaving(true);setNotice("");try{if(canBrand&&dirty)await readApiResponse(await fetch("/api/settings/branding",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(branding)}));await reload();setNotice("تم حفظ الإعدادات")}catch(error){setNotice(error instanceof Error?error.message:"تعذر الحفظ")}finally{setSaving(false)}};
  return <div className="general-settings">
    <FramedSection title="بيانات النشاط"><div className="business-settings-fields"><label>اسم المحل<input required maxLength={80} disabled={!canBrand} value={branding.storeName} onChange={e=>setBranding({...branding,storeName:e.target.value})}/></label><label>رقم الهاتف<input maxLength={40} disabled={!canBrand} value={branding.storePhone} onChange={e=>setBranding({...branding,storePhone:e.target.value})}/></label><label className="business-address">العنوان<input maxLength={160} disabled={!canBrand} value={branding.storeAddress} onChange={e=>setBranding({...branding,storeAddress:e.target.value})}/></label><label>رقم السجل التجاري<input maxLength={60} disabled={!canBrand} value={branding.registrationNumber} onChange={e=>setBranding({...branding,registrationNumber:e.target.value})}/></label><label>الرقم الضريبي<input maxLength={60} disabled={!canBrand} value={branding.taxNumber} onChange={e=>setBranding({...branding,taxNumber:e.target.value})}/></label></div></FramedSection>
    <FramedSection title="هوية المستندات" className="branding-settings"><div className="branding-fields"><label>نوع الخط<select value={branding.nameFont} disabled={!canBrand} onChange={e=>setBranding({...branding,nameFont:e.target.value as typeof branding.nameFont})}><option value="tahoma">Tahoma — تاهوما</option><option value="arial">Arial — أريال</option><option value="segoe-ui">Segoe UI</option><option value="times-new-roman">Times New Roman</option></select></label><label>حجم اسم المحل<input type="number" min="16" max="32" value={branding.nameFontSize} disabled={!canBrand} onChange={e=>setBranding({...branding,nameFontSize:Number(e.target.value)})}/></label><label>سماكة الخط<select value={branding.nameFontWeight} disabled={!canBrand} onChange={e=>setBranding({...branding,nameFontWeight:Number(e.target.value) as 400|600|800})}><option value="400">عادي</option><option value="600">متوسط</option><option value="800">عريض</option></select></label></div><div className="branding-preview"><strong style={{fontFamily:invoiceFontFamilies[branding.nameFont],fontSize:`${branding.nameFontSize}pt`,fontWeight:branding.nameFontWeight}}>{branding.storeName||"اسم المحل"}</strong><b>فاتورة بيع</b><span>رقم 000</span></div></FramedSection>
    <FramedSection title="معلومات المستند" className="document-info-settings"><label>ملاحظة التذييل<textarea maxLength={160} disabled={!canBrand} value={branding.footerNote} onChange={e=>setBranding({...branding,footerNote:e.target.value})}/></label></FramedSection>
    {canBrand&&<button className="primary settings-save" disabled={saving||!dirty||!branding.storeName.trim()} onClick={()=>void save()}>{saving?"جاري الحفظ…":"حفظ الإعدادات"}</button>}{notice&&<div className={notice==="تم حفظ الإعدادات"?"success":"error"}>{notice}</div>}
  </div>;
}

function DataSettings({data,reload}:{data:BootstrapData;reload:()=>Promise<void>}) {
  const canBackup=data.principal.principalType==="owner"||data.principal.permissions.includes("settings.backup.manage"),canImport=data.principal.principalType==="owner"||data.principal.permissions.includes("settings.legacy.import");
  const [selectedFile,setSelectedFile]=useState<File|null>(null),[nativePreview,setNativePreview]=useState<FilePreview|null>(null),[externalPreview,setExternalPreview]=useState<FilePreview|null>(null),[importRun,setImportRun]=useState<ImportRun|null>(null),[stockPolicy,setStockPolicy]=useState("keep-current"),[accountPolicy,setAccountPolicy]=useState("keep-current"),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[failure,setFailure]=useState("");
  const request=async(url:string,file:File)=>readApiResponse(await fetch(url,{method:"POST",headers:{"content-type":file.type||"application/octet-stream"},body:file}));
  const uploadExternal=async(file:File)=>{const started=await readApiResponse(await fetch("/api/settings/legacy/upload/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({size:file.size})})),uploadId=String(started.uploadId),chunkSize=Number(started.chunkSize);for(let index=0,offset=0;offset<file.size;index++,offset+=chunkSize)await readApiResponse(await fetch(`/api/settings/legacy/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,{method:"POST",headers:{"content-type":"application/octet-stream"},body:file.slice(offset,offset+chunkSize)}));return readApiResponse(await fetch("/api/settings/legacy/upload/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uploadId,action:"preview",filename:file.name})}));};
  const download=async()=>{const response=await fetch("/api/settings/backup");if(!response.ok)throw new Error("تعذر إنشاء النسخة");const blob=await response.blob(),link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=response.headers.get("content-disposition")?.match(/filename="([^"]+)/)?.[1]??"conta-backup.conta.json";link.click();URL.revokeObjectURL(link.href);};
  const chooseFile=async(file:File|null)=>{setSelectedFile(file);setNativePreview(null);setExternalPreview(null);setImportRun(null);setFailure("");if(!file)return;setBusy("inspect");try{if(file.name.endsWith(".json")){setNativePreview(await request("/api/settings/restore/preview",file) as FilePreview)}else{setExternalPreview(await uploadExternal(file) as FilePreview)}}catch(e){setFailure(e instanceof Error?e.message:"تعذر فحص المصدر")}finally{setBusy("")}};
  const restore=async()=>{if(!selectedFile||!nativePreview||!confirm("هذه استعادة كاملة وستستبدل بيانات الكرنه الحالية. هل تريد المتابعة؟"))return;setBusy("restore");setFailure("");try{await download();await request("/api/settings/restore",selectedFile);setMessage("تمت الاستعادة الكاملة وإنشاء نسخة أمان للحالة السابقة");await reload()}catch(e){setFailure(e instanceof Error?e.message:"تعذرت الاستعادة")}finally{setBusy("")}};
  const advance=async(run:ImportRun)=>{let current=run;while(current.state!=="completed"){await new Promise(resolve=>setTimeout(resolve,350));current=await readApiResponse(await fetch(`/api/settings/legacy/import-runs/${encodeURIComponent(current.importRunId)}/advance`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"})) as ImportRun;setImportRun(current);if(current.state==="failed")throw new Error(current.publicError||`تعذر الاستيراد. رقم العملية: ${current.importRunId}`)}return current};
  const importExternal=async()=>{if(!externalPreview?.uploadId)return;setBusy("import");setFailure("");try{let run=await readApiResponse(await fetch("/api/settings/legacy/upload/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({uploadId:externalPreview.uploadId,action:"import",stockPolicy,accountBalancePolicy:accountPolicy,filename:selectedFile?.name})})) as ImportRun;setImportRun(run);run=await advance(run);setMessage(`تم الدمج بأمان. نسخة الرجوع: ${run.backupIdBeforeImport}`);await reload()}catch(e){setFailure(e instanceof Error?e.message:"تعذر الاستيراد")}finally{setBusy("")}};

  return <div className={`settings-utility-row${selectedFile?" has-import-details":""}`}>
    <FramedSection title="النسخ الاحتياطي" className="settings-backup"><div><button className="primary" disabled={!!busy||!canBackup} title={!canBackup?NO_ACCESS_TITLE:undefined} onClick={()=>{setBusy("backup");download().then(()=>setMessage("تم إنشاء النسخة وتنزيلها")).catch(e=>setFailure(e.message)).finally(()=>setBusy(""))}}>{busy==="backup"?"جاري الإنشاء…":"إنشاء وتنزيل"}</button></div></FramedSection>
    <FramedSection title="الاستعادة والاستيراد" className="settings-import"><div className="import-head"><label className="file-button">اختيار ملف<input type="file" disabled={!canBackup&&!canImport} title={!canBackup&&!canImport?NO_ACCESS_TITLE:undefined} accept=".json,.conta.json,.db,.sqlite,application/json,application/vnd.sqlite3" onChange={e=>void chooseFile(e.target.files?.[0]??null)}/></label></div>
      {selectedFile&&<div className="import-details"><ol className="import-steps"><li className={selectedFile?"done":"active"}>1 فحص الملف</li><li className={externalPreview?"done":""}>2 المطابقة</li><li className={externalPreview?.criticalConflicts?"active":""}>3 مراجعة التعارضات</li><li className={externalPreview?"done":""}>4 المعاينة النهائية</li><li className={importRun?"active":""}>5 الاستيراد</li></ol>
      {busy==="inspect"&&<div className="loading-line">جاري فحص الملف دون تعديل البيانات…</div>}
      {nativePreview&&<div className="source-preview"><div><b>نوع الملف: نسخة الكرنه v{nativePreview.schemaVersion}</b><small>{nativePreview.createdAt&&formatDateTime(nativePreview.createdAt)}</small></div><div className="preview-count-grid">{Object.entries(nativePreview.counts??{}).map(([k,v])=><span key={k}>{k}<b>{number(v)}</b></span>)}</div><button className="danger" disabled={!!busy||!canBackup} title={!canBackup?NO_ACCESS_TITLE:undefined} onClick={()=>void restore()}>{busy==="restore"?"جاري الاستعادة…":"استعادة كاملة"}</button></div>}
      {externalPreview&&<div className="source-preview"><div className="preview-heading"><div><b>نوع الملف: DataAcc SQLite</b><small>{selectedFile?.name}</small></div><span className="merge-badge">دمج آمن</span></div><div className="match-table"><div className="match-row match-head"><b>المجموعة</b><b>الإجمالي</b><b>جديد</b><b>مطابق</b><b>مراجعة</b></div>{externalPreview.groups?.filter(g=>g.count>0).map(g=><div className="match-row" key={g.key}><strong>{g.label}</strong><span>{number(g.count)}</span><span className="status-ready">{number(g.created)}</span><span>{number(g.matched)}</span><span className={g.review?"status-review":""}>{number(g.review)}</span></div>)}</div>
        {!!externalPreview.unknownGroups?.length&&<div className="review-groups"><strong>بيانات محفوظة للمراجعة ولا تعطل الاستيراد</strong>{externalPreview.unknownGroups.map(g=><div key={g.key}><span>{g.label} — <b>{number(g.count)}</b></span><small>{g.reason} {g.manualMappingSupported&&"يمكن تعيين أعمدتها يدويًا في إصدار لاحق."}</small></div>)}</div>}
        <div className="policy-row"><label>تعارض المخزون<select value={stockPolicy} onChange={e=>setStockPolicy(e.target.value)}><option value="keep-current">الاحتفاظ برصيد الكرنه</option><option value="use-imported">استخدام الرصيد المستورد</option><option value="manual-resolution">حل يدوي</option></select></label><label>تعارض رصيد الحساب<select value={accountPolicy} onChange={e=>setAccountPolicy(e.target.value)}><option value="keep-current">الاحتفاظ برصيد الكرنه</option><option value="use-imported">استخدام الرصيد المستورد</option><option value="adjustment">تسجيل Adjustment بالفرق</option></select></label></div>
        <div className="final-actions"><small>سيتم إنشاء نسخة أمان تلقائية قبل أول مرحلة دمج. لن تُجمع الأرصدة أو كميات المخزون.</small><button className="primary" disabled={!!busy||!canImport||stockPolicy==="manual-resolution"||!!externalPreview.criticalConflicts} title={!canImport?NO_ACCESS_TITLE:undefined} onClick={()=>void importExternal()}>{busy==="import"?"جاري الاستيراد…":"تنفيذ الاستيراد"}</button></div></div>}
      {importRun&&<div className="run-progress"><strong>{importRun.state==="completed"?"اكتملت العملية":importRun.state==="failed"?"توقفت العملية ويمكن إعادة المحاولة":`استيراد ${importRun.progress?.label??"البيانات"}`}</strong><span>{number(importRun.progress?.processed??0)} / {number(importRun.progress?.total??0)}</span><small>رقم العملية: {importRun.importRunId}</small></div>}</div>}
    </FramedSection>
    {(message||failure)&&<div className="settings-feedback">{message&&<div className="success">{message}</div>}{failure&&<div className="error">{failure}</div>}</div>}
  </div>;
}

function SettingsPage({data,reload,tab}:{data:BootstrapData;reload:()=>Promise<void>;tab:SettingsTab}) {
  const allowed=(target:SettingsTab)=>target==="license"||target==="contact"||target==="general"?true:target==="users"?(data.principal.principalType==="owner"||data.principal.permissions.includes("settings.users.manage")):(data.principal.principalType==="owner"||data.principal.permissions.some(permission=>["settings.backup.manage","settings.legacy.import"].includes(permission)));
  return <section className="settings-page">{tab==="general"&&<GeneralSettings data={data} reload={reload}/>} {tab==="users"&&allowed("users")&&<UsersPermissions/>} {tab==="data"&&allowed("data")&&<DataSettings data={data} reload={reload}/>} {tab==="license"&&<SupportLicensePage onActivated={reload}/>} {tab==="contact"&&<SupportContactPage/>}</section>;
}

function SupportContactPage(){
  return <section className="support-contact" aria-labelledby="support-contact-heading"><div className="support-contact-copy"><span>الدعم الفني</span><h2 id="support-contact-heading">تواصل مع الدعم</h2><p>نحن هنا لمساعدتك. اختر وسيلة التواصل المناسبة.</p><div className="support-contact-methods"><a href="https://wa.me/22249823328" target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true"/><span><small>واتساب</small><b dir="ltr">49823328</b></span></a><a href="tel:49823328"><Phone aria-hidden="true"/><span><small>اتصال هاتفي</small><b dir="ltr">49823328</b></span></a><a href="https://payzone.store" target="_blank" rel="noreferrer"><Globe aria-hidden="true"/><span><small>الموقع الإلكتروني</small><b dir="ltr">payzone.store</b></span></a></div></div><div className="support-contact-image"><img src="/images/support-contact.png" alt="فريق الدعم الفني"/></div></section>;
}

function SupportLicensePage({initialStatus,onActivated}:{initialStatus?:LicenseStatus;onActivated:()=>void|Promise<void>}){
  const [status,setStatus]=useState<LicenseStatus|undefined>(initialStatus),[deviceId,setDeviceId]=useState(""),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[failure,setFailure]=useState("");
  useEffect(()=>{if(initialStatus)return;const timer=window.setTimeout(()=>fetch("/api/license/status").then(readApiResponse).then(value=>setStatus(value as LicenseStatus)).catch(error=>setFailure(error instanceof Error?error.message:"تعذر التحقق من الترخيص")),0);return()=>window.clearTimeout(timer)},[initialStatus]);
  const device=async()=>{setBusy("device");setFailure("");try{const value=await readApiResponse(await fetch("/api/license/device")) as {deviceId:string};setDeviceId(value.deviceId)}catch(error){setFailure(error instanceof Error?error.message:"تعذر استخراج رقم الجهاز. تواصل مع الدعم.")}finally{setBusy("")}};
  const copy=async()=>{if(!deviceId)return;try{await navigator.clipboard.writeText(deviceId)}catch{const input=document.createElement("textarea");input.value=deviceId;document.body.appendChild(input);input.select();document.execCommand("copy");input.remove()}setMessage("تم نسخ رقم الجهاز")};
  const install=async(file:File|null)=>{if(!file)return;setBusy("install");setFailure("");setMessage("");try{const result=await readApiResponse(await fetch("/api/license/install",{method:"POST",headers:{"content-type":"application/json"},body:file})) as {message:string;license:LicenseInfo};setStatus({valid:true,license:result.license});setMessage(result.message);await onActivated()}catch(error){setFailure(error instanceof Error?error.message:"تعذر تثبيت ملف الترخيص")}finally{setBusy("")}};
  return <section className="license-card" aria-labelledby="license-heading"><header className="license-header"><img src={APP_LOGO_PATH} alt={APP_LOGO_ALT}/><div><h2 id="license-heading">رخصة التفعيل</h2><p>{APP_NAME} — إدارة ترخيص هذا الجهاز</p></div><span className={`license-state ${status?.valid?"active":""}`}>{status?.valid?"مفعل":"غير مفعل"}</span></header><div className="license-device license-section"><h3>معرّف هذا الجهاز</h3><label>رقم الجهاز<input readOnly dir="ltr" value={deviceId||"اضغط لاستخراج رقم الجهاز"}/></label><div><button className="primary" disabled={!!busy} onClick={()=>void device()}>{busy==="device"?"جاري الاستخراج…":"استخراج رقم الجهاز"}</button><button className="soft" disabled={!deviceId} onClick={()=>void copy()}>نسخ الرقم</button></div></div>{status?.valid&&status.license&&<div className="license-section license-information"><h3>معلومات التفعيل</h3><dl className="license-details"><div><dt>اسم العميل</dt><dd>{status.license.customerName}</dd></div><div><dt>اسم المحل</dt><dd>{status.license.storeName}</dd></div><div><dt>رقم الترخيص</dt><dd dir="ltr">{status.license.licenseId}</dd></div><div><dt>معرّف المتجر</dt><dd dir="ltr">{status.license.storeId}</dd></div><div><dt>تاريخ الإصدار</dt><dd>{formatDateTime(status.license.issuedAt)}</dd></div><div><dt>نوع الترخيص</dt><dd>{status.license.type==="temporary"?"مؤقت":"دائم"}</dd></div>{status.license.type==="temporary"&&status.license.expiresAt&&<div><dt>ينتهي في</dt><dd>{formatDateTime(status.license.expiresAt)}</dd></div>}</dl></div>}<div className="license-section license-install"><div><h3>ملف التفعيل</h3><p>اختر ملف الترخيص الخاص بهذا الجهاز.</p></div><label className="file-button license-upload">{busy==="install"?"جاري التفعيل…":"رفع ملف الترخيص"}<input type="file" accept=".alkarna-license" disabled={!!busy} onChange={event=>void install(event.target.files?.[0]??null)}/></label></div>{message&&<div className="success">{message}</div>}{failure&&<div className="error" role="alert">{failure}</div>}</section>
}

function FramedSection({ title, className = "", allowOverflow = false, children }: { title: string; className?: string; allowOverflow?: boolean; children: ReactNode }) {
  return <fieldset className={`erp-fieldset ${allowOverflow ? "popover-host " : ""}${className}`.trim()}><legend>{title}</legend>{children}</fieldset>;
}

function Num(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      className="num"
      dir="ltr"
      inputMode="decimal"
      value={props.value}
      min={props.min ?? 0}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  );
}
type SelectOption = { value: string; label: string; search?: string };
export const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase("ar").normalize("NFD").replace(/[\u0640\u064b-\u065f\u0670]/g, "").replace(/\s+/g, " ");
function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false, floating = false, variant = "normal", ariaLabel, triggerRef }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean; floating?: boolean; variant?: "normal" | "compact" | "pos-customer"; ariaLabel?: string; triggerRef?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [highlightedIndex, setHighlightedIndex] = useState<number|null>(null);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null), popover = useRef<HTMLDivElement>(null), ownTriggerRef = useRef<HTMLButtonElement>(null), listId = useId(), searchId = useId();
  useImperativeHandle(triggerRef, () => ownTriggerRef.current as HTMLButtonElement);
  const normalized = normalizeSearch(query);
  const matches = options.map((option, index) => ({ option, index, text: normalizeSearch(`${option.label} ${option.search ?? ""}`) }))
    .filter(x => !normalized || x.text.includes(normalized))
    .sort((a, b) => {
      const score = (x: typeof a) => x.text === normalized ? 0 : x.text.startsWith(normalized) ? 1 : normalizeSearch(x.option.label).startsWith(normalized) ? 2 : 3;
      return score(a) - score(b) || a.index - b.index;
    }).map(x => x.option);
  const position = useCallback(() => {
    if (!floating || !root.current) return;
    const rect = root.current.getBoundingClientRect(), margin = 8, posCustomer = variant === "pos-customer", desiredHeight = Math.min(variant === "normal" ? 330 : 235, window.innerHeight - margin * 2);
    const below = window.innerHeight - rect.bottom - margin, above = rect.top - margin, opensUp = below < 220 && above > below;
    const width = posCustomer
      ? Math.min(rect.width, window.innerWidth - margin * 2)
      : Math.min(Math.max(rect.width, variant === "compact" ? 220 : 280), variant === "compact" ? 300 : window.innerWidth - margin * 2, window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    setFloatingStyle({ position: "fixed", zIndex: 1000, width, maxWidth: width, left, right: "auto", top: opensUp ? Math.max(margin, rect.top - Math.min(desiredHeight, above) - 5) : rect.bottom + 5, maxHeight: opensUp ? above : below });
  }, [floating, variant]);
  const closeSelect = useCallback((restoreFocus = false) => { setOpen(false); setQuery(""); setHighlightedIndex(null); setFloatingStyle({}); if (restoreFocus) window.requestAnimationFrame(() => ownTriggerRef.current?.focus()); }, []);
  const openSelect = () => { position(); setHighlightedIndex(null); setOpen(true); };
  useEffect(() => {
    const close = (event: PointerEvent) => { const node = event.target as Node; if (!root.current?.contains(node) && !popover.current?.contains(node)) closeSelect(); };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, [closeSelect]);
  useLayoutEffect(() => {
    if (!open || !floating) return;
    position();
    const update = () => position();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, floating, position]);
  const choose = (next: string) => { onChange(next); closeSelect(); };
  const list = <div ref={popover} className={`combobox-popover${floating ? " combobox-popover-floating" : ""}${variant === "compact" ? " combobox-popover-compact" : ""}${variant === "pos-customer" ? " combobox-popover-pos-customer" : ""}`} style={floating ? floatingStyle : undefined}>
    <label className="search"><Search /><input id={searchId} autoFocus role="combobox" aria-label={searchPlaceholder} aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={highlightedIndex !== null && matches[highlightedIndex] ? `${listId}-option-${highlightedIndex}` : undefined} value={query} placeholder={searchPlaceholder} onChange={e => { setQuery(e.target.value); setHighlightedIndex(null); }} onKeyDown={e => {
      if (e.key === "Escape") { e.preventDefault(); closeSelect(true); }
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlightedIndex(x => x === null ? 0 : Math.min(x + 1, matches.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlightedIndex(x => x === null ? matches.length - 1 : Math.max(x - 1, 0)); }
      if (e.key === "Enter" && highlightedIndex !== null && matches[highlightedIndex]) { e.preventDefault(); choose(matches[highlightedIndex].value); }
    }} /></label>
    <div id={listId} className="combobox-results" role="listbox" aria-labelledby={searchId}>
      {allowEmpty && <button type="button" onClick={() => choose("")}>{placeholder}</button>}
      {matches.map((option, index) => <button id={`${listId}-option-${index}`} type="button" data-hover-enter="select" role="option" aria-selected={highlightedIndex === index} className={[option.value === value && "selected", highlightedIndex === index && "highlighted"].filter(Boolean).join(" ")} key={option.value} onMouseEnter={() => setHighlightedIndex(index)} onMouseLeave={() => setHighlightedIndex(null)} onClick={() => choose(option.value)}>{option.label}</button>)}
      {!matches.length && <div className="combobox-empty">لا توجد نتائج</div>}
    </div>
  </div>;
  return <div className={`combobox${variant === "compact" ? " combobox-compact" : ""}${variant === "pos-customer" ? " combobox-pos-customer" : ""}`} ref={root}>
    <button ref={ownTriggerRef} type="button" className="combobox-trigger" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-controls={open ? listId : undefined} aria-expanded={open} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openSelect(); } else if (event.key === "Escape" && open) { event.preventDefault(); closeSelect(); } }} onClick={() => open ? closeSelect() : openSelect()}>
      <span>{options.find(x => x.value === value)?.label ?? placeholder}</span><ChevronDown />
    </button>
    {open && (floating ? createPortal(list, document.body) : list)}
  </div>;
}
function ProductSearchPicker({ data, query, setQuery, onPick, mode = "sale", warehouseId, priceMode = "retail", collapseResultsWhenIdle = false, stockScope = "all-warehouses", inputRef }: {
  data: BootstrapData; query: string; setQuery: (value: string) => void; onPick: (product: Product) => void;
  mode?: "sale" | "purchase" | "transfer" | "adjustment" | "inventory"; warehouseId?: string; priceMode?: PriceMode; collapseResultsWhenIdle?: boolean; stockScope?: "selected-warehouse" | "all-warehouses"; inputRef?: Ref<HTMLInputElement>;
}) {
  const [selected, setSelected] = useState<string | null>(null), listId = useId();
  const term = query.trim().toLocaleLowerCase("ar");
  const results = useMemo(() => term ? data.products.filter(product => !product.isArchived).map((product, index) => {
    const name = product.name.toLocaleLowerCase("ar"), sku = (product.sku ?? "").toLocaleLowerCase("ar"), barcode = (product.barcode ?? "").toLocaleLowerCase("ar");
    const score = barcode === term || sku === term ? 0 : barcode.startsWith(term) || sku.startsWith(term) ? 1 : name.startsWith(term) ? 2 : name.includes(term) ? 3 : 4;
    return { product, index, score, matches: `${name} ${sku} ${barcode}`.includes(term) };
  }).filter(item => item.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 30).map(item => item.product) : [], [data.products, term]);
  const add = (product: Product) => {
    const stock = stockScope === "selected-warehouse" ? stockInWarehouse(product, warehouseId) : totalProductStock(product);
    if (mode === "sale" && (stock <= 0 || isProductExpired(product))) return;
    onPick(product); setSelected(null);
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected(current => results.length ? results[Math.min(current === null ? 0 : results.findIndex(product => product.id === current) + 1, results.length - 1)].id : null); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSelected(current => results.length ? results[Math.max(current === null ? results.length - 1 : results.findIndex(product => product.id === current) - 1, 0)].id : null); }
    else if (event.key === "Enter" && selected) { const product = results.find(item => item.id === selected); if (product) { event.preventDefault(); add(product); } }
    else if (event.key === "Escape") setSelected(null);
  };
  return <div className="product-picker product-search-grid">
    <label className="search compact-search"><Search /><input ref={inputRef} role="combobox" aria-label="بحث المنتج" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls={listId} aria-activedescendant={selected ? `product-result-${selected}` : undefined} disabled={stockScope === "selected-warehouse" && !warehouseId} value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} onKeyDown={onSearchKeyDown} placeholder={stockScope === "selected-warehouse" && !warehouseId ? "اختر المخزن أولًا" : "ابحث بالاسم أو الكود أو الباركود"} /></label>
    {(!collapseResultsWhenIdle || term) && (results.length ? <div id={listId} className="erp-table-wrap picker-results" role="listbox"><table className="erp-table" aria-label="نتائج بحث المنتجات"><colgroup><col style={{width:"16%"}}/><col style={{width:"36%"}}/><col style={{width:"18%"}}/><col style={{width:"16%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th>رقم</th><th>المنتج</th><th>{mode === "purchase" ? "آخر شراء" : "السعر"}</th><th>المتوفر</th><th>إضافة</th></tr></thead><tbody>
      {results.map((product, index) => { const stock = stockScope === "selected-warehouse" ? stockInWarehouse(product, warehouseId) : totalProductStock(product), expired = isProductExpired(product), disabled = mode === "sale" && (stock <= 0 || expired); return <tr id={`product-result-${product.id}`} data-hover-enter="select" role="option" aria-selected={selected === product.id} key={product.id} className={selected === product.id ? "selected" : ""} onClick={() => add(product)}><td className="num-cell">{number(index + 1)}</td><td className="name-cell">{product.name}{expired && <small className="expired-badge">منتهي الصلاحية</small>}</td><td className="num-cell">{number(mode === "purchase" ? product.lastPurchaseCost ?? product.pieceCost ?? 0 : sellingPrice(product, priceMode))}</td><td className="num-cell">{number(stock)}</td><td className="action-cell"><button type="button" className="soft" disabled={disabled} onClick={event => { event.stopPropagation(); add(product); }}>إضافة</button></td></tr>; })}
    </tbody></table></div> : <div className="picker-no-results">لا توجد نتائج</div>)}
  </div>;
}
const SearchProducts = ProductSearchPicker;

function CompactSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search compact-search"><Search /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
function CompactDateRange({ from, to, onFromChange, onToChange, allTime, onApply, onAllTime }: { from: string; to: string; onFromChange: (value: string) => void; onToChange: (value: string) => void; allTime: boolean; onApply?: () => void; onAllTime: () => void }) {
  return <div className="compact-date-range"><label><span>من</span><input aria-label="من" type="date" dir="ltr" value={from} onChange={event => onFromChange(event.target.value)} /></label><label><span>إلى</span><input aria-label="إلى" type="date" dir="ltr" value={to} onChange={event => onToChange(event.target.value)} /></label>{onApply&&<button type="button" className="primary date-apply" onClick={onApply}>عرض</button>}<button type="button" className={allTime ? "soft active" : "soft"} aria-pressed={allTime} onClick={onAllTime}>عرض الكل</button></div>;
}

function BarcodeScanner({ products, onScan, enabled, onEnabledChange, onError }: { products: Product[]; onScan: (product: Product) => void; enabled?: boolean; onEnabledChange?: (enabled: boolean) => void; onError?: (message: string) => void }) {
  const [localEnabled, setLocalEnabled] = useState(false);
  const active = enabled ?? localEnabled;
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  useEffect(() => {
    if (!active) { buffer.current = ""; return; }
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      const now = performance.now();
      if (now - lastKeyAt.current > 120) buffer.current = "";
      lastKeyAt.current = now;
      if (event.key === "Enter" || event.key === "Tab") {
        const barcode = buffer.current.trim(); buffer.current = "";
        if (!barcode) return;
        event.preventDefault();
        const product = products.find(item => !item.isArchived && item.barcode === barcode);
        if (product) onScan(product); else onError?.("لا يوجد منتج بهذا الباركود");
      } else if (event.key.length === 1) buffer.current += event.key;
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [active, onError, onScan, products]);
  const toggle = () => { const value = !active; onEnabledChange?.(value); if (enabled === undefined) setLocalEnabled(value); };
  return <button type="button" className="scanner-switch" aria-pressed={active} onClick={toggle}><span className="scanner-indicator" aria-hidden="true">{active && <span className="scanner-indicator-dot" />}</span><span>قارئ الباركود</span></button>;
}

function Pos({
  data,
  run,
  openDoc,
  editRequest,
  clearEditRequest,
  requestPrint,
}: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
  editRequest: string | null;
  clearEditRequest: () => void;
  requestPrint: (id: string) => void;
  openStockAdjustment: (prefill: AdjustmentPrefill) => void;
}) {
  const [query, setQuery] = useState(""),
    [lines, setLines] = useSessionDraft<DraftLine[]>("sale-lines", []),
    [payment, setPayment] = useSessionDraft("sale-payment", ""),
    [partyId, setPartyId] = useSessionDraft("sale-party", ""),
    [quick, setQuick] = useState(false),
    [selectedLine, setSelectedLine] = useState<string | null>(null),
    [stockNotice, setStockNotice] = useState(""),
    [priceMode, setPriceMode] = useState<PriceMode>(initialSaleUiState.priceMode),
    [scannerEnabled, setScannerEnabled] = useState(initialSaleUiState.scannerEnabled),
    [editingDocumentId, setEditingDocumentId] = useState<string | null>(null),
    [printAfterSave, setPrintAfterSave] = useState(false),
    quickButton = useRef<HTMLButtonElement>(null);
  const baseline = useRef(""), productSearchRef = useRef<HTMLInputElement>(null), paymentRef = useRef<HTMLSelectElement>(null), customerRef = useRef<HTMLButtonElement>(null), submittingRef = useRef(false), editingDocument = editingDocumentId ? data.documents.find(document => document.id === editingDocumentId) ?? null : null;
  const wh = editingDocument ? data.warehouses.find(warehouse => warehouse.id === editingDocument.warehouseId) : data.warehouses.find((w) => w.isSalesDefault),
    details = lines.flatMap((l) => {
      const p = data.products.find((x) => x.id === l.productId);
      return p
        ? [
            {
              l,
              p,
              total: saleLineTotal(val(l.quantity), val(l.piecePrice)),
            },
          ]
        : [];
    }),
    total = details.reduce((s, x) => s + x.total, 0);
  const snapshot = () => JSON.stringify({ lines, payment, partyId, priceMode });
  const dirty = () => editingDocumentId ? snapshot() !== baseline.current : lines.length > 0 || partyId !== "" || payment !== "" || priceMode !== initialSaleUiState.priceMode;
  const resetEditor = () => { clearPersistedSaleDraft(sessionStorage); setEditingDocumentId(null); setLines([]); setPartyId(""); setPayment(""); setPriceMode(initialSaleUiState.priceMode); setSelectedLine(null); setQuery(""); baseline.current = ""; };
  const loadDocument = (document: DocumentRecord) => {
    if (document.legacyKey || document.status !== "posted") { openDoc(document.id); return; }
    if (dirty() && !confirm("لديك تغييرات غير محفوظة. هل تريد تجاهلها؟")) return;
    const loadedLines = document.lines.map(line => ({ productId: String(line.productId), quantity: String(line.quantity), piecePrice: String(line.unitPrice), unitPrice: "", actualQuantity: "" }));
    const loadedPayment = document.paymentMethod ?? "note", loadedParty = document.partyId ?? "", loadedMode = document.pricingMode ?? "retail";
    setLines(loadedLines); setPayment(loadedPayment); setPartyId(loadedParty); setPriceMode(loadedMode); setEditingDocumentId(document.id); setSelectedLine(null); setQuery("");
    baseline.current = JSON.stringify({ lines: loadedLines, payment: loadedPayment, partyId: loadedParty, priceMode: loadedMode }); clearEditRequest();
  };
  // A new parent request is the event; loading explicitly replaces every editor field.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { const document = editRequest ? data.documents.find(item => item.id === editRequest) : null; if (document) loadDocument(document); }, [editRequest]);
  function add(p: Product) {
    if (isProductExpired(p)) { setStockNotice("انتهت صلاحية هذا المنتج ولا يمكن بيعه."); return; }
    const available = Number(p.stocks?.[wh?.id ?? ""] ?? 0) + Number(editingDocument?.lines.find(line => line.productId === p.id)?.quantity ?? 0);
    if (!wh || available <= 0) { setStockNotice("المنتج غير متوفر في مخزن البيع"); return; }
    setLines(current => { const existing = current.find(line => line.productId === p.id); if (!existing) return [{ ...lineFor(p), piecePrice: String(sellingPrice(p, priceMode)) }, ...current]; if (val(existing.quantity) >= available) { setStockNotice(`الكمية المتوفرة ${number(available)} فقط`); return current; } return current.map(line => line.productId === p.id ? { ...line, quantity: String(val(line.quantity) + 1) } : line); });
    setQuery("");
    window.requestAnimationFrame(() => productSearchRef.current?.focus());
  }
  function updateSaleLine(product: Product, patch: Partial<DraftLine>) {
    setLines(current => updateSaleDraftLine(current, product.id, patch));
  }

  function changePriceMode(mode: PriceMode) {
    setPriceMode(mode);
    setLines(current => applyPriceMode(current, data.products, mode));
  }

  async function submit() {
    if (submittingRef.current) return;
    const validationProducts = editingDocument ? data.products.map(product => { const old = editingDocument.lines.find(line => line.productId === product.id); return { ...product, lastPurchaseCost: old?.costAtSale ?? product.lastPurchaseCost, stocks: { ...product.stocks, [wh?.id ?? ""]: Number(product.stocks[wh?.id ?? ""] ?? 0) + Number(old?.quantity ?? 0) } }; }) : data.products;
    const validation = validateSaleDraft(lines, validationProducts, wh?.id, editingDocument?.businessDate);
    if (validation.errors.length) {
      setSelectedLine(validation.invalidProductIds.values().next().value ?? null);
      setStockNotice(`تعذر إتمام البيع:\n• ${validation.errors.join("\n• ")}`);
      window.requestAnimationFrame(() => productSearchRef.current?.focus());
      return;
    }
    if (payment === "note" ? !partyId : !payment) { (payment === "note" ? customerRef.current : paymentRef.current)?.focus(); return; }
    submittingRef.current = true;
    const resetSuccessfulDraft = () => {
      clearPersistedSaleDraft(sessionStorage);
      setLines([]); setSelectedLine(null); setPayment(""); setPartyId("");
      setQuery(""); setStockNotice(""); setPriceMode(initialSaleUiState.priceMode); setScannerEnabled(initialSaleUiState.scannerEnabled);
    };
    try { const wasEditing = Boolean(editingDocumentId), id = await run(
      {
        type: wasEditing ? "sale.update" : "sale.post",
        documentId: editingDocumentId,
        warehouseId: wh?.id,
        paymentMethod: payment,
        paidAmount: payment === "note" ? 0 : total,
        partyId: partyId || null,
        pricingMode: priceMode,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: val(l.quantity),
          piecePrice: val(l.piecePrice),
        })),
      },
      wasEditing ? "تم حفظ تعديلات فاتورة البيع" : "تم اعتماد فاتورة البيع",
      wasEditing ? undefined : resetSuccessfulDraft,
    );
    resetEditor();
    if (printAfterSave) requestPrint(id); } finally { submittingRef.current = false; }
  }
  const voidSale = editingDocument ? async () => { if (!confirm(`هل تريد حذف فاتورة البيع رقم ${displayDocumentNumber(editingDocument)}؟\nسيتم عكس تأثيرها على المخزون والحسابات.`)) return; await run({ type: "sale.void", documentId: editingDocument.id }, "تم حذف فاتورة البيع"); resetEditor(); } : () => { if (lines.length && confirm("هل تريد حذف مسودة الفاتورة؟")) resetEditor(); };
  const newInvoice = () => { if (!dirty() || confirm("لديك تغييرات غير محفوظة. هل تريد بدء فاتورة جديدة؟")) resetEditor(); };
  const invoice = <FramedSection title="الفاتورة" className="invoice-card workspace-invoice">
    <InvoiceEditorToolbar number={editingDocument ? displayDocumentNumber(editingDocument) : String(data.nextDocumentSequences.sale)} newInvoice={newInvoice} modes={<><button type="button" className="selection-option" aria-pressed={priceMode === "retail"} onClick={() => changePriceMode("retail")}>بيع الفرد</button><button type="button" className="selection-option" aria-pressed={priceMode === "wholesale"} onClick={() => changePriceMode("wholesale")}>بيع الجملة</button></>} scanner={<BarcodeScanner products={activeProducts(data.products)} onScan={add} enabled={scannerEnabled} onEnabledChange={setScannerEnabled} onError={setStockNotice} />} />
    <div className={lines.length ? "invoice-preview has-items" : "invoice-preview"}><div className="erp-table-wrap invoice-preview-list"><table className="erp-table invoice-table" aria-label="منتجات الفاتورة"><colgroup><col style={{width:"38%"}}/><col style={{width:"14%"}}/><col style={{width:"17%"}}/><col style={{width:"19%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>الاسم</th><th>الكمية</th><th>السعر</th><th>المجموع</th><th>حذف</th></tr></thead><tbody>{details.map(({ l, p, total: lineTotal }) => <tr className={selectedLine === p.id ? "selected" : ""} onClick={() => setSelectedLine(p.id)} key={p.id}><td className="name-cell">{p.name}</td><td className="num-cell"><Num value={l.quantity} onChange={value => updateSaleLine(p, { quantity: value })} /></td><td className="num-cell"><Num value={l.piecePrice} onChange={value => updateSaleLine(p, { piecePrice: value })} /></td><td className="num-cell">{number(lineTotal)}</td><td className="action-cell"><button type="button" className="row-delete" aria-label={`حذف ${p.name}`} onClick={event => { event.stopPropagation(); setLines(current => current.filter(item => item.productId !== p.id)); }}><X /></button></td></tr>)}{!details.length && <tr className="invoice-empty-row"><td colSpan={5}>الفاتورة فارغة</td></tr>}</tbody></table></div></div>
  </FramedSection>;
  const customerSelect = <SearchableSelect triggerRef={customerRef} value={partyId} onChange={setPartyId} placeholder={payment === "note" ? "اختر العميل" : "بيع مباشر"} searchPlaceholder="ابحث باسم أو هاتف" floating allowEmpty={payment !== "note"} variant="pos-customer" ariaLabel="العميل" options={data.parties.filter(p => resolvePartyType(p) === "customer").map(p => ({ value: p.id, label: p.name, search: p.phone }))} />;
  const checkout = <FramedSection title="الدفع" className="workspace-checkout"><div className="checkout-layout"><div className="checkout-body"><div className="invoice-meta-row" aria-label="نوع الفاتورة"><button data-hover-enter="select" className="meta-option selection-option" aria-pressed={payment !== "note"} onClick={() => setPayment("")}><Banknote /><span><small>طريقة التحصيل</small><b>دفع مباشر</b></span></button><button data-hover-enter="select" className="meta-option selection-option secondary" aria-pressed={payment === "note"} onClick={() => setPayment("note")}><PencilLine /><span><small>نوع البيع</small><b>ملاحظة</b></span></button></div><span className="payment-label">{payment === "note" ? "العميل" : "طريقة الدفع"}</span><div className={`pos-payment-row${payment === "note" ? " note" : ""}`}>{payment !== "note" && <CompactPaymentSelector selectRef={paymentRef} accounts={data.paymentAccounts} value={payment} onChange={setPayment} />}<div className="pos-customer-compact">{customerSelect}</div><button ref={quickButton} type="button" className="pos-quick-customer-button" aria-label="إضافة العميل" onClick={() => setQuick(value => !value)}><Plus /><span>إضافة العميل</span></button></div>{quick && <QuickCustomer anchor={quickButton} run={run} cancel={() => setQuick(false)} onDone={id => { setPartyId(id); setQuick(false); }} />}<CheckoutInvoiceActions printAfterSave={printAfterSave} setPrintAfterSave={setPrintAfterSave} onDelete={voidSale} disabled={!editingDocument && !lines.length} /></div><div className="checkout-footer"><div className="total invoice-total"><span>الإجمالي</span><strong>{money(total)}</strong></div><button className="primary wide" disabled={!lines.length || !wh || (payment === "note" ? !partyId : !payment)} onClick={() => void submit()}>{editingDocumentId ? "حفظ التعديلات" : "إتمام البيع"}</button></div></div></FramedSection>;
  return <section className="transaction-page"> {stockNotice && <div className="toast stock-toast">{stockNotice}</div>}<div className="transaction-workspace pos-workspace"><div className="workspace-discovery"><FramedSection title="بحث المنتجات" className="search-panel"><SearchProducts inputRef={productSearchRef} data={data} query={query} setQuery={setQuery} onPick={add} mode="sale" warehouseId={wh?.id} priceMode={priceMode} stockScope="selected-warehouse" collapseResultsWhenIdle /></FramedSection><InvoiceQuickBrowser title="سجل الفواتير" docs={data.documents.filter(d => d.kind === "sale" && d.status === "posted")} openDoc={id => { const document = data.documents.find(item => item.id === id); if (document) loadDocument(document); }} /></div>{invoice}{checkout}</div></section>;

}

function CompactPaymentSelector({ accounts: suppliedAccounts, value, onChange, selectRef }: { accounts: PaymentAccount[]; value: string; onChange: (id: string) => void; selectRef?: Ref<HTMLSelectElement> }) {
  return <div className="compact-payment" aria-label="طريقة الدفع"><PaymentAccountSelect accounts={suppliedAccounts} activeOnly selectRef={selectRef} value={value} onChange={onChange} placeholder="اختر وسيلة الدفع" aria-label="وسيلة الدفع"/></div>;
}

type PaymentAccountSelectProps={accounts:PaymentAccount[];value:string;onChange:(value:string)=>void;placeholder?:string;required?:boolean;disabled?:boolean;className?:string;activeOnly?:boolean;"aria-label"?:string;selectRef?:Ref<HTMLSelectElement>};
function PaymentAccountSelect({accounts,value,onChange,placeholder="اختر وسيلة الدفع",required,disabled,className="",activeOnly=false,selectRef,...props}:PaymentAccountSelectProps){const options=activeOnly?activePaymentAccounts(accounts):accounts;return <select ref={selectRef} {...props} className={`payment-account-select ${className}`.trim()} value={value??""} required={required} disabled={disabled} onChange={event=>onChange(event.target.value)}><option value="">{placeholder}</option>{options.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>}

function InvoiceEditorToolbar({ number: invoiceNumber, newInvoice, modes, scanner }: { number: string; newInvoice: () => void; modes?: ReactNode; scanner?: ReactNode }) {
  return <div className="invoice-editor-toolbar"><div className="invoice-toolbar-main"><button type="button" className="invoice-new-button" onClick={newInvoice}>فاتورة جديدة</button><span className="invoice-number-status">رقم <b>{invoiceNumber}</b></span></div>{modes && <div className="invoice-toolbar-modes">{modes}</div>}{scanner && <div className="invoice-toolbar-scanner">{scanner}</div>}</div>;
}
function CheckoutInvoiceActions({ printAfterSave, setPrintAfterSave, onDelete, disabled }: { printAfterSave: boolean; setPrintAfterSave: (value: boolean) => void; onDelete: () => void; disabled?: boolean }) {
  return <div className="checkout-invoice-actions"><button type="button" className="print-toggle" aria-pressed={printAfterSave} onClick={() => setPrintAfterSave(!printAfterSave)}><span>{printAfterSave && <i />}</span>طباعة</button><button type="button" className="invoice-void" disabled={disabled} onClick={onDelete}>حذف الفاتورة</button></div>;
}
function QuickCustomer({ anchor, run, onDone, cancel }: { anchor: React.RefObject<HTMLButtonElement | null>; run: RunCommand; onDone: (id: string) => void; cancel: () => void }) {
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const rect = anchor.current?.getBoundingClientRect();
  const style: CSSProperties = rect ? { position: "fixed", zIndex: 1100, width: 250, top: rect.bottom + 5, left: Math.max(8, rect.right - 250) } : {};
  return createPortal(<form className="pos-quick-customer-popover" style={style} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); window.requestAnimationFrame(() => anchor.current?.focus()); } }} onSubmit={async event => { event.preventDefault(); const id = await run({ type: "party.create", partyType: "customer", name, phone }, "تمت إضافة العميل"); onDone(id); }}><label>اسم العميل<input autoFocus required value={name} onChange={e => setName(e.target.value)} /></label><label>رقم الهاتف <small>اختياري</small><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} /></label><div><button className="primary">حفظ</button><button type="button" className="soft" onClick={cancel}>إلغاء</button></div></form>, document.body);
}
function QuickSupplier({ anchor, run, onDone, cancel }: { anchor: React.RefObject<HTMLButtonElement | null>; run: RunCommand; onDone: (id: string) => void; cancel: () => void }) {
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const rect = anchor.current?.getBoundingClientRect();
  const style: CSSProperties = rect ? { position: "fixed", zIndex: 1100, width: 250, top: rect.bottom + 5, left: Math.max(8, rect.right - 250) } : {};
  return createPortal(<form className="pos-quick-customer-popover" style={style} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); window.requestAnimationFrame(() => anchor.current?.focus()); } }} onSubmit={async event => { event.preventDefault(); const id = await run({ type: "party.create", partyType: "supplier", name, phone }, "تمت إضافة المورد"); onDone(id); }}><label>اسم المورد *<input autoFocus required value={name} onChange={e => setName(e.target.value)} /></label><label>رقم الهاتف <small>اختياري</small><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} /></label><div><button className="primary">حفظ</button><button type="button" className="soft" onClick={cancel}>إلغاء</button></div></form>, document.body);
}
function Purchases({ data, run, openDoc, editRequest, clearEditRequest, requestPrint }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void; editRequest: string | null; clearEditRequest: () => void; requestPrint: (id: string) => void }) {
  const [partyId, setPartyId] = useSessionDraft("purchase-party", "");
  const [warehouseId, setWarehouseId] = useSessionDraft("purchase-warehouse", "");
  const [lines, setLines] = useSessionDraft<DraftLine[]>("purchase-lines", []);
  const [payment, setPayment] = useSessionDraft("purchase-payment", "");
  const [query, setQuery] = useState("");
  const [addingWh, setAddingWh] = useState(false);
  const [quickSupplier, setQuickSupplier] = useState(false);
  const [purchaseScannerEnabled, setPurchaseScannerEnabled] = useState(false);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null), [printAfterSave, setPrintAfterSave] = useState(false);
  const baseline = useRef(""), quickSupplierButton = useRef<HTMLButtonElement>(null), productSearchRef = useRef<HTMLInputElement>(null), paymentRef = useRef<HTMLSelectElement>(null), supplierRef = useRef<HTMLButtonElement>(null), warehouseRef = useRef<HTMLButtonElement>(null), submittingRef = useRef(false), editingDocument = editingDocumentId ? data.documents.find(document => document.id === editingDocumentId) ?? null : null;
  const details = lines.flatMap(line => { const product = data.products.find(p => p.id === line.productId); return product ? [{ line, product }] : []; });
  const total = details.reduce((sum, item) => sum + Math.round(val(item.line.quantity) * val(item.line.unitPrice)), 0);
  const snapshot = () => JSON.stringify({ lines, payment, partyId, warehouseId });
  const dirty = () => editingDocumentId ? snapshot() !== baseline.current : lines.length > 0 || partyId !== "" || warehouseId !== "" || payment !== "";
  const resetEditor = () => { setEditingDocumentId(null); setLines([]); setPartyId(""); setWarehouseId(""); setPayment(""); setSelectedLine(null); setQuery(""); baseline.current = ""; };
  const loadDocument = (document: DocumentRecord) => {
    if (document.legacyKey || document.status !== "posted") { openDoc(document.id); return; }
    if (dirty() && !confirm("لديك تغييرات غير محفوظة. هل تريد تجاهلها؟")) return;
    const loadedLines = document.lines.map(line => ({ productId: String(line.productId), quantity: String(line.quantity), unitPrice: String(line.unitPrice), piecePrice: "", actualQuantity: "" }));
    const loadedPayment = document.paymentMethod ?? "note", loadedParty = document.partyId ?? "", loadedWarehouse = document.warehouseId ?? "";
    setLines(loadedLines); setPayment(loadedPayment); setPartyId(loadedParty); setWarehouseId(loadedWarehouse); setEditingDocumentId(document.id); setSelectedLine(null); setQuery("");
    baseline.current = JSON.stringify({ lines: loadedLines, payment: loadedPayment, partyId: loadedParty, warehouseId: loadedWarehouse }); clearEditRequest();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { const document = editRequest ? data.documents.find(item => item.id === editRequest) : null; if (document) loadDocument(document); }, [editRequest]);
  function updatePurchaseLine(product: Product, patch: Partial<DraftLine>) {
    setLines(current => current.map(line => line.productId === product.id ? { ...line, ...patch } : line));
  }
  function pick(product: Product) {
    setLines(current => current.some(line => line.productId === product.id) ? current.map(line => line.productId === product.id ? { ...line, quantity: String(val(line.quantity) + 1) } : line) : [lineFor(product), ...current]);
    setQuery("");
    window.requestAnimationFrame(() => productSearchRef.current?.focus());
  }
  const deletePurchase = editingDocument ? async () => { if (!confirm(`هل تريد حذف فاتورة الشراء رقم ${displayDocumentNumber(editingDocument)}؟\nسيتم عكس تأثيرها على المخزون والحسابات.`)) return; await run({ type: "purchase.void", documentId: editingDocument.id }, "تم حذف فاتورة الشراء"); resetEditor(); } : () => { if (lines.length && confirm("هل تريد حذف مسودة فاتورة الشراء؟")) resetEditor(); };
  const newInvoice = () => { if (!dirty() || confirm("لديك تغييرات غير محفوظة. هل تريد بدء فاتورة جديدة؟")) resetEditor(); };
  async function submit() {
    if (submittingRef.current) return;
    if (!partyId) { supplierRef.current?.focus(); return; }
    if (!warehouseId) { warehouseRef.current?.focus(); return; }
    if (!lines.length) { productSearchRef.current?.focus(); return; }
    if (payment !== "note" && !payment) { paymentRef.current?.focus(); return; }
    submittingRef.current = true;
    try {
    const wasEditing = Boolean(editingDocumentId);
    const id = await run({ type: wasEditing ? "purchase.update" : "purchase.post", documentId: editingDocumentId, partyId, warehouseId, paymentMethod: payment, lines: lines.map(line => ({ productId: line.productId, quantity: val(line.quantity), unitPrice: val(line.unitPrice) })) }, wasEditing ? "تم حفظ تعديلات فاتورة الشراء" : "تم اعتماد فاتورة الشراء");
    resetEditor();
    if (printAfterSave) requestPrint(id);
    } finally { submittingRef.current = false; }
  }
  return <section className="transaction-page"><div className="transaction-workspace purchase-workspace">
    <div className="workspace-discovery"><FramedSection title="بحث المنتجات" className="search-panel"><SearchProducts inputRef={productSearchRef} data={data} query={query} setQuery={setQuery} onPick={pick} mode="purchase" warehouseId={warehouseId} collapseResultsWhenIdle /></FramedSection><InvoiceQuickBrowser title="سجل فواتير الشراء" docs={data.documents.filter(d => d.kind === "purchase" && d.status === "posted")} openDoc={id => { const document = data.documents.find(item => item.id === id); if (document) loadDocument(document); }} /></div>
    <FramedSection title="فاتورة الشراء" className="invoice-card workspace-invoice"><InvoiceEditorToolbar number={editingDocument ? displayDocumentNumber(editingDocument) : String(data.nextDocumentSequences.purchase)} newInvoice={newInvoice} scanner={<BarcodeScanner products={activeProducts(data.products)} onScan={pick} enabled={purchaseScannerEnabled} onEnabledChange={setPurchaseScannerEnabled} />} /><div className={lines.length ? "invoice-preview has-items" : "invoice-preview"}><div className="erp-table-wrap invoice-preview-list"><table className="erp-table invoice-table" aria-label="منتجات فاتورة الشراء"><colgroup><col style={{width:"38%"}}/><col style={{width:"14%"}}/><col style={{width:"17%"}}/><col style={{width:"19%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>الاسم</th><th>الكمية</th><th>سعر الشراء</th><th>المجموع</th><th>حذف</th></tr></thead><tbody>{details.map(({line, product}) => <tr key={product.id} onClick={() => setSelectedLine(product.id)} className={selectedLine === product.id ? "selected" : ""}><td className="name-cell">{product.name}</td><td className="num-cell"><Num value={line.quantity} onChange={value => updatePurchaseLine(product, { quantity: value })} /></td><td className="num-cell"><Num value={line.unitPrice} onChange={value => updatePurchaseLine(product, { unitPrice: value })} /></td><td className="num-cell">{number(val(line.quantity) * val(line.unitPrice))}</td><td className="action-cell"><button type="button" className="row-delete" aria-label={`حذف ${product.name}`} onClick={event => { event.stopPropagation(); setLines(current => current.filter(item => item.productId !== product.id)); }}><X /></button></td></tr>)}{!details.length && <tr className="invoice-empty-row"><td colSpan={5}>الفاتورة فارغة</td></tr>}</tbody></table></div></div></FramedSection>
    <FramedSection title="الدفع" className="workspace-checkout purchase-checkout"><div className="checkout-layout"><div className="checkout-body purchase-details"><div className="invoice-meta-row"><button data-hover-enter="select" className="meta-option selection-option" aria-pressed={payment !== "note"} onClick={() => setPayment("")}><Banknote /><span><small>نوع التسوية</small><b>دفع مباشر</b></span></button><button data-hover-enter="select" className="meta-option selection-option secondary" aria-pressed={payment === "note"} onClick={() => setPayment("note")}><PencilLine /><span><small>نوع التسوية</small><b>ملاحظة</b></span></button></div><span className="payment-label">{payment === "note" ? "المورد" : "طريقة الدفع"}</span><div className={`purchase-payment-row${payment === "note" ? " note" : ""}`}>{payment !== "note" && <CompactPaymentSelector selectRef={paymentRef} accounts={data.paymentAccounts} value={payment} onChange={setPayment} />}<div className="purchase-supplier"><SearchableSelect triggerRef={supplierRef} value={partyId} onChange={setPartyId} placeholder="اختر المورد" searchPlaceholder="ابحث باسم المورد أو رقم الهاتف" floating options={data.parties.filter(p => resolvePartyType(p) === "supplier").map(p => ({ value: p.id, label: p.name, search: p.phone }))} /></div><button ref={quickSupplierButton} type="button" className="pos-quick-customer-button" aria-label="إضافة المورد" onClick={() => setQuickSupplier(value => !value)}><Plus /><span>إضافة المورد</span></button></div>{quickSupplier && <QuickSupplier anchor={quickSupplierButton} run={run} cancel={() => setQuickSupplier(false)} onDone={id => { setPartyId(id); setQuickSupplier(false); }} />}<CheckoutInvoiceActions printAfterSave={printAfterSave} setPrintAfterSave={setPrintAfterSave} onDelete={deletePurchase} disabled={!editingDocument && !lines.length} /><label>مخزن الاستلام<SearchableSelect triggerRef={warehouseRef} value={warehouseId} onChange={setWarehouseId} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" floating options={activeWarehouses(data.warehouses).map(w => ({ value: w.id, label: w.name }))} /></label><button className="link purchase-add-warehouse" onClick={() => setAddingWh(!addingWh)}><Plus /> إضافة مخزن</button>{addingWh && <InlineCreate label="اسم المخزن" onSave={async name => { await run({ type: "warehouse.create", name }, "تمت إضافة المخزن"); setAddingWh(false); }} />}</div><div className="checkout-footer"><div className="total invoice-total"><span>الإجمالي</span><strong>{money(total)}</strong></div><button className="primary wide" disabled={!partyId || !warehouseId || !lines.length || (payment !== "note" && !payment)} onClick={() => void submit()}>{editingDocumentId ? "حفظ التعديلات" : "إتمام الشراء"}</button></div></div></FramedSection>
  </div></section>;

}
function Expenses({ data, run, openDoc }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void }) {
  const [title, setTitle] = useSessionDraft("expense-title", ""),
    [amount, setAmount] = useSessionDraft("expense-amount", ""),
    [date, setDate] = useSessionDraft("expense-date", localBusinessDay()),
    [frequency, setFrequency] = useSessionDraft("expense-frequency", "once"),
    [paymentMethod, setPaymentMethod] = useSessionDraft("expense-payment", "");
  const today = localBusinessDay(), [historyQuery, setHistoryQuery] = useState("");
  const [historyFrom, setHistoryFrom] = useState(today), [historyTo, setHistoryTo] = useState(today), [historyAllTime, setHistoryAllTime] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [recurringPaymentMethod, setRecurringPaymentMethod] = useState("");
  const accounts = activePaymentAccounts(data.paymentAccounts);
  const accountName = (id: string | null) => data.paymentAccounts.find(a => a.id === id || a.code === id)?.name ?? "—";
  const expenseFilters = (): ExpenseHistoryFilters => ({ query: historyQuery, from: historyFrom, to: historyTo, allTime: historyAllTime });
  const applyExpenseFilters = (next: ExpenseHistoryFilters) => { setHistoryQuery(next.query); setHistoryFrom(next.from); setHistoryTo(next.to); setHistoryAllTime(next.allTime); };
  const expenses = data.documents.filter(d => d.kind === "expense");
  const expenseDocs = historyQuery.trim()
    ? rankExpenseDocuments(expenses, historyQuery)
    : filterDocumentsByDate(expenses, historyFrom, historyTo, historyAllTime);
  return <section className="expense-workspace workspace-page">
    <div className="expense-grid">
      <FramedSection title="مصروف جديد" className="expense-form"><form className="expense-form-body" onSubmit={async event => { event.preventDefault(); const id = await run({ type: "expense.post", title, amount: val(amount), occurredAt: date, frequency, paymentMethod }, frequency === "once" ? "تم تسجيل المصروف" : "تم حفظ التذكير دون خصم"); setTitle(""); setAmount(""); if (frequency === "once") { setPaymentMethod(""); openDoc(id); } }}>
        <div className="expense-fields">
          <label>عنوان المصروف<input required value={title} onChange={e => setTitle(e.target.value)} /></label>
          <label>المبلغ<Num value={amount} onChange={setAmount} /></label>
          <label>تاريخ المصروف<input dir="ltr" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>التكرار<select value={frequency} onChange={e => setFrequency(e.target.value)}><option value="once">مرة واحدة</option><option value="daily">يومي</option><option value="monthly">شهري</option></select></label>
          {frequency === "once" && <label>وسيلة الدفع<PaymentAccountSelect required accounts={accounts} value={paymentMethod} onChange={setPaymentMethod}/></label>}
          <button className="primary expense-save" disabled={!title || !amount || (frequency === "once" && !paymentMethod)}>{frequency === "once" ? "حفظ الفاتورة" : "حفظ التذكير"}</button>
        </div>
      </form></FramedSection>
      <FramedSection title={`المصاريف المستحقة · ${number(data.recurringExpenses.length)}`} className="expense-recurring"><div className="erp-table-wrap expense-scroll"><table className="erp-table" aria-label="المصاريف المستحقة"><colgroup><col style={{width:"27%"}}/><col style={{width:"19%"}}/><col style={{width:"17%"}}/><col style={{width:"22%"}}/><col style={{width:"15%"}}/></colgroup><thead><tr><th>المصروف</th><th>الاستحقاق</th><th>المبلغ</th><th>الحالة / الحساب</th><th>إجراء</th></tr></thead><tbody>
        {data.recurringExpenses.map(r => <tr key={r.id}><td className="name-cell">{r.title}</td><td>{formatDate(r.currentDueDate)}</td><td className="num-cell">{money(r.amount)}</td><td>{r.currentPaymentMethodId ? `مدفوع · ${accountName(r.currentPaymentMethodId)}` : r.frequency === "daily" ? "يومي · غير مدفوع" : "شهري · غير مدفوع"}</td><td className="action-cell">{r.currentPaymentMethodId ? accountName(r.currentPaymentMethodId) : <button className="soft" onClick={() => { setRecurringPaymentMethod(""); setPaying(r.id); }}>تسجيل الدفع</button>}</td></tr>)}
        {!data.recurringExpenses.length && <tr><td colSpan={5}>لا توجد مصاريف متكررة</td></tr>}
      </tbody></table></div></FramedSection>
      <FramedSection title="سجل المصاريف" className="expense-history"><div className="expense-history-filters"><CompactSearch value={historyQuery} onChange={query => applyExpenseFilters(expenseSearchMode(expenseFilters(), query))} placeholder="بحث بالعنوان أو رقم المستند" /><CompactDateRange from={historyFrom} to={historyTo} allTime={historyAllTime && !historyQuery.trim()} onAllTime={() => applyExpenseFilters(expenseAllTimeMode())} onFromChange={value => applyExpenseFilters(expenseDateMode(expenseFilters(), "from", value))} onToChange={value => applyExpenseFilters(expenseDateMode(expenseFilters(), "to", value))} /></div><div className="erp-table-wrap expense-scroll"><table className="erp-table" aria-label="سجل المصاريف"><colgroup><col style={{width:"15%"}}/><col style={{width:"15%"}}/><col style={{width:"23%"}}/><col style={{width:"14%"}}/><col style={{width:"18%"}}/><col style={{width:"15%"}}/></colgroup><thead><tr><th>رقم المستند</th><th>التاريخ</th><th>العنوان</th><th>المبلغ</th><th>وسيلة الدفع</th><th>النوع</th></tr></thead><tbody>{expenseDocs.map(document => <tr key={document.id} onClick={() => openDoc(document.id)}><td dir="ltr">{displayDocumentNumber(document)}</td><td>{formatDate(document.occurredAt)}</td><td className="name-cell">{document.title ?? "مصروف"}</td><td className="num-cell">{money(document.total)}</td><td>{accountName(document.paymentMethod)}</td><td>{document.recurringId ? "متكرر" : "مرة واحدة"}</td></tr>)}{!expenseDocs.length && <tr><td colSpan={6}>لا توجد فواتير مطابقة</td></tr>}</tbody></table></div></FramedSection>
    </div>
    {paying && <div className="modal-overlay" role="dialog" aria-modal="true"><form className="modal-card payment-dialog" onSubmit={async e => { e.preventDefault(); if (!recurringPaymentMethod) return; const recurring = data.recurringExpenses.find(r => r.id === paying)!; await run({ type: "expense.materialize", recurringId: paying, dueDate: recurring.currentDueDate, paymentMethod: recurringPaymentMethod }, "تم تسجيل دفع الاستحقاق"); setRecurringPaymentMethod(""); setPaying(null); }}><div className="modal-heading"><h3>تسجيل الدفع</h3><button type="button" className="icon" onClick={() => { setRecurringPaymentMethod(""); setPaying(null); }}><X /></button></div><label>تم الدفع من<PaymentAccountSelect required accounts={accounts} value={recurringPaymentMethod} onChange={setRecurringPaymentMethod}/></label><button className="primary" disabled={!recurringPaymentMethod}>تأكيد الدفع</button></form></div>}
  </section>;
}
type FinancialDetail = {type:string;occurredAt:string;amount:number;reference:string;note?:string|null;from?:string;to?:string;account?:string;balanceBefore?:number;balanceAfter?:number};
function useBankScope(){const today=localBusinessDay(),[draftFrom,setDraftFrom]=useState(today),[draftTo,setDraftTo]=useState(today),[period,setPeriod]=useState<CommittedPeriod>(()=>({from:today,to:today}));const resetAllFilters=()=>{setDraftFrom("");setDraftTo("");setPeriod(null)};return {draftFrom,draftTo,setDraftFrom,setDraftTo,period,commit:()=>setPeriod({from:draftFrom,to:draftTo}),all:resetAllFilters}}
function buildFinancialPresentation(detail:FinancialDetail):OfficialPresentation{const transfer=!!detail.from&&!!detail.to,correction=detail.balanceBefore!=null||detail.balanceAfter!=null,title=transfer?"سند تحويل بين الحسابات":correction?"سند تصحيح رصيد":/إيداع/.test(detail.type)?"سند إيداع":/سحب/.test(detail.type)?"سند سحب":"سند عملية مالية";return{title,meta:[["المرجع",detail.reference],["التاريخ",formatDateTime(detail.occurredAt)],...(detail.account?[["الحساب",detail.account]] as Array<[string,string]>:[]),...(detail.from?[["من الحساب",detail.from]] as Array<[string,string]>:[]),...(detail.to?[["إلى الحساب",detail.to]] as Array<[string,string]>:[]),...(detail.balanceBefore!=null?[["الرصيد قبل",money(detail.balanceBefore)]] as Array<[string,string]>:[]),...(detail.balanceAfter!=null?[["الرصيد بعد",money(detail.balanceAfter)]] as Array<[string,string]>:[]),...(detail.note?[[correction?"السبب":"ملاحظة",detail.note]] as Array<[string,string]>:[])],totals:[[correction?"مقدار التغيير":"المبلغ",money(detail.amount)]],tone:transfer||correction?"neutral":/إيداع/.test(detail.type)?"positive":/سحب/.test(detail.type)?"negative":"neutral"}}
function FinancialOperationDetail({detail,close,branding}:{detail:FinancialDetail;close:()=>void;branding:InvoiceBrandingSettings}){const presentation=buildFinancialPresentation(detail),tone:MoneyTone=/إيداع/.test(detail.type)?"positive":/سحب/.test(detail.type)?"negative":"neutral";const print=()=>{const root=document.documentElement,cleanup=()=>root.classList.remove("print-document-mode");root.classList.add("print-document-mode");window.addEventListener("afterprint",cleanup,{once:true});window.print();window.setTimeout(cleanup,1500)};return createPortal(<div className="modal-overlay" role="dialog" aria-modal="true"><div className="official-document-viewer"><section className="official-document-layout"><div className="official-document-toolbar"><button className="back" onClick={close}>← العودة</button><button className="soft" onClick={print}><Printer/> طباعة</button></div><div className="official-document-scroll financial-operation-detail no-print"><dl><dt>المرجع</dt><dd>{detail.reference}</dd><dt>التاريخ</dt><dd>{formatDateTime(detail.occurredAt)}</dd>{detail.account&&<><dt>الحساب</dt><dd>{detail.account}</dd></>}{detail.from&&<><dt>من الحساب</dt><dd>{detail.from}</dd></>}{detail.to&&<><dt>إلى الحساب</dt><dd>{detail.to}</dd></>}<dt>المبلغ</dt><dd><MoneyValue value={detail.amount} tone={tone}/></dd>{detail.balanceBefore!=null&&<><dt>الرصيد قبل</dt><dd><MoneyValue value={detail.balanceBefore}/></dd></>}{detail.balanceAfter!=null&&<><dt>الرصيد بعد</dt><dd><MoneyValue value={detail.balanceAfter}/></dd></>}{detail.balanceBefore!=null&&detail.balanceAfter!=null&&<><dt>مقدار التصحيح</dt><dd><MoneyValue value={detail.balanceAfter-detail.balanceBefore} tone={(detail.balanceAfter-detail.balanceBefore)>0?"positive":(detail.balanceAfter-detail.balanceBefore)<0?"negative":"neutral"}/></dd></>}{detail.note&&<><dt>ملاحظة</dt><dd>{detail.note}</dd></>}</dl></div>{createPortal(<div className="document-print-portal"><OfficialRecordSheet presentation={presentation} branding={branding}/></div>,document.body)}</section></div></div>,document.body)}
function Banks({ data, run, openDoc, tab }: { data: BootstrapData; run: RunCommand; openDoc:(id:string)=>void; tab:BankTab }) {
  const [editing,setEditing]=useState<PaymentAccount|null>(null),[detail,setDetail]=useState<FinancialDetail|null>(null),[showArchived,setShowArchived]=useState(false);
  const [transferFrom,setTransferFrom]=useState(""),[transferTo,setTransferTo]=useState(""),[amount,setAmount]=useState(""),[note,setNote]=useState("");
  const [accountFilter,setAccountFilter]=useState(""),[typeFilter,setTypeFilter]=useState(""),movementScope=useBankScope();
  const [transferFromFilter,setTransferFromFilter]=useState(""),[transferToFilter,setTransferToFilter]=useState(""),transferScope=useBankScope();
  const [adjustmentAccount,setAdjustmentAccount]=useState(""),[adjustmentDirection,setAdjustmentDirection]=useState<"deposit"|"withdrawal">("deposit"),[adjustmentAmount,setAdjustmentAmount]=useState(""),[adjustmentNote,setAdjustmentNote]=useState(""),[adjustmentFilter,setAdjustmentFilter]=useState(""),[adjustmentType,setAdjustmentType]=useState(""),adjustmentScope=useBankScope();
  const active=activePaymentAccounts(data.paymentAccounts),archived=data.paymentAccounts.filter(account=>account.isArchived===true),name=(id:string)=>data.paymentAccounts.find(account=>account.id===id||account.code===id)?.name??id;
  const movementLabels:Record<string,string>={sale:"بيع",purchase:"شراء",expense:"مصروف","party-receipt":"سداد عميل","party-payment":"سداد مورد","transfer-in":"تحويل داخل","transfer-out":"تحويل خارج","manual-deposit":"إيداع","manual-withdrawal":"سحب","opening-balance":"رصيد بداية","balance-correction":"تصحيح رصيد"};
  const resetMovementFilters=()=>{movementScope.all();setAccountFilter("");setTypeFilter("")},resetTransferFilters=()=>{transferScope.all();setTransferFromFilter("");setTransferToFilter("")},resetAdjustmentFilters=()=>{adjustmentScope.all();setAdjustmentFilter("");setAdjustmentType("")};
  const operationalMovements=data.financialMovements.filter(m=>m.type !== "opening-balance"),movements=filterFinancialMovements(operationalMovements,movementScope.period,accountFilter,typeFilter),accountSummary=bankScopeMetrics(data.paymentAccounts,data.financialMovements,data.parties);
  const transfers=filterTransfers(data.accountTransfers,transferScope.period,transferFromFilter,transferToFilter);
  const adjustments=filterFinancialMovements(operationalMovements,adjustmentScope.period,adjustmentFilter).filter(row=>["manual-deposit","manual-withdrawal"].includes(row.type)&&(!adjustmentType||row.type===adjustmentType));
  const inspectMovement=(movement:BootstrapData["financialMovements"][number])=>{if(data.documents.some(document=>document.id===movement.documentId))openDoc(movement.documentId);else setDetail({type:movementLabels[movement.type]??movement.type,occurredAt:movement.occurredAt,amount:movement.amount,reference:movement.documentNumber,note:movement.note??movement.reason,account:name(movement.paymentMethod),balanceBefore:movement.balanceBefore,balanceAfter:movement.balanceAfter})};
  const noteClauses=[accountFilter&&name(accountFilter),typeFilter&&(movementLabels[typeFilter]??typeFilter),movementScope.period&&`من ${movementScope.period.from||"البداية"} إلى ${movementScope.period.to||"النهاية"}`].filter(Boolean).join(" · ");
  const splitPanel=tab==="transfers"||tab==="adjustment";
  return <section className="banks-workspace workspace-page"><FramedSection title={bankNav.find(item=>item.id===tab)?.label??"البنوك والحسابات"} className={`bank-panel${splitPanel?" bank-panel-centered-legend":""}`}><div className="bank-tab-stage">
  {tab==="accounts"&&<div className="bank-tab-content bank-tab-accounts"><div className="bank-accounts-main"><div className="section-toolbar"><button className="primary" onClick={()=>setEditing({id:"",code:"",name:"",color:"#1677c8",icon:"wallet",isActive:true,allowNegativeBalance:false,balance:0,income:0,expenses:0,purchaseTotal:0})}><Plus/> إضافة بنك أو وسيلة دفع</button>{archived.length>0&&<button className="soft" onClick={()=>setShowArchived(true)}>المؤرشفة ({number(archived.length)})</button>}</div><div className="erp-table-wrap account-list"><table className="erp-table" aria-label="وسائل الدفع"><colgroup><col style={{width:"34%"}}/><col style={{width:"19%"}}/><col style={{width:"27%"}}/><col style={{width:"20%"}}/></colgroup><thead><tr><th>الحساب</th><th>الحالة</th><th>الرصيد</th><th>إجراء</th></tr></thead><tbody>{active.map(account=><tr key={account.id}><td>{account.name}</td><td>{account.isActive?"نشط":"متوقف"}</td><td className={`num-cell ${account.balance>0?"metric-positive":account.balance<0?"metric-negative":"metric-neutral"}`}><MoneyValue value={account.balance} tone={account.balance>0?"positive":account.balance<0?"negative":"neutral"}/></td><td className="action-cell"><button className="soft" onClick={()=>setEditing(account)}>تعديل</button></td></tr>)}</tbody></table></div></div><FramedSection title="ملخص الحسابات" className="bank-summary"><div className={accountSummary.currentBalance>0?"metric-positive":accountSummary.currentBalance<0?"metric-negative":"metric-neutral"}><small>إجمالي الأرصدة الحالية</small><MoneyValue value={accountSummary.currentBalance} tone={accountSummary.currentBalance>0?"positive":accountSummary.currentBalance<0?"negative":"neutral"} className="financial-amount-summary"/></div><div className="metric-positive"><small>إجمالي المداخيل</small><MoneyValue value={accountSummary.income} tone="positive" className="financial-amount-summary"/></div><div className="metric-negative"><small>إجمالي المصاريف</small><MoneyValue value={accountSummary.expenses} tone="negative" className="financial-amount-summary"/></div><div className="bank-debt-card"><small>الديون</small><div className="bank-debt-values"><span className="metric-positive"><small>لنا</small><MoneyValue value={accountSummary.owedToUs} tone="positive"/></span><span className="metric-negative"><small>علينا</small><MoneyValue value={accountSummary.weOwe} tone="negative"/></span></div></div></FramedSection></div>}
  {tab==="movements"&&<div className="bank-tab-content bank-tab-movements"><div className="bank-filter-stack"><div className="bank-filters"><div className="bank-scope-controls"><CompactDateRange from={movementScope.draftFrom} to={movementScope.draftTo} allTime={movementScope.period===null&&!accountFilter&&!typeFilter} onApply={movementScope.commit} onAllTime={resetMovementFilters} onFromChange={movementScope.setDraftFrom} onToChange={movementScope.setDraftTo}/></div><PaymentAccountSelect accounts={data.paymentAccounts} value={accountFilter} onChange={setAccountFilter} placeholder="كل الحسابات"/><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">كل الأنواع</option>{Object.entries(movementLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>{noteClauses&&<small className="bank-scope-note">تنبيه: العرض الحالي حسب {noteClauses}</small>}</div><div className="erp-table-wrap ledger-list"><table className="erp-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>الحساب</th><th>الحركة</th><th>المستند</th></tr></thead><tbody>{movements.map(m=><tr key={m.id} onClick={()=>inspectMovement(m)}><td>{formatDateTime(m.occurredAt)}</td><td>{movementLabels[m.type]??m.type}</td><td>{name(m.paymentMethod)}</td><td className={`num-cell ${m.direction==="in"?"bank-amount-positive":"bank-amount-negative"}`}><MoneyValue value={m.amount} tone={m.direction==="in"?"positive":"negative"}/></td><td dir="ltr">{m.documentNumber}</td></tr>)}</tbody></table></div></div>}
  {tab==="transfers"&&<div className="bank-tab-content bank-tab-transfers"><FramedSection title="تحويل جديد" className="bank-operation"><form className="transfer-form bank-operation-form" onSubmit={async e=>{e.preventDefault();await run({type:"account-transfer.post",fromAccountId:transferFrom,toAccountId:transferTo,amount:val(amount),note},"تم التحويل بين الحسابات");setAmount("");setNote("")}}><div className="bank-operation-row transfer-account-row"><label>من الحساب<PaymentAccountSelect required accounts={active} value={transferFrom} onChange={setTransferFrom} placeholder="اختر المصدر"/></label><label>إلى الحساب<PaymentAccountSelect required accounts={active} value={transferTo} onChange={setTransferTo} placeholder="اختر الوجهة"/></label></div><div className="bank-operation-row transfer-detail-row"><label>المبلغ<Num value={amount} onChange={setAmount}/></label><label>ملاحظة<input value={note} onChange={e=>setNote(e.target.value)}/></label><button className="primary" disabled={!transferFrom||!transferTo||transferFrom===transferTo||!amount}>اعتماد التحويل</button></div></form></FramedSection><FramedSection title="سجل التحويلات" className="bank-history"><div className="bank-history-filter-stack"><div className="bank-history-date-row"><div className="bank-scope-controls"><CompactDateRange from={transferScope.draftFrom} to={transferScope.draftTo} allTime={transferScope.period===null&&!transferFromFilter&&!transferToFilter} onApply={transferScope.commit} onAllTime={resetTransferFilters} onFromChange={transferScope.setDraftFrom} onToChange={transferScope.setDraftTo}/></div></div><div className="bank-history-select-row"><PaymentAccountSelect accounts={data.paymentAccounts} value={transferFromFilter} onChange={setTransferFromFilter} placeholder="كل المرسلين"/><PaymentAccountSelect accounts={data.paymentAccounts} value={transferToFilter} onChange={setTransferToFilter} placeholder="كل المستلمين"/></div></div><div className="erp-table-wrap transfer-list"><table className="erp-table bank-transfer-table"><colgroup><col style={{width:"21%"}}/><col style={{width:"19%"}}/><col style={{width:"19%"}}/><col style={{width:"17%"}}/><col style={{width:"24%"}}/></colgroup><thead><tr><th>التاريخ</th><th>من</th><th>إلى</th><th>المبلغ</th><th>المرجع</th></tr></thead><tbody>{transfers.map(t=><tr key={t.id} onClick={()=>setDetail({type:"تحويل",occurredAt:t.occurredAt,amount:t.amount,reference:t.number,note:t.note,from:name(t.fromAccountId),to:name(t.toAccountId)})}><td>{formatDateTime(t.occurredAt)}</td><td>{name(t.fromAccountId)}</td><td>{name(t.toAccountId)}</td><td className="num-cell bank-amount-neutral"><MoneyValue value={t.amount}/></td><td dir="ltr">{t.number}</td></tr>)}</tbody></table></div></FramedSection></div>}
  {tab==="adjustment"&&<div className="bank-tab-content bank-tab-adjustment"><FramedSection title="عملية سحب أو إيداع" className="bank-operation"><form className="bank-adjustment-form bank-operation-form" onSubmit={async e=>{e.preventDefault();await run({type:"account-adjustment.post",accountId:adjustmentAccount,direction:adjustmentDirection,amount:val(adjustmentAmount),note:adjustmentNote},adjustmentDirection==="deposit"?"تم الإيداع":"تم السحب");setAdjustmentAmount("");setAdjustmentNote("")}}><div className="bank-operation-row adjustment-account-row"><div className="bank-adjustment-direction"><button type="button" className="selection-option deposit-option" aria-pressed={adjustmentDirection==="deposit"} onClick={()=>setAdjustmentDirection("deposit")}>إيداع</button><button type="button" className="selection-option withdrawal-option" aria-pressed={adjustmentDirection==="withdrawal"} onClick={()=>setAdjustmentDirection("withdrawal")}>سحب</button></div><label>الحساب<PaymentAccountSelect required accounts={active} value={adjustmentAccount} onChange={setAdjustmentAccount} placeholder="اختر الحساب"/></label></div><div className="bank-operation-row adjustment-detail-row"><label>المبلغ<Num value={adjustmentAmount} onChange={setAdjustmentAmount}/></label><label>ملاحظة<input value={adjustmentNote} onChange={e=>setAdjustmentNote(e.target.value)}/></label><button className="primary">اعتماد العملية</button></div></form></FramedSection><FramedSection title="سجل السحب والإيداع" className="bank-history"><div className="bank-history-filter-stack"><div className="bank-history-date-row"><div className="bank-scope-controls"><CompactDateRange from={adjustmentScope.draftFrom} to={adjustmentScope.draftTo} allTime={adjustmentScope.period===null&&!adjustmentFilter&&!adjustmentType} onApply={adjustmentScope.commit} onAllTime={resetAdjustmentFilters} onFromChange={adjustmentScope.setDraftFrom} onToChange={adjustmentScope.setDraftTo}/></div></div><div className="bank-history-select-row"><PaymentAccountSelect accounts={data.paymentAccounts} value={adjustmentFilter} onChange={setAdjustmentFilter} placeholder="كل الحسابات"/><select value={adjustmentType} onChange={e=>setAdjustmentType(e.target.value)}><option value="">إيداع وسحب</option><option value="manual-deposit">إيداع</option><option value="manual-withdrawal">سحب</option></select></div></div><div className="erp-table-wrap adjustment-list"><table className="erp-table"><thead><tr><th>المرجع</th><th>التاريخ</th><th>الحساب</th><th>النوع</th><th>المبلغ</th><th>الملاحظة</th></tr></thead><tbody>{adjustments.map(m=><tr key={m.id} onClick={()=>inspectMovement(m)}><td dir="ltr">{m.documentNumber}</td><td>{formatDateTime(m.occurredAt)}</td><td>{name(m.paymentMethod)}</td><td>{movementLabels[m.type]}</td><td className={`num-cell ${m.direction==="in"?"bank-amount-positive":"bank-amount-negative"}`}><MoneyValue value={m.amount} tone={m.direction==="in"?"positive":"negative"}/></td><td>{m.note||"—"}</td></tr>)}</tbody></table></div></FramedSection></div>}
  </div></FramedSection>{showArchived&&<div className="modal-overlay" role="dialog" aria-modal="true"><div className="modal-card account-dialog"><div className="modal-heading"><h3>وسائل الدفع المؤرشفة</h3><button className="icon" onClick={()=>setShowArchived(false)}><X/></button></div>{archived.map(account=><div className="admin-actions" key={account.id}><span>{account.name} · {account.archivedAt?formatDate(account.archivedAt):"—"} · <MoneyValue value={account.balance} tone={account.balance>0?"positive":account.balance<0?"negative":"neutral"}/></span><button className="soft" onClick={async()=>{await run({type:"payment-account.restore",accountId:account.id},"تمت استعادة وسيلة الدفع");setShowArchived(false)}}>استعادة</button></div>)}</div></div>}{editing&&<PaymentAccountDialog account={editing} close={()=>setEditing(null)} run={run}/>} {detail&&<FinancialOperationDetail detail={detail} close={()=>setDetail(null)} branding={data.branding}/>}</section>;
}

function PaymentAccountDialog({ account, close, run }: { account: PaymentAccount; close: () => void; run: RunCommand }) {
  const [name,setName]=useState(account.name),[isActive,setActive]=useState(account.isActive),[allowNegativeBalance,setAllowNegativeBalance]=useState(account.allowNegativeBalance===true),[openingBalance,setOpeningBalance]=useState("0"),[correcting,setCorrecting]=useState(false),[newBalance,setNewBalance]=useState(String(account.balance??0)),[reason,setReason]=useState("");
  const difference=val(newBalance)-Number(account.balance??0);
  const remove=async()=>{if(account.code==="cash"){alert("لا يمكن حذف وسيلة الدفع النقدية الأساسية");return}if(!confirm("سيتم حذف وسيلة الدفع إذا لم يكن لها أي سجل سابق.\nإذا كانت مرتبطة بسجلات قديمة فسيتم أرشفتها مع الاحتفاظ بكامل التاريخ.\nلا يمكن تنفيذ العملية إذا كان الرصيد غير صفري."))return;const result=await run({type:"payment-account.delete",accountId:account.id},"");setNoticeForRemoval(result);close()};
  const setNoticeForRemoval=(result:{disposition?:"deleted"|"archived"})=>alert(result?.disposition==="archived"?"تمت أرشفة وسيلة الدفع مع الاحتفاظ بسجلها":"تم حذف وسيلة الدفع");
  if(correcting)return <div className="modal-overlay" role="dialog" aria-modal="true"><form className="modal-card account-dialog" onSubmit={async e=>{e.preventDefault();await run({type:"account-balance-correction.post",accountId:account.id,newBalance:val(newBalance),reason},"تم اعتماد تصحيح الرصيد");close()}}><div className="modal-heading"><h3>تصحيح الرصيد</h3><button type="button" className="icon" onClick={close}><X/></button></div><label>الرصيد الحالي<input readOnly value={account.balance}/></label><label>الرصيد الصحيح<Num value={newBalance} onChange={setNewBalance}/></label><label>الفرق<input readOnly value={`${difference>0?"+":""}${difference}`}/></label><label>سبب التصحيح<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="dialog-actions"><button className="primary" disabled={!reason.trim()||difference===0}>اعتماد التصحيح</button><button type="button" onClick={()=>setCorrecting(false)}>إلغاء</button></div></form></div>;
  return <div className="modal-overlay" role="dialog" aria-modal="true"><form className="modal-card account-dialog" onSubmit={async e=>{e.preventDefault();await run({type:account.id?"payment-account.update":"payment-account.create",id:account.id,name,isActive,allowNegativeBalance,openingBalance:val(openingBalance)},"تم حفظ وسيلة الدفع");close()}}><div className="modal-heading"><h3>{account.id?"تعديل وسيلة الدفع":"وسيلة دفع جديدة"}</h3><button type="button" className="icon" onClick={close}><X/></button></div><label>{account.id?"الاسم":"اسم البنك أو وسيلة الدفع"}<input required value={name} onChange={e=>setName(e.target.value)}/></label>{!account.id&&<label>رصيد البداية<Num value={openingBalance} onChange={setOpeningBalance}/></label>}{account.id&&<label className="active-toggle"><input type="checkbox" checked={isActive} onChange={e=>setActive(e.target.checked)}/> متاحة للعمليات الجديدة</label>}<label className="active-toggle"><input type="checkbox" checked={allowNegativeBalance} disabled={account.balance<0} onChange={e=>setAllowNegativeBalance(e.target.checked)}/> السماح برصيد سالب</label><button className="primary">حفظ</button>{account.id&&<div className="admin-actions"><button type="button" className="soft" onClick={()=>setCorrecting(true)}>تصحيح الرصيد</button><button type="button" className="danger" onClick={()=>void remove()}>حذف الوسيلة</button></div>}</form></div>;
}

export function partyBusinessMetrics(documents:DocumentRecord[],partyId:string,partyType:"customer"|"supplier"){
  const summary=calculatePartyFinancialSummaries(documents,[]).find(item=>item.partyId===partyId);
  return partyTradeMetrics(summary,partyType);
}
type PartyMetricStripItem = { label: string; value: number; tone?: "neutral" | "positive" | "negative"; count?: boolean };
function PartyMetricStrip({items,aggregate=false}:{items:PartyMetricStripItem[];aggregate?:boolean}) {
  return <div className={`party-trade-metrics${aggregate?" party-aggregate-metrics":""}`}>{items.map(item=><span key={item.label} className={`metric-${item.tone??"neutral"}`}><small>{item.label}</small>{item.count?<b>{number(item.value)}</b>:<MoneyValue value={item.value} tone={item.tone??"neutral"} className="financial-amount-summary"/>}</span>)}</div>;
}
function PartyAggregateMetrics({partyType,metrics}:{partyType:"customer"|"supplier";metrics:ReturnType<typeof partyAggregateMetrics>}) {
  const customer=partyType==="customer", items:PartyMetricStripItem[]=customer
    ? [{label:"إجمالي ما اشتراه العملاء منا",value:metrics.tradeTotal},{label:"إجمالي ما دفعه العملاء لنا",value:metrics.cashIn,tone:"positive"},{label:"إجمالي ما دفعناه للعملاء",value:metrics.cashOut,tone:"negative"},{label:"إجمالي الربح من مبيعات العملاء",value:metrics.grossProfit,tone:metrics.grossProfit>0?"positive":metrics.grossProfit<0?"negative":"neutral"}]
    : [{label:"إجمالي مشترياتنا من الموردين",value:metrics.tradeTotal},{label:"إجمالي ما دفعناه للموردين",value:metrics.cashOut,tone:"negative"},{label:"إجمالي ما دفعه الموردون لنا",value:metrics.cashIn,tone:"positive"},{label:"عدد فواتير الشراء",value:metrics.invoiceCount,count:true}];
  return <PartyMetricStrip items={items} aggregate/>;
}
function Parties({ partyType, data, run, openParty }: { partyType: "customer" | "supplier"; data: BootstrapData; run: RunCommand; openParty: (p: Party) => void }) {
  const [q,setQ]=useState(""),[name,setName]=useState(""),[phone,setPhone]=useState("");
  const customer=partyType==="customer", noun=customer?"العميل":"المورد", plural=customer?"العملاء":"الموردون";
  const query=normalizeSearch(q), list=data.parties.filter(p=>resolvePartyType(p)===partyType&&(!query||normalizeSearch(`${p.name} ${p.phone}`).includes(query))).sort((a,b)=>a.name.localeCompare(b.name,"ar"));
  const allParties=data.parties.filter(p=>resolvePartyType(p)===partyType),summaries=new Map(data.partyFinancialSummaries.map(summary=>[summary.partyId,summary])),metricMap=new Map(allParties.map(party=>[party.id,partyTradeMetrics(summaries.get(party.id),partyType)] as const)),aggregate=partyAggregateMetrics(data.partyFinancialSummaries,allParties.map(party=>party.id),partyType);
  return <section className={`${customer?"customer":"supplier"}-workspace parties-workspace`}>
    <FramedSection title={`إدارة ${plural}`} className="parties-controls"><CompactSearch value={q} onChange={setQ} placeholder="بحث بالاسم أو الهاتف"/><form className="parties-create" onSubmit={async e=>{e.preventDefault();await run({type:"party.create",partyType,name,phone},`تمت إضافة ${noun}`);setName("");setPhone("")}}><input required value={name} onChange={e=>setName(e.target.value)} placeholder={`اسم ${noun}`}/><input dir="ltr" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="رقم الهاتف"/><button className="primary"><Plus/> إضافة {noun}</button></form></FramedSection>
    <FramedSection title={plural} className="parties-list"><div className="erp-table-wrap party-grid"><table className="erp-table" aria-label={plural}><thead><tr><th>رقم</th><th>اسم {noun}</th><th>الهاتف</th><th>{customer?"إجمالي مشترياته":"إجمالي مشترياتنا منه"}</th>{customer&&<th>الربح الإجمالي</th>}<th>الرصيد الحالي</th><th>إجراء</th></tr></thead><tbody>{list.map((party,index)=>{const balance=party.receivable-party.payable,metric=metricMap.get(party.id)!;return <tr key={party.id} onClick={()=>openParty(party)}><td className="num-cell">{number(index+1)}</td><td className="name-cell">{party.name}</td><td dir="ltr">{party.phone||"—"}</td><td className="num-cell"><MoneyValue value={metric.total}/></td>{customer&&<td className={`num-cell ${Number(metric.grossProfit??0)>0?"metric-positive":Number(metric.grossProfit??0)<0?"metric-negative":"metric-neutral"}`}><MoneyValue value={metric.grossProfit??0} tone={Number(metric.grossProfit??0)>0?"positive":Number(metric.grossProfit??0)<0?"negative":"neutral"}/></td>}<td className={`num-cell ${balance>0?"positive":balance<0?"negative":""}`}><MoneyValue value={Math.abs(balance)} tone={balance>0?"positive":balance<0?"negative":"neutral"}/></td><td className="action-cell"><button className="soft" onClick={event=>{event.stopPropagation();openParty(party)}}>كشف الحساب</button></td></tr>})}{!list.length&&<tr><td colSpan={customer?7:6}>{customer?"لا يوجد عملاء حتى الآن":"لا يوجد موردون"}</td></tr>}</tbody></table></div></FramedSection>
    <PartyAggregateMetrics partyType={partyType} metrics={aggregate}/>
  </section>;
}
function PartyPage({party,data,openDoc,run}:{party:Party;data:BootstrapData;openDoc:(id:string)=>void;run:RunCommand}) {
  const today=localBusinessDay(),[from,setFrom]=useState(today),[to,setTo]=useState(today),[amount,setAmount]=useState(""),[paymentMethod,setPaymentMethod]=useState(""),[direction,setDirection]=useState<"receive"|"pay">("receive"),[note,setNote]=useState("");
  const customer=resolvePartyType(party)==="customer", balance=party.receivable-party.payable,summary=data.partyFinancialSummaries.find(item=>item.partyId===party.id),metrics=partyTradeMetrics(summary,customer?"customer":"supplier");
  // Legacy records remain traceable inside an existing party audit view only.
  const kinds=customer?["sale","return","payment","settlement"]:["purchase","payment","settlement"];
  const docs=data.documents.filter(d=>d.partyId===party.id&&kinds.includes(d.kind)&&(!from||d.occurredAt.slice(0,10)>=from)&&(!to||d.occurredAt.slice(0,10)<=to));
  const submit=async()=>{await run({type:"party-cash.post",partyId:party.id,partyType:resolvePartyType(party),direction,amount:val(amount),paymentMethod,note},"تم تسجيل الحركة");setAmount("");setNote("");setPaymentMethod("")};
  return <section className={`party-detail ${customer?"customer-detail":"supplier-detail"}`}><div className="party-detail-top"><FramedSection title={customer?"حساب العميل":"حساب المورد"} className="party-account-summary"><div className="party-identity"><div className="party-identity-field"><small>الاسم</small><strong>{party.name}</strong><small>الهاتف</small><strong><bdi dir="ltr">{party.phone||"—"}</bdi></strong></div></div><div className={`party-balance ${balance>0?"receivable":balance<0?"payable":"neutral"}`}><span>{balance>0?"مستحق لنا":balance<0?"مستحق علينا":"الحساب متوازن"}</span><MoneyValue value={Math.abs(balance)} tone={balance>0?"positive":balance<0?"negative":"neutral"} className="financial-amount-summary"/></div></FramedSection><FramedSection title="حركة مالية" className="party-payment-panel"><div className="party-payment-row"><div className="party-cash-direction"><button className="selection-option" aria-pressed={direction==="receive"} onClick={()=>setDirection("receive")}>استلام من {customer?"العميل":"المورد"}</button><button className="selection-option" aria-pressed={direction==="pay"} onClick={()=>setDirection("pay")}>دفع لل{customer?"عميل":"مورد"}</button></div><label>الحساب<PaymentAccountSelect accounts={data.paymentAccounts} activeOnly value={paymentMethod} onChange={setPaymentMethod}/></label><label>المبلغ<Num value={amount} onChange={setAmount}/></label><label>ملاحظة<input value={note} onChange={e=>setNote(e.target.value)}/></label><button className="primary" disabled={!Number.isFinite(val(amount))||val(amount)<=0||!paymentMethod} onClick={()=>void submit()}>تسجيل الحركة</button></div></FramedSection></div><FramedSection title="سجل الحساب" className="party-history"><div className="party-history-toolbar"><CompactDateRange from={from} to={to} allTime={!from&&!to} onAllTime={()=>{setFrom("");setTo("")}} onFromChange={setFrom} onToChange={setTo}/></div><Recent title="الحركات" docs={docs} openDoc={openDoc} bare privateAmounts/><PartyMetricStrip items={[{label:customer?"إجمالي ما اشتراه منا":"إجمالي مشترياتنا منه",value:metrics.total},{label:customer?"إجمالي ما دفع لنا":"إجمالي ما دفعناه له",value:customer?summary?.cashIn??0:summary?.cashOut??0},{label:customer?"إجمالي ما دفعناه له":"إجمالي ما دفع لنا",value:customer?summary?.cashOut??0:summary?.cashIn??0},{label:customer?"الربح الإجمالي من مبيعاته":"عدد فواتير الشراء",value:customer?metrics.grossProfit??0:summary?.supplierInvoiceCount??0,tone:customer?(Number(metrics.grossProfit??0)>0?"positive":Number(metrics.grossProfit??0)<0?"negative":"neutral"):"neutral",count:!customer}]}/></FramedSection></section>;
}

export function periodQuantity(documents:DocumentRecord[],productId:string,warehouseId:string,kind:"purchase"|"sale",from:string,to:string){return documents.filter(document=>document.kind===kind&&document.status==="posted"&&document.warehouseId===warehouseId&&(!from||document.occurredAt.slice(0,10)>=from)&&(!to||document.occurredAt.slice(0,10)<=to)).reduce((sum,document)=>sum+document.lines.filter(line=>line.productId===productId).reduce((lineSum,line)=>lineSum+Number(line.quantity),0),0)}

function WarehouseAdmin({data,run,canDelete}:{data:BootstrapData;run:RunCommand;canDelete:boolean}){
  const [newName,setNewName]=useState(""),[names,setNames]=useState<Record<string,string>>({});
  const active=activeWarehouses(data.warehouses);
  return <section className="workspace-page warehouse-admin"><FramedSection title="إضافة مخزن"><div className="warehouse-admin-create"><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="اسم المخزن الجديد"/><button className="primary" disabled={!newName.trim()} onClick={async()=>{await run({type:"warehouse.create",name:newName},"تمت إضافة المخزن");setNewName("")}}><Plus/> إضافة مخزن</button></div></FramedSection><FramedSection title="إدارة المخازن" className="scroll-panel"><div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>المخزن</th><th>الحالة</th><th>الاسم الجديد</th><th>إجراءات</th></tr></thead><tbody>{active.map(warehouse=><tr key={warehouse.id}><td className="name-cell">{warehouse.name}</td><td>{warehouse.isSalesDefault?"مخزن البيع":"نشط"}</td><td><input value={names[warehouse.id]??""} onChange={e=>setNames(current=>({...current,[warehouse.id]:e.target.value}))} placeholder={warehouse.name}/></td><td className="action-cell"><button className="soft" disabled={!names[warehouse.id]?.trim()} onClick={()=>void run({type:"warehouse.update",id:warehouse.id,name:names[warehouse.id]},"تم تعديل اسم المخزن")}>حفظ الاسم</button><button className="soft" disabled={warehouse.isSalesDefault} onClick={()=>void run({type:"warehouse.default",warehouseId:warehouse.id},"تم تعيين مخزن البيع")}>{warehouse.isSalesDefault?"مخزن البيع":"تعيين للبيع"}</button>{canDelete&&<button className="danger compact-delete" onClick={()=>{if(confirm("سيتم حذف المخزن الفارغ أو أرشفته عند وجود تاريخ مرتبط. هل تريد المتابعة؟"))void run({type:"warehouse.delete",id:warehouse.id},"تم حذف أو أرشفة المخزن")}}>حذف</button>}</td></tr>)}</tbody></table></div></FramedSection></section>;
}

function Warehouses({ data, openDoc }: { data: BootstrapData; run: RunCommand; openDoc: (id: string) => void }) {
  const availableWarehouses=activeWarehouses(data.warehouses), [wh, setWh] = useState(activeWarehouses(data.warehouses)[0]?.id ?? ""), [q, setQ] = useState(""), [detailProduct, setDetailProduct] = useState<Product | null>(null), [movementFilter, setMovementFilter] = useState("all");
  const today=localBusinessDay(),[draftFrom,setDraftFrom]=useState(today),[draftTo,setDraftTo]=useState(today),[committedPeriod,setCommittedPeriod]=useState<CommittedPeriod>(null),[hasInventoryView,setHasInventoryView]=useState(false),[periodError,setPeriodError]=useState("");
  const normalized = q.trim().toLocaleLowerCase("ar"), qty = (product: Product) => Number(product.stocks[wh] ?? 0);
  const inventoryProducts = data.products.filter(p => qty(p) > 0), products = inventoryProducts.filter(p => !normalized || `${p.name} ${p.sku} ${p.barcode}`.toLocaleLowerCase("ar").includes(normalized));
  const inventoryValue = inventoryProducts.reduce((sum, product) => sum + qty(product) * inventoryUnitCost(product), 0), totalPieces = inventoryProducts.reduce((sum, product) => sum + qty(product), 0);
  const chooseWarehouse = (value: string) => { setWh(value); setQ(""); setDetailProduct(null); setHasInventoryView(false); setPeriodError(""); };
  const commitPeriod=()=>{if(draftFrom&&draftTo&&draftFrom>draftTo){setPeriodError("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية");return}setPeriodError("");setCommittedPeriod({from:draftFrom,to:draftTo});setHasInventoryView(true)};
  const showAllInventory=()=>{setDraftFrom("");setDraftTo("");setCommittedPeriod(null);setQ("");setHasInventoryView(true);setPeriodError("")};
  const periodFrom=committedPeriod?.from??"",periodTo=committedPeriod?.to??"";
  return <section className="warehouse-workspace"><FramedSection title="جرد المخازن" className="inventory-panel">
    <div className="inventory-overview inventory-toolbar"><SearchableSelect value={wh} onChange={chooseWarehouse} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={availableWarehouses.map(w => ({ value: w.id, label: w.name }))}/><CompactDateRange from={draftFrom} to={draftTo} allTime={hasInventoryView&&committedPeriod===null} onApply={commitPeriod} onAllTime={showAllInventory} onFromChange={setDraftFrom} onToChange={setDraftTo}/><button className="soft inventory-print" disabled={!hasInventoryView} onClick={() => window.print()}><Printer /> طباعة الجرد</button><div className="inventory-overview-metrics"><span><small>عدد المنتجات</small><b>{hasInventoryView?number(inventoryProducts.length):"—"}</b></span><span><small>إجمالي الكمية</small><b>{hasInventoryView?number(totalPieces):"—"}</b></span><span><small>قيمة المخزون</small><b>{hasInventoryView?number(inventoryValue):"—"}</b></span></div></div>
    {periodError&&<small className="period-error">{periodError}</small>}{hasInventoryView?<div className="inventory-browser"><div className="inventory-list-panel"><label className="search compact-search"><Search /><input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالاسم أو الكود أو الباركود" /></label><div className="erp-table-wrap warehouse-scroll inventory-body"><table className="erp-table inventory-grid" aria-label="جرد المخزن"><thead><tr><th>رقم</th><th>اسم المنتج</th><th>الباركود</th><th>سعر الشراء</th><th>الكمية الحالية</th><th>الكمية المشتراة</th><th>الكمية المباعة</th><th>قيمة المخزون</th></tr></thead><tbody>{products.map((product, index) => <tr className={detailProduct?.id === product.id ? "selected" : ""} key={product.id} onClick={() => { setDetailProduct(product); setMovementFilter("all"); }}><td className="num-cell">{number(index + 1)}</td><td className="name-cell">{product.name}{isProductExpired(product)&&<small className="expired-badge">منتهي — غير قابل للبيع</small>}</td><td dir="ltr">{product.barcode||"—"}</td><td className="num-cell">{number(inventoryUnitCost(product))}</td><td className="num-cell">{number(qty(product))}</td><td className="num-cell">{number(periodQuantity(data.documents,product.id,wh,"purchase",periodFrom,periodTo))}</td><td className="num-cell">{number(periodQuantity(data.documents,product.id,wh,"sale",periodFrom,periodTo))}</td><td className="num-cell">{number(qty(product) * inventoryUnitCost(product))}</td></tr>)}{!products.length && <tr><td colSpan={8}>لا توجد منتجات مطابقة للبحث</td></tr>}</tbody></table></div></div></div>:<div className="inventory-empty">اختر الفترة ثم اضغط عرض، أو اختر عرض الكل</div>}{detailProduct&&createPortal(<div className="modal-overlay section-warehouses" role="dialog" aria-modal="true"><div className="modal-card product-movement-modal"><ProductMovementPanel product={detailProduct} selectedWarehouseId={wh} data={data} filter={movementFilter} setFilter={setMovementFilter} close={()=>setDetailProduct(null)} openDoc={openDoc} from={periodFrom} to={periodTo}/></div></div>,document.body)}
  </FramedSection></section>;
}

function ProductMovementPanel({ product, selectedWarehouseId, data, filter, setFilter, close, openDoc, from, to }: { product: Product; selectedWarehouseId: string; data: BootstrapData; filter: string; setFilter: (value: string) => void; close: () => void; openDoc: (id: string) => void; from:string;to:string }) {
  const docs = data.documents.filter(document => document.status === "posted" && (!from||document.occurredAt.slice(0,10)>=from)&&(!to||document.occurredAt.slice(0,10)<=to) && document.lines.some(line => line.productId === product.id));
  const current = totalProductStock(product), selectedQty = stockInWarehouse(product, selectedWarehouseId);
  const selectedWarehouse = data.warehouses.find(warehouse => warehouse.id === selectedWarehouseId);
  const movementDocs = docs.filter(document => filter === "all" || document.kind === filter).sort((a,b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
  const labels: Record<string, string> = { purchase: "شراء", sale: "بيع", transfer: "تحويل", adjustment: "تصحيح", return: "حركة تاريخية", opening: "رصيد افتتاحي" };
  const party = (document: DocumentRecord) => document.partyName || data.parties.find(p => p.id === document.partyId)?.name || (document.kind === "sale" ? "بيع مباشر" : "غير محدد");
  return <FramedSection title="تفاصيل المنتج وحركته" className="product-movement-panel"><div className="movement-product-head"><strong>{product.name}</strong><button className="soft" onClick={()=>window.print()}><Printer/> طباعة</button><button className="icon" aria-label="إغلاق التفاصيل" onClick={close}><X /></button></div><div className="movement-summary"><span><small>الكمية في {selectedWarehouse?.name ?? "المخزن"}</small><b>{number(selectedQty)}</b></span><span><small>إجمالي الكمية</small><b>{number(current)}</b></span><span><small>تكلفة الوحدة</small><b>{number(inventoryUnitCost(product))}</b></span><span><small>القيمة في {selectedWarehouse?.name ?? "المخزن"}</small><b>{number(selectedQty * inventoryUnitCost(product))}</b></span></div><div className="movement-filters">{[["all","الكل"],["purchase","شراء"],["sale","بيع"],["transfer","تحويل"],["adjustment","تصحيح"]].map(([id,label]) => <button key={id} className="choice selection-option" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="erp-table-wrap movement-timeline"><table className="erp-table" aria-label="سجل حركة المنتج"><colgroup><col style={{width:"17%"}}/><col style={{width:"13%"}}/><col style={{width:"27%"}}/><col style={{width:"13%"}}/><col style={{width:"14%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr><th>التاريخ</th><th>العملية</th><th>الطرف / المخزن</th><th>الكمية</th><th>السعر</th><th>المستند</th></tr></thead><tbody>{movementDocs.map(document => { const line = document.lines.find(item => item.productId === product.id)!; const movement = data.movements.find(move => move.documentId === document.id && move.productId === product.id && move.warehouseId === (document.warehouseId ?? selectedWarehouseId)); const details = document.kind === "purchase" ? party(document) : document.kind === "sale" ? party(document) : document.kind === "transfer" ? `${document.warehouseName ?? "—"} ← ${document.destinationWarehouseName ?? "—"}` : `${document.warehouseName ?? movement?.warehouseName ?? "—"} · ${number(movement?.balanceBefore ?? 0)} ← ${number(movement?.balanceAfter ?? 0)} · ${document.title ?? "بدون سبب"}`; return <tr key={document.id} onClick={() => openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td>{labels[document.kind] ?? document.kind}</td><td title={details}>{details}</td><td className="num-cell">{number(movement?.quantityDelta ?? line.quantity)}</td><td className="num-cell">{document.kind === "purchase" || document.kind === "sale" ? money(line.unitPrice) : "—"}</td><td dir="ltr">{displayDocumentNumber(document)}</td></tr>})}{!movementDocs.length && <tr><td colSpan={6}>لا توجد حركات فعلية ضمن هذا الفلتر</td></tr>}</tbody></table></div></FramedSection>;
}

function Products({ data, run }: { data: BootstrapData; run: RunCommand }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<{ key: "price" | "cost" | "stock"; direction: "asc" | "desc" } | null>(null);
  const normalized = query.trim().toLocaleLowerCase("ar");
  const filteredProducts = useMemo(() => data.products.filter(product => showArchived || !product.isArchived).filter(product => !normalized || `${product.name} ${product.sku} ${product.barcode}`.toLocaleLowerCase("ar").includes(normalized)), [data.products, normalized, showArchived]);
  const stockOf = (product: Product) => Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);
  const products = useMemo(() => !sort ? filteredProducts : [...filteredProducts].sort((a, b) => {
    const av = sort.key === "price" ? a.piecePrice : sort.key === "cost" ? a.lastPurchaseCost : stockOf(a), bv = sort.key === "price" ? b.piecePrice : sort.key === "cost" ? b.lastPurchaseCost : stockOf(b);
    if (av == null) return bv == null ? 0 : 1; if (bv == null) return -1;
    return (av - bv) * (sort.direction === "asc" ? 1 : -1);
  }), [filteredProducts, sort]);
  const toggleSort = (key: "price" | "cost" | "stock") => setSort(current => ({ key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" }));
  const sortHeader = (id: "price" | "cost" | "stock", label: string) => <button className={sort?.key === id ? "sort-header active" : "sort-header"} onClick={() => toggleSort(id)}>{label}{sort?.key === id && <span>{sort.direction === "asc" ? "↑" : "↓"}</span>}</button>;
  const openForm = (product: Product | null) => { setEditing(product); setFormOpen(true); };
  const remove = async (product: Product) => { if(window.confirm("سيُحذف المنتج من الاستخدام الجديد مع الاحتفاظ بمخزونه وتاريخه. هل تريد المتابعة؟"))await run({type:"product.delete",id:product.id},"تم حذف المنتج بأمان"); };
  return <section className="workspace-page products-page">
    <div className="toolbar workspace-toolbar">
      <label className="search compact-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="بحث سريع بالاسم أو الرمز أو الباركود" /></label>
      <button className="soft selection-option" aria-pressed={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? "إخفاء المنتجات المحذوفة" : "المنتجات المحذوفة"}</button>
      <button className="primary" onClick={() => openForm(null)}><Plus /> إضافة منتج</button>
    </div>
    <FramedSection title="قائمة المنتجات" className="scroll-panel product-management">
      <div className="erp-table-wrap product-table-viewport">
      <table className="erp-table" aria-label="كل المنتجات"><colgroup><col style={{width:"10%"}}/><col style={{width:"22%"}}/><col style={{width:"11%"}}/><col style={{width:"11%"}}/><col style={{width:"11%"}}/><col style={{width:"12%"}}/><col style={{width:"23%"}}/></colgroup><thead><tr>
        <th>رقم</th><th>الاسم</th><th>{sortHeader("price", "سعر البيع")}</th><th>سعر الجملة</th><th>{sortHeader("cost", "سعر آخر شراء")}</th><th>{sortHeader("stock", "المخزون")}</th><th>إجراءات</th>
      </tr></thead><tbody>
        {products.map((product, index) => {
          const stock = Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);
          return <tr key={product.id}><td className="num-cell">{number(index + 1)}</td><td className="name-cell">{product.name}{product.isArchived&&<small>مؤرشف</small>}{isProductExpired(product)&&<small className="expired-badge">منتهي — غير قابل للبيع</small>}</td><td className="num-cell">{product.piecePrice == null ? "—" : number(product.piecePrice)}</td><td className="num-cell">{product.wholesalePrice == null ? "—" : number(product.wholesalePrice)}</td><td className="num-cell">{product.lastPurchaseCost == null ? "—" : number(product.lastPurchaseCost)}</td><td className="num-cell">{number(stock)}</td><td className="action-cell"><button className="soft" onClick={() => openForm(product)}>تعديل</button><button className="soft" onClick={() => window.alert(`${product.name}\nالباركود: ${product.barcode || "—"}\nتاريخ الانتهاء: ${product.expiryDate || "بدون تاريخ"}\nالحالة: ${isProductExpired(product) ? "منتهي — غير قابل للبيع" : "صالح للبيع"}${product.note ? `\nملاحظة: ${product.note}` : ""}\nسعر الشراء: ${product.pieceCost == null ? "—" : number(product.pieceCost)}\nسعر البيع للفرد: ${product.piecePrice == null ? "—" : number(product.piecePrice)}\nسعر البيع بالجملة: ${product.wholesalePrice == null ? "—" : number(product.wholesalePrice)}\nالمخزون: ${number(stock)}`)}>عرض التفاصيل</button>{product.isArchived?<button className="soft" onClick={()=>void run({type:"product.restore",id:product.id},"تمت استعادة المنتج")}>استعادة</button>:<button className="danger compact-delete" onClick={() => void remove(product)}>حذف</button>}</td></tr>;
        })}
        {!products.length && <Empty text="لا توجد منتجات مطابقة للبحث" />}
      </tbody></table></div>
    </FramedSection>
    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : "إضافة منتج"}><div className="modal-card product-modal"><ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} close={() => setFormOpen(false)} /></div></div>}
  </section>;
}

function ProductForm({ run, close, product, warehouses }: { run: RunCommand; close: () => void; product: Product | null; warehouses: BootstrapData["warehouses"] }) {
  const [name, setName] = useState(product?.name ?? ""), [cost, setCost] = useState(String(product?.pieceCost ?? "")),
    [price, setPrice] = useState(String(product?.piecePrice ?? "")), [wholesalePrice, setWholesalePrice] = useState(String(product?.wholesalePrice ?? "")),
    [openingStock, setOpeningStock] = useState(""), [openingWarehouseId, setOpeningWarehouseId] = useState(warehouses.find(warehouse => warehouse.isSalesDefault)?.id ?? ""),
    [barcode, setBarcode] = useState(product?.barcode ?? ""), [expiryDate, setExpiryDate] = useState(product?.expiryDate ?? ""), [note, setNote] = useState(product?.note ?? "");
  const barcodeInput = useRef<HTMLInputElement>(null);
  return <form className="panel product-form" onSubmit={async event => { event.preventDefault(); const sensitive = product && (name.trim() !== product.name || (cost === "" ? null : val(cost)) !== product.pieceCost); const confirmed = sensitive ? window.confirm(`أنت تغيّر بيانات أساسية للمنتج «${product.name}». هل تريد المتابعة؟`) : true; if (!confirmed) return;
    await run({ type: product ? "product.update" : "product.create", id: product?.id, name, barcode, expiryDate, note, pieceCost: cost, piecePrice: price, wholesalePrice, openingStock, openingWarehouseId, confirmSensitive: confirmed }, product ? "تم تعديل المنتج" : "تم إنشاء المنتج"); close(); }}>
    <div className="product-form-head"><div><small>{product ? "بيانات المنتج" : "منتج جديد"}</small><h2>{product ? "تعديل المنتج" : "إضافة منتج جديد"}</h2></div><button type="button" className="icon" aria-label="إغلاق" onClick={close}><X /></button></div>
    <div className="product-form-halves">
      <FramedSection title="المعلومات الأساسية" className="product-form-group">
        <label>اسم المنتج<input required value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="barcode-field">الباركود<input ref={barcodeInput} dir="ltr" autoComplete="off" value={barcode} onChange={event => setBarcode(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /><button type="button" className="soft" onClick={() => barcodeInput.current?.focus()}>مسح الباركود</button></label>
        <label>تاريخ انتهاء الصلاحية — اختياري<input type="date" dir="ltr" value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></label>
        <label>ملاحظة عن المنتج — اختياري<textarea maxLength={1000} rows={2} value={note} onChange={event => setNote(event.target.value)} /></label>
      </FramedSection>
      <FramedSection title="الأسعار والمخزون" className="product-form-group">
        <label>سعر الشراء للفرد<Num value={cost} onChange={setCost} /></label><label>سعر البيع للفرد<Num value={price} onChange={setPrice} /></label><label>سعر البيع بالجملة<Num value={wholesalePrice} onChange={setWholesalePrice} /></label>
        <label>{product ? "إضافة رصيد افتتاحي" : "رصيد البداية"}<Num value={openingStock} onChange={value => { setOpeningStock(value); if (!value || Number(value) <= 0) setOpeningWarehouseId(""); else if (!openingWarehouseId) setOpeningWarehouseId(warehouses.find(warehouse => warehouse.isSalesDefault)?.id ?? ""); }} /></label>
        {val(openingStock) > 0 && <label>مخزن رصيد البداية<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} /></label>}
      </FramedSection>
    </div><div className="product-form-actions"><button type="button" className="soft" onClick={close}>إلغاء</button><button className="primary">{product ? "حفظ التعديلات" : "حفظ المنتج"}</button></div>
  </form>;
}

function StockDraftTable({ mode, lines, products, warehouseId, onChange, onRemove }: { mode: "transfer" | "adjust"; lines: DraftLine[]; products: Product[]; warehouseId: string; onChange: (line: DraftLine) => void; onRemove: (id: string) => void }) {
  const adjustment = mode === "adjust";
  return <div className="erp-table-wrap stock-draft"><table className="erp-table" aria-label="المنتجات الجاري تنفيذ العملية عليها"><colgroup><col style={{width:"7%"}}/><col style={{width:adjustment?"27%":"37%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/>{adjustment&&<col style={{width:"20%"}}/>}<col style={{width:"8%"}}/></colgroup><thead><tr><th>رقم</th><th>المنتج</th><th>{adjustment ? "المخزون الحالي" : "المتوفر"}</th><th>{adjustment ? "الكمية الفعلية" : "الكمية للتحويل"}</th>{adjustment&&<th>تكلفة الوحدة</th>}<th>حذف</th></tr></thead><tbody>{lines.map((line,index)=>{const product=products.find(item=>item.id===line.productId)!;const available=Number(product?.stocks[warehouseId]??0);const increasing=adjustment&&line.actualQuantity!==""&&val(line.actualQuantity)>available;return <tr key={line.productId}><td className="num-cell">{number(index+1)}</td><td>{product.name}</td><td className="num-cell">{number(available)}</td><td><Num value={adjustment?line.actualQuantity:line.quantity} onChange={value=>onChange(adjustment?{...line,actualQuantity:value}:{...line,quantity:value})}/></td>{adjustment&&<td>{increasing&&product.lastPurchaseCost==null?<Num value={line.unitPrice} onChange={value=>onChange({...line,unitPrice:value})} placeholder="مطلوب"/>:<span className="draft-cost">{number(inventoryUnitCost(product))}</span>}</td>}<td className="action-cell"><button type="button" className="icon danger" aria-label={`حذف ${product.name}`} onClick={()=>onRemove(line.productId)}><X/></button></td></tr>})}{!lines.length&&<tr><td colSpan={adjustment?6:5} className="draft-empty">أضف منتجًا لبدء العملية</td></tr>}</tbody></table></div>;
}

function MultiStockForm({
  data,
  mode,
  run,
  openDoc,
  prefill,
  clearPrefill,
}: {
  data: BootstrapData;
  mode: "transfer" | "adjust";
  run: RunCommand;
  openDoc: (id: string) => void;
  prefill?: AdjustmentPrefill | null;
  clearPrefill?: () => void;
}) {
  const [from, setFrom] = useSessionDraft(`${mode}-from`, prefill?.warehouseId ?? ""),
    [to, setTo] = useSessionDraft(`${mode}-to`, ""),
    [q, setQ] = useState(""),
    [reason, setReason] = useSessionDraft(`${mode}-reason`, ""),
    [lines, setLines] = useSessionDraft<DraftLine[]>(`${mode}-lines`, (() => {
      const product = data.products.find((item) => item.id === prefill?.productId);
      return product ? [lineFor(product)] : [];
    })());
  useEffect(() => {
    if (mode !== "adjust" || !prefill) return;
    const product = data.products.find(item => item.id === prefill.productId);
    setFrom(prefill.warehouseId);
    setLines(product ? [{ ...lineFor(product), actualQuantity: "", unitPrice: "" }] : []);
    setReason("");
  }, [data.products, mode, prefill, setFrom, setLines, setReason]);
  async function submit() {
    const body =
      mode === "transfer"
        ? {
            type: "transfer.post",
            fromWarehouseId: from,
            toWarehouseId: to,
            lines: lines.map((l) => ({
              productId: l.productId,
              quantity: val(l.quantity),
            })),
          }
        : {
            type: "adjustment.post",
            warehouseId: from,
            reason,
            lines: lines.map((l) => ({
              productId: l.productId,
              actualQuantity: val(l.actualQuantity),
              purchaseCost: l.unitPrice === "" ? null : val(l.unitPrice),
            })),
          };
    const id = await run(
      body,
      mode === "transfer" ? "تم التحويل بين المخازن" : "تم تسجيل تصحيح المخزون",
    );
    setLines([]);
    setReason("");
    setQ("");
    if (mode === "adjust") clearPrefill?.();
    openDoc(id);
  }
  const invalidAdjustment = mode === "adjust" && lines.some(line => {
    const product = data.products.find(item => item.id === line.productId);
    const before = Number(product?.stocks[from] ?? 0);
    return line.actualQuantity === "" || (val(line.actualQuantity) > before && product?.lastPurchaseCost == null && val(line.unitPrice) <= 0);
  });
  return (
    <div className="form-stack stock-operation-panel">
      <div className="form-row">
        <label>
          {mode === "transfer" ? "من" : "المخزن"}
          <SearchableSelect value={from} onChange={setFrom} placeholder="اختر المخزن" searchPlaceholder="ابحث عن مخزن" options={activeWarehouses(data.warehouses).map(w => ({ value: w.id, label: w.name }))} />
        </label>
        {mode === "transfer" && (
          <label>
            إلى
            <SearchableSelect value={to} onChange={setTo} placeholder="اختر الوجهة" searchPlaceholder="ابحث عن مخزن الوجهة" options={activeWarehouses(data.warehouses).filter(w => w.id !== from).map(w => ({ value: w.id, label: w.name }))} />
          </label>
        )}
      </div>
      <SearchProducts
        data={data}
        query={q}
        setQuery={setQ}
        mode={mode === "adjust" ? "adjustment" : "transfer"}
        warehouseId={from}
        stockScope="selected-warehouse"
        collapseResultsWhenIdle
        onPick={(p) => {
          setLines((x) =>
            x.some((l) => l.productId === p.id) ? x : [...x, mode === "adjust" ? { ...lineFor(p), unitPrice: "" } : lineFor(p)],
          );
          setQ("");
        }}
      />
      <StockDraftTable mode={mode} lines={lines} products={activeProducts(data.products)} warehouseId={from} onChange={(line) => setLines(current => current.map(item => item.productId === line.productId ? line : item))} onRemove={(productId) => setLines(current => current.filter(item => item.productId !== productId))} />
      {mode === "adjust" && (
        <label>سبب التصحيح<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: نتيجة الجرد الفعلي" /></label>
      )}
      <button
        className="primary stock-primary-action"
        disabled={!from || (mode === "transfer" && !to) || !lines.length || (mode === "adjust" && (!reason.trim() || invalidAdjustment))}
        onClick={() => void submit()}
      >
        {mode === "transfer" ? "اعتماد التحويل" : "اعتماد التصحيح"}
      </button>
    </div>
  );
}
function Transfer(p: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
}) {
  const transfers = p.data.documents.filter((document) => document.kind === "transfer");
  return (
    <section className="stock-workspace">
      <FramedSection title="تحويل بين المخازن" className="stock-workspace-main" allowOverflow><MultiStockForm {...p} mode="transfer" /></FramedSection>
      <FramedSection title="سجل التحويلات" className="records transfer-history"><div className="erp-table-wrap transfer-list"><table className="erp-table" aria-label="سجل التحويلات"><colgroup><col style={{width:"20%"}}/><col style={{width:"24%"}}/><col style={{width:"20%"}}/><col style={{width:"20%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr><th>التاريخ</th><th>المستند</th><th>من</th><th>إلى</th><th>الكمية</th></tr></thead><tbody>{transfers.map(document => <tr key={document.id} onClick={() => p.openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td dir="ltr">{displayDocumentNumber(document)}</td><td>{document.warehouseName ?? "—"}</td><td>{document.destinationWarehouseName ?? "—"}</td><td className="num-cell">{number(document.lines.reduce((sum, line) => sum + Number(line.quantity), 0))}</td></tr>)}{!transfers.length && <tr><td colSpan={5}>لا توجد تحويلات مسجلة</td></tr>}</tbody></table></div></FramedSection>
    </section>
  );
}
function Adjustment(p: {
  data: BootstrapData;
  run: RunCommand;
  openDoc: (id: string) => void;
  prefill?: AdjustmentPrefill | null;
  clearPrefill?: () => void;
}) {
  return (
    <section className="stock-workspace adjustment-workspace">
      <FramedSection title="تصحيح المخزون" className="stock-workspace-main" allowOverflow><MultiStockForm {...p} mode="adjust" /></FramedSection>
      <Recent
        title="سجل التصحيحات"
        docs={p.data.documents.filter((d) => d.kind === "adjustment")}
        openDoc={p.openDoc}
      />
    </section>
  );
}
function Records({
  data,
  openDoc,
}: {
  data: BootstrapData;
  openDoc: (id: string) => void;
}) {
  const today = localBusinessDay(), [kind, setKind] = useState("sale"),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [allTime, setAllTime] = useState(false);
  const docs = filterDocumentsByDate(data.documents.filter(
    (d) =>
      d.status === "posted" &&
      (!kind || d.kind === kind) &&
      (!q ||
        `${displayDocumentNumber(d)} ${d.number} ${d.legacyBillCode ?? ""} ${d.partyName ?? ""} ${d.title ?? ""}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  ), from, to, allTime);
  return (
    <section className="records-workspace">
      <FramedSection title="بحث السجلات" className="records-filters"><div className="filters">
        <CompactSearch value={q} onChange={setQ} placeholder="رقم المستند أو الطرف" />
        <select className="records-kind-filter" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">كل المعاملات</option>
          {Object.entries(visibleDocumentKindLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <CompactDateRange from={from} to={to} allTime={allTime} onAllTime={() => { setFrom(""); setTo(""); setQ(""); setKind(""); setAllTime(true); }} onFromChange={value => { setFrom(value); setAllTime(false); }} onToChange={value => { setTo(value); setAllTime(false); }} />
      </div></FramedSection>
      <Recent title="كل السجلات القابلة للتتبع" docs={docs} openDoc={openDoc} />
    </section>
  );
}
const reportNames: Record<ReportType,string> = { overview:"التقرير الشامل",sales:"حركة المبيعات",purchases:"حركة المشتريات","product-sales":"حركة المنتجات",stock:"حركة المخزون",profit:"تحليل الأرباح",debts:"الحسابات والديون","party-ledger":"كشف حسابات الأطراف",financial:"الحركة المالية",expenses:"المصاريف" };
const reportColumns = (type: ReportType, productId: string, groupBy: string): Array<[string,string]> => ({
 overview:[["date","التاريخ"],["sales","المبيعات"],["purchases","المشتريات"],["expenses","المصاريف"],["received","المقبوض"],["paid","المدفوع"],["net","صافي الحركة"]],
 sales:productId?[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["product","المنتج"],["quantity","الكمية"],["unitPrice","سعر البيع"],["cost","تكلفة الشراء"],["profit","الربح"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","العميل / بيع مباشر"],["total","قيمة البيع"],["cost","تكلفة الشراء"],["profit","الربح"]],
 purchases:productId?[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","المورد"],["product","المنتج"],["quantity","الكمية"],["unitPrice","سعر الشراء"],["total","إجمالي المنتج"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["party","المورد"],["paymentMethod","طريقة التسوية"],["total","الإجمالي"],["paid","المدفوع"],["due","المستحق"]],
 "product-sales":[["product","اسم المنتج"],["soldQuantity","الكمية المباعة"],["currentQuantity","الكمية الحالية"],["netSales","صافي المبيعات"],["purchasedQuantity","الكمية المشتراة"],["purchases","إجمالي المشتريات"],["netPurchases","صافي المشتريات"],["averagePrice","متوسط سعر البيع"],["averagePurchasePrice","متوسط سعر الشراء"],["profit","الربح"]],
 stock:[["occurredAt","التاريخ"],["product","المنتج"],["warehouse","المخزن"],["movementType","العملية"],["before","قبل"],["change","التغيير"],["after","بعد"],["documentNumber","المستند"]],
 profit:groupBy==="product"?[["product","اسم المنتج"],["quantity","الكمية"],["revenue","صافي المبيعات"],["cost","التكلفة"],["profit","الربح"],["margin","الهامش %"],["invoiceCount","عدد الفواتير"]]:[["number","رقم الفاتورة"],["occurredAt","التاريخ"],["revenue","صافي المبيعات"],["cost","التكلفة"],["profit","الربح"],["margin","الهامش %"]],
 debts:[["name","اسم الحساب"],["accountType","نوع الحساب"],["phone","الهاتف"],["balance","الرصيد المستحق"],["lastMovement","آخر حركة"]],
 "party-ledger":[["occurredAt","التاريخ"],["movementType","نوع العملية"],["documentNumber","رقم المستند"],["description","البيان"],["debit","مدين"],["credit","دائن"],["paymentMethod","وسيلة الدفع"]],
 financial:[["occurredAt","التاريخ"],["paymentMethod","وسيلة الدفع"],["movementType","نوع العملية"],["incoming","داخل"],["outgoing","خارج"],["party","الطرف"],["documentNumber","المستند"]],
 expenses:[["occurredAt","التاريخ"],["title","عنوان المصروف"],["recurring","النوع"],["paymentMethod","وسيلة الدفع"],["total","المبلغ"],["number","المستند"]],
} as Record<ReportType,Array<[string,string]>>)[type];
// Legacy stock rows can appear in the unfiltered audit view but are not selectable.
const movementLabels: Record<string,string>={sale:"بيع",purchase:"شراء","sale-return":"حركة تاريخية","transfer-in":"تحويل داخل","transfer-out":"تحويل خارج",adjustment:"تصحيح مخزون",opening:"رصيد بداية",expense:"مصروف","party-receipt":"تحصيل من طرف","party-payment":"دفع لطرف",payment:"دفعة",settlement:"تسوية",offset:"مقاصة"};
function Reports({ data, openDoc, type }: { data: BootstrapData; openDoc: (id: string) => void; type: ReportType }) {
  const today=localBusinessDay(),[draftFrom,setDraftFrom]=useState(today),[draftTo,setDraftTo]=useState(today),[committedPeriod,setCommittedPeriod]=useState<CommittedPeriod>(()=>({from:today,to:today})),[partyId,setPartyId]=useState(""),[productId,setProductId]=useState(""),[accountId,setAccountId]=useState(""),[groupBy,setGroupBy]=useState("invoice"),[sortState,setSortState]=useState<{key:string;direction:"asc"|"desc"}|null>(null),[movementType,setMovementType]=useState(""),[direction,setDirection]=useState(""),[debtSide,setDebtSide]=useState(""),[search,setSearch]=useState(""),[result,setResult]=useState<ReportResponse|null>(null),[busy,setBusy]=useState(false),[reportError,setReportError]=useState("");
  const [partyTypeFilter,setPartyTypeFilter]=useState<"customer"|"supplier">("customer");
  const reportRequest=useRef<AbortController|null>(null);
  const runReport=async(period:CommittedPeriod)=>{if(type==="party-ledger"&&!partyId){setReportError(partyTypeFilter==="customer"?"اختر العميل أولاً":"اختر المورد أولاً");return}reportRequest.current?.abort();const controller=new AbortController();reportRequest.current=controller;setBusy(true);setReportError("");const q=new URLSearchParams({type,unpaged:"true"});if(type!=="debts")Object.entries(reportDateQuery(period===null,period?.from??"",period?.to??"")).forEach(([key,value])=>q.set(key,value));const add=(key:string,value:string)=>{if(value)q.set(key,value)};if(["sales","purchases","product-sales","profit","stock"].includes(type))add("productId",productId);if(type==="party-ledger")add("partyId",partyId);if(["sales","purchases","financial","expenses"].includes(type))add("paymentAccountId",accountId);if(type==="profit")add("groupBy",groupBy);if(type==="stock")add("movementType",movementType);if(type==="financial")add("direction",direction);if(type==="debts"){add("debtSide",debtSide);add("search",search)}try{const response=await fetch(`/api/reports?${q}`,{signal:controller.signal}),json=await response.json();if(!response.ok)throw new Error(json.error);if(!controller.signal.aborted)setResult(json)}catch(error){if((error as Error).name!=="AbortError")setReportError(error instanceof Error?error.message:"تعذر إنشاء التقرير")}finally{if(reportRequest.current===controller)setBusy(false)}};
  const applyDraftPeriod=()=>{if(draftFrom&&draftTo&&draftFrom>draftTo){setReportError("تاريخ البداية يجب ألا يتجاوز تاريخ النهاية");return}const period={from:draftFrom,to:draftTo};setCommittedPeriod(period);void runReport(period)};
  const applyAllTime=()=>{setDraftFrom("");setDraftTo("");setCommittedPeriod(null);setProductId("");setAccountId("");setMovementType("");setDirection("");setDebtSide("");setSearch("");void runReport(null)};
  useEffect(()=>{if(!result||(type==="party-ledger"&&!partyId))return;const timer=window.setTimeout(()=>void runReport(committedPeriod),180);return()=>window.clearTimeout(timer);// eslint-disable-next-line react-hooks/exhaustive-deps
  },[productId,accountId,groupBy,movementType,direction,debtSide,search,partyId]);
  const productOptions=data.products.map(p=>({value:p.id,label:`${p.name}${p.isArchived ? " (مؤرشف)" : ""}`,search:`${p.name} ${p.sku??""} ${p.barcode??""}`})),partyOptions=data.parties.filter(p=>resolvePartyType(p)===partyTypeFilter).map(p=>({value:p.id,label:p.name,search:`${p.name} ${p.phone??""}`})),accountName=(id:unknown)=>data.paymentAccounts.find(a=>a.id===id||a.code===id)?.name??(id?"حساب غير متاح":"—"),table=reportTableModel(reportColumns(type,productId,groupBy),result),columns=table.columns,showDates=type!=="debts";
  const numericKeys=new Set(["quantity","unitPrice","total","cost","profit","margin","paid","due","sales","purchases","expenses","received","net","soldQuantity","currentQuantity","purchasedQuantity","netPurchases","netSales","averagePrice","averagePurchasePrice","invoiceCount","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit","products"]);
  const monetaryKeys=new Set(["unitPrice","total","cost","profit","paid","due","sales","purchases","expenses","received","net","netPurchases","netSales","averagePrice","averagePurchasePrice","before","change","after","incoming","outgoing","receivable","payable","balance","debit","credit"]);
  const display=(key:string,value:unknown)=>{if(numericKeys.has(key))return number(reportNumber(value));if(key==="paymentMethod")return accountName(value);if(key==="movementType")return type==="party-ledger"?String(value??"—"):movementLabels[String(value)]??"عملية غير معروفة";if(key==="occurredAt"||key==="lastMovement")return value?formatDateTime(String(value)):"—";if(key==="date")return value?formatDate(String(value)):"—";if(typeof value==="number")return number(reportNumber(value));if(typeof value==="boolean")return value?"متكرر":"مرة واحدة";return String(value??"—")};
  const nonMoneySummaryKeys=new Set(["count","quantity","products","movements","margin","netChange"]);
  const footerMetrics=result?buildReportFooterMetrics({type,result,productFiltered:Boolean(productId),partyType:partyTypeFilter}):[];
  const sortedRows=!sortState?table.rows:[...table.rows].sort((left,right)=>{const leftValue=left[sortState.key],rightValue=right[sortState.key],numeric=typeof leftValue==="number"||typeof rightValue==="number";const comparison=numeric?reportNumber(leftValue)-reportNumber(rightValue):String(leftValue??"").localeCompare(String(rightValue??""),"ar");return sortState.direction==="asc"?comparison:-comparison});
  const toggleReportSort=(key:string)=>setSortState(current=>current?.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:numericKeys.has(key)?"desc":"asc"});
  if(type==="overview") {
    const groups = (["sale","purchase","expense"] as const).map(kind => ({ kind, label: kind === "sale" ? "فواتير البيع" : kind === "purchase" ? "فواتير الشراء" : kind === "expense" ? "فواتير المصاريف" : "فواتير المصاريف", rows: (result?.invoices ?? []).filter(invoice => invoice.kind === kind) })).filter(group => group.rows.length);
    return <section className="reports-workspace overview-workspace comprehensive-report" onKeyDown={e=>{if(e.key==="Enter"&&e.target===e.currentTarget)void applyDraftPeriod()}}><div className="overview-print-title"><strong>{APP_NAME}</strong><h2>التقرير الشامل</h2><span>{committedPeriod===null?"الفترة: كل السجلات":`الفترة: من ${formatDate(committedPeriod?.from??draftFrom)} إلى ${formatDate(committedPeriod?.to??draftTo)}`}</span></div><FramedSection title="بيانات التقرير" className="report-toolbar overview-toolbar no-print"><CompactDateRange from={draftFrom} to={draftTo} allTime={committedPeriod===null} onApply={()=>void applyDraftPeriod()} onAllTime={()=>void applyAllTime()} onFromChange={setDraftFrom} onToChange={setDraftTo}/><button className="report-print-button" onClick={()=>window.print()}><Printer/> طباعة</button></FramedSection>{reportError&&<div className="error">{reportError}</div>}{busy&&<div className="report-loading">جاري إعداد التقرير…</div>}{result?<div className="overview-grid"><FramedSection title="الحسابات" className="overview-accounts"><div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>رقم</th><th>اسم الحساب</th><th>نوع الحساب</th><th>مستحق له</th><th>مستحق عليه</th></tr></thead><tbody>{(result.parties??[]).map((p,i)=><tr key={String(p.id)}><td>{number(i+1)}</td><td>{p.name}</td><td>{p.partyType==="customer"?"عميل":"مورد"}</td><td className="num-cell">{p.partyType==="supplier"?<MoneyValue value={reportNumber(p.payable)} tone="negative"/>:"—"}</td><td className="num-cell">{p.partyType==="customer"?<MoneyValue value={reportNumber(p.receivable)} tone="positive"/>:"—"}</td></tr>)}</tbody></table></div></FramedSection><FramedSection title="الفواتير" className="overview-invoices"><div className="erp-table-wrap"><table className="erp-table overview-invoice-table"><thead><tr><th>رقم</th><th>نوع الفاتورة</th><th>التاريخ</th><th>قيمة الفاتورة</th><th>التكلفة</th><th>الربح</th></tr></thead><tbody>{groups.map(group=><Fragment key={group.kind}><tr className="invoice-group-row"><th colSpan={6}>{group.label}</th></tr>{group.rows.map((d,i)=><tr key={d.id} onClick={()=>openDoc(d.documentId)}><td>{number(i+1)}</td><td>{d.type}</td><td>{formatDate(d.occurredAt)}</td><td className="num-cell"><MoneyValue value={reportNumber(d.invoiceValue)}/></td><td className="num-cell"><MoneyValue value={reportNumber(d.cost)}/></td><td className={`num-cell ${d.profit===null?"":d.profit>0?"positive":d.profit<0?"negative":""}`}>{d.profit===null?"—":<MoneyValue value={reportNumber(d.profit)} tone={d.profit>0?"positive":d.profit<0?"negative":"neutral"}/>}</td></tr>)}</Fragment>)}</tbody></table></div><div className="overview-business-strip">{[["sales","إجمالي المبيعات"],["salesCost","تكلفة المبيعات"],["salesProfit","ربح المبيعات"],["purchases","إجمالي المشتريات"],["expenses","إجمالي المصاريف"],["netOperatingResult","نتيجة الفترة بعد المصاريف"]].map(([key,label])=><span key={key}><small>{label}</small><b className={["salesProfit","netOperatingResult"].includes(key)?(reportNumber(result.summary[key])>0?"positive":reportNumber(result.summary[key])<0?"negative":""):""}><MoneyValue value={reportNumber(result.summary[key])} tone={["salesProfit","netOperatingResult"].includes(key)?(reportNumber(result.summary[key])>0?"positive":reportNumber(result.summary[key])<0?"negative":"neutral"):"neutral"}/></b></span>)}</div></FramedSection><div className="report-summary-area overview-summary-area" aria-label="ملخص الوضع الحالي"><div className="report-kpis"><span className="report-kpi"><small>إجمالي الأرصدة الحالية</small><span className="report-kpi-value"><b className={`summary-${reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"}`}><MoneyValue value={reportNumber(result.summary.currentAccountsBalance)} tone={reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"} className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>إجمالي قيمة المخزون</small><span className="report-kpi-value"><b className="summary-neutral"><MoneyValue value={reportNumber(result.summary.currentInventoryValue)} tone="neutral" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>إجمالي المستحق لنا</small><span className="report-kpi-value"><b className="summary-positive"><MoneyValue value={reportNumber(result.summary.currentReceivable)} tone="positive" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>إجمالي المستحق علينا</small><span className="report-kpi-value"><b className="summary-negative"><MoneyValue value={reportNumber(result.summary.currentPayable)} tone="negative" className="financial-amount-summary"/></b></span></span></div></div></div>:<div className="overview-empty">اختر الفترة ثم اضغط عرض</div>}</section>;
  }
  return <section className="reports-workspace" onKeyDown={e=>{if(e.key==="Enter"&&e.target===e.currentTarget)void applyDraftPeriod()}}><FramedSection title="بيانات البحث" className="report-toolbar no-print">{showDates&&<CompactDateRange from={draftFrom} to={draftTo} allTime={committedPeriod===null} onApply={()=>void applyDraftPeriod()} onAllTime={()=>void applyAllTime()} onFromChange={setDraftFrom} onToChange={setDraftTo}/>}{!showDates&&<button className="primary" onClick={applyDraftPeriod}>عرض</button>}<button className="report-print-button" onClick={()=>window.print()}><Printer/> طباعة</button><div className="report-filters">
  {["sales","purchases","product-sales","profit","stock"].includes(type)&&<SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="كل المنتجات" searchPlaceholder="ابحث بالاسم أو الرمز أو الباركود" allowEmpty/>}
  {type==="party-ledger"&&<div className="party-ledger-filter"><div className="party-type-toggle"><button type="button" className="selection-option" aria-pressed={partyTypeFilter==="customer"} onClick={()=>{if(partyTypeFilter!=="customer"){setPartyTypeFilter("customer");setPartyId("");setResult(null)}}}>العملاء</button><button type="button" className="selection-option" aria-pressed={partyTypeFilter==="supplier"} onClick={()=>{if(partyTypeFilter!=="supplier"){setPartyTypeFilter("supplier");setPartyId("");setResult(null)}}}>الموردون</button></div><SearchableSelect value={partyId} onChange={setPartyId} options={partyOptions} placeholder={partyTypeFilter==="customer"?"اختر العميل":"اختر المورد"} searchPlaceholder={partyTypeFilter==="customer"?"ابحث عن عميل بالاسم أو الهاتف":"ابحث عن مورد بالاسم أو الهاتف"}/></div>}
  {["sales","purchases","financial","expenses"].includes(type)&&<PaymentAccountSelect accounts={data.paymentAccounts} value={accountId} onChange={setAccountId} placeholder="كل وسائل الدفع"/>}
  {type==="profit"&&<select value={groupBy} onChange={e=>setGroupBy(e.target.value)}><option value="invoice">حسب الفاتورة</option><option value="product">حسب المنتج</option></select>}
  {type==="stock"&&<select value={movementType} onChange={e=>setMovementType(e.target.value)}><option value="">كل الحركات</option>{Object.entries(movementLabels).filter(([k])=>["sale","purchase","transfer-in","transfer-out","adjustment","opening"].includes(k)).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select>}{type==="financial"&&<select value={direction} onChange={e=>setDirection(e.target.value)}><option value="">داخل وخارج</option><option value="in">داخل</option><option value="out">خارج</option></select>}{type==="debts"&&<><select value={debtSide} onChange={e=>setDebtSide(e.target.value)}><option value="">الجميع</option><option value="receivable">لنا عليه</option><option value="payable">له علينا</option><option value="clear">حساب خالص</option></select><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف"/></>}
  </div></FramedSection><div className="print-report-title"><h2>{reportNames[type]}</h2>{showDates&&<span>{committedPeriod===null ? "كل الفترة" : <>من {formatDate(committedPeriod?.from??draftFrom)} إلى {formatDate(committedPeriod?.to??draftTo)}</>}</span>}</div>{reportError&&<div className="error report-error">{reportError}</div>}<FramedSection title={reportNames[type]} className="report-body">{busy&&<div className="report-loading">جاري إعداد التقرير…</div>}<div className="erp-table-wrap"><table className={`erp-table report-table report-table-${type}`}><colgroup>{type==="sales"&&(productId?<><col style={{width:"5%"}}/><col style={{width:"17%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"10%"}}/><col style={{width:"11%"}}/><col style={{width:"11%"}}/><col style={{width:"10%"}}/></>:<><col style={{width:"5%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/><col style={{width:"20%"}}/><col style={{width:"13%"}}/><col style={{width:"13%"}}/><col style={{width:"13%"}}/></>)}</colgroup><thead><tr><th className="serial">رقم</th>{columns.map(([key,label])=><th key={key}><button type="button" className="report-sort-header" onClick={()=>toggleReportSort(key)}>{label}{sortState?.key===key&&(sortState.direction==="asc"?" ↑":" ↓")}</button></th>)}</tr></thead><tbody>{sortedRows.map((row,i)=><tr key={String(row.id??i)} onClick={()=>row.documentId&&openDoc(String(row.documentId))}><td className="num-cell">{number(i+1)}</td>{columns.map(([key])=><td key={key} title={key==="number"?String(row[key]??""):undefined} className={`${numericKeys.has(key)||typeof row[key]==="number"?"num-cell ":""}${key==="occurredAt"?"date-cell":""}`}>{monetaryKeys.has(key)?<MoneyValue value={reportNumber(row[key])} tone={key==="profit"||key==="net"||key==="balance"?(reportNumber(row[key])>0?"positive":reportNumber(row[key])<0?"negative":"neutral"):"neutral"}/>:display(key,row[key])}</td>)}</tr>)}</tbody></table></div></FramedSection>{result&&<div className="report-summary-area">{type==="sales"&&reportNumber(result.summary.unknownRevenue)>0&&<p className="report-summary-warning">يوجد جزء من المبيعات دون تكلفة تاريخية مؤكدة؛ قد يكون ربح المبيعات أعلى من الواقع.</p>}<div className="report-kpis">{footerMetrics.map(metric=><span className="report-kpi" key={metric.key}><small>{metric.label}</small><span className="report-kpi-value"><b className={`summary-${metric.tone}`}>{metric.format==="percent"||nonMoneySummaryKeys.has(metric.key)?<span className="financial-amount">{number(metric.value)}{metric.format==="percent"?"%":""}</span>:<MoneyValue value={metric.value} tone={metric.tone} className="financial-amount-summary"/>}</b>{metric.note&&<em>{metric.note}</em>}</span></span>)}</div></div>}</section>;
}
type OfficialPresentation={title:string;meta:Array<[string,string]>;columns?:string[];rows?:string[][];totals?:Array<[string,string]>;tone?:"positive"|"negative"|"neutral"};
function paymentName(record:DocumentRecord,data:BootstrapData){return record.paymentMethod==="note"?"ملاحظة / دين":data.paymentAccounts.find(a=>a.id===record.paymentMethod||a.code===record.paymentMethod)?.name??"—"}
function buildDocumentPresentation(record:DocumentRecord,data:BootstrapData):OfficialPresentation{
 const remaining=Math.max(0,record.dueTotal-record.paidTotal),reference=displayDocumentNumber(record),date=formatDateTime(record.occurredAt),payment=paymentName(record,data);
 const common:Array<[string,string]>=[["المرجع",reference],["التاريخ",date]];
 if(record.kind==="sale"||record.kind==="purchase")return{title:record.kind==="sale"?"فاتورة بيع":"فاتورة شراء",meta:[...common,[record.kind==="sale"?"العميل":"المورد",record.partyName||(record.kind==="sale"?"بيع مباشر":"غير محدد")],[record.kind==="sale"?"المخزن":"المخزن المستلم",record.warehouseName||"—"],[record.kind==="sale"?"طريقة الدفع":"طريقة التسوية",payment],...(record.kind==="sale"?[["الحالة",remaining>0?"متبقي / دين":"مدفوعة"] as [string,string]]:[])],columns:["رقم","المنتج","الكمية",record.kind==="purchase"?"سعر الشراء":"سعر الوحدة","المجموع"],rows:record.lines.map((l,i)=>[number(i+1),l.description,quantity(l.quantity),money(l.unitPrice),money(l.lineTotal)]),totals:[["الإجمالي",money(record.total)],...(record.dueTotal>0?[["المدفوع",money(record.paidTotal)],["المتبقي",money(remaining)]] as Array<[string,string]>:[])]};
 if(record.kind==="transfer")return{title:"سند تحويل مخزون",meta:[...common,["من المخزن",record.warehouseName||"—"],["إلى المخزن",record.destinationWarehouseName||"—"]],columns:["رقم","المنتج","الكمية"],rows:record.lines.map((l,i)=>[number(i+1),l.description,quantity(l.quantity)])};
 if(record.kind==="adjustment")return{title:"سند تصحيح مخزون",meta:[...common,["المخزن",record.warehouseName||"—"]],columns:["رقم","المنتج","الكمية"],rows:record.lines.map((l,i)=>[number(i+1),l.description,quantity(l.quantity)])};
 if(record.kind==="payment"){const receive=record.partyCashDirection?record.partyCashDirection==="receive":!/دفع|صرف/.test(record.title??"");return{title:receive?"سند قبض":"سند صرف",meta:[...common,[receive?"استلام من":"دفع إلى",record.partyName||"—"],["الحساب",payment],["البيان",record.title||"—"]],totals:[["المبلغ",money(record.cashAmount??record.paidTotal??record.total)]],tone:receive?"positive":"negative"}}
 if(record.kind==="expense")return{title:"سند مصروف",meta:[...common,["عنوان المصروف",record.title||"مصروف"],["وسيلة الدفع",payment],...(record.recurringId?[["النوع","مصروف متكرر"] as [string,string]]:[])],totals:[["المبلغ",money(record.total)]],tone:"negative"};
 return{title:record.kind==="offset"?"سند مقاصة":record.kind==="settlement"?"تسوية حساب":kindLabels[record.kind],meta:[...common,["الطرف",record.partyName||"—"],["البيان",record.title||"—"]],totals:record.total?[["المبلغ",money(record.total)]]:undefined};
}
function OfficialRecordSheet({presentation,branding}:{presentation:OfficialPresentation;branding:InvoiceBrandingSettings}){const style={fontFamily:invoiceFontFamilies[branding.nameFont],fontSize:`${branding.nameFontSize}pt`,fontWeight:branding.nameFontWeight} as CSSProperties,businessLine=[branding.storeAddress,branding.storePhone].filter(Boolean).join(" · "),registrationLine=[branding.registrationNumber&&`السجل التجاري: ${branding.registrationNumber}`,branding.taxNumber&&`الرقم الضريبي: ${branding.taxNumber}`].filter(Boolean).join(" · ");return <article className="official-record-sheet"><header className="official-record-header"><strong style={style}>{branding.storeName}</strong>{businessLine&&<span className="official-business-meta">{businessLine}</span>}{registrationLine&&<span className="official-business-meta">{registrationLine}</span>}<h1>{presentation.title}</h1><span>{presentation.meta.slice(0,2).map(x=>x[1]).join(" · ")}</span></header><div className="official-record-meta">{presentation.meta.slice(2).map(([label,value])=><span key={label}><small>{label}</small><b>{value}</b></span>)}</div>{presentation.columns&&<div className="official-record-table-wrap"><table className="official-record-table"><thead><tr>{presentation.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{presentation.rows?.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}{presentation.totals&&<div className={`official-record-totals ${presentation.tone??"neutral"}`}>{presentation.totals.map(([label,value])=><span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>}<footer>{branding.footerNote&&<span>{branding.footerNote}</span>}<small>تم إنشاء هذا المستند بواسطة {APP_NAME}</small></footer></article>}
function PrintableDocument({document:record,data}:{document:DocumentRecord;data:BootstrapData}){return createPortal(<div className="document-print-portal"><OfficialRecordSheet presentation={buildDocumentPresentation(record,data)} branding={data.branding}/></div>,window.document.body)}
function DocumentDetail({document,data,close,onEdit}:{document:DocumentRecord;data:BootstrapData;close:()=>void;onEdit?: () => void}){
 function printDocument(){const root=window.document.documentElement,cleanup=()=>root.classList.remove("print-document-mode");root.classList.add("print-document-mode");window.addEventListener("afterprint",cleanup,{once:true});window.print();window.setTimeout(cleanup,1500)}
 function download(){const p=buildDocumentPresentation(document,data),content=[`${p.title} ${displayDocumentNumber(document)}`,...p.meta.map(x=>`${x[0]}: ${x[1]}`),...(p.rows??[]).map(x=>x.join(" | ")),...(p.totals??[]).map(x=>`${x[0]}: ${x[1]}`)].join("\n"),a=window.document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));a.download=`${displayDocumentNumber(document)}.txt`;a.click();URL.revokeObjectURL(a.href)}
 return <section className="official-document-layout"><div className="official-document-toolbar"><button className="back" onClick={close}>← العودة</button>{onEdit && (<button className="primary" onClick={onEdit}><PencilLine /> تعديل الفاتورة</button>)}<button className="soft" onClick={printDocument}><Printer/> طباعة</button><button className="soft" onClick={download}>تنزيل</button></div><div className="official-document-scroll"><OfficialRecordSheet presentation={buildDocumentPresentation(document,data)} branding={data.branding}/><Linked document={document} data={data}/></div><PrintableDocument document={document} data={data}/></section>
}
function Linked({
  document,
  data,
}: {
  document: DocumentRecord;
  data: BootstrapData;
}) {
  const linked = data.documents.filter(
    (d) =>
      d.parentDocumentId === document.id || d.id === document.parentDocumentId,
  );
  return linked.length ? (<div className="panel"><Heading title="المعاملات المرتبطة" /><div className="erp-table-wrap"><table className="erp-table"><colgroup><col style={{width:"34%"}}/><col style={{width:"36%"}}/><col style={{width:"30%"}}/></colgroup><thead><tr><th>المعاملة</th><th>المستند</th><th>المبلغ</th></tr></thead><tbody>{linked.map(d => <tr key={d.id}><td>{kindLabels[d.kind]}</td><td dir="ltr">{displayDocumentNumber(d)}</td><td className="num-cell">{number(d.total)}</td></tr>)}</tbody></table></div></div>) : null;
}

function InvoiceQuickBrowser({ title, docs, openDoc }: { title: string; docs: DocumentRecord[]; openDoc: (id: string) => void }) {
  const today = localBusinessDay(), [from, setFrom] = useState(today), [to, setTo] = useState(today), [allTime, setAllTime] = useState(false);
  const visible = filterDocumentsByDate(docs, from, to, allTime);
  const statusCustomer = (document: DocumentRecord) => { const credit = document.paymentMethod === "note" || document.dueTotal > 0 || document.paidTotal < document.total; const customer = document.partyName?.trim() || "بيع مباشر"; if (credit) return `${customer} · ملاحظة`; if (document.status === "posted" || document.paidTotal >= document.total) return `${customer} · مدفوعة`; return `${customer} · معتمدة`; };
  return <FramedSection title={title} className="quick-invoices"><div className="quick-invoice-head"><CompactDateRange from={from} to={to} allTime={allTime} onAllTime={() => setAllTime(true)} onFromChange={value => { setFrom(value); setAllTime(false); }} onToChange={value => { setTo(value); setAllTime(false); }} /></div><div className="erp-table-wrap quick-invoice-list"><table className="erp-table"><colgroup><col style={{width:"30%"}}/><col style={{width:"44%"}}/><col style={{width:"26%"}}/></colgroup><thead><tr><th>رقم الفاتورة</th><th>الحالة / العميل</th><th>المبلغ</th></tr></thead><tbody>{visible.map(document => <tr key={document.id} onClick={() => openDoc(document.id)}><td dir="ltr">{displayDocumentNumber(document)}</td><td>{statusCustomer(document)}</td><td className="num-cell">{number(document.total)}</td></tr>)}{!visible.length && <tr><td colSpan={3}>لا توجد فواتير في هذه الفترة</td></tr>}</tbody></table></div></FramedSection>;
}

function Recent({
  title,
  docs,
  openDoc,
  dateFilter = false,
  bare = false,
  privateAmounts = false,
}: {
  title: string;
  docs: DocumentRecord[];
  openDoc: (id: string) => void;
  dateFilter?: boolean;
  bare?: boolean;
  privateAmounts?: boolean;
}) {
  const today = localBusinessDay();
  const [from, setFrom] = useState(dateFilter ? today : "");
  const [to, setTo] = useState(dateFilter ? today : "");
  const visibleDocs = dateFilter
    ? docs.filter((document) => {
        const occurredOn = localBusinessDay(document.occurredAt);
        if (!from && !to) return occurredOn === today;
        return (!from || occurredOn >= from) && (!to || occurredOn <= to);
      })
    : docs;
  const table = <>{dateFilter && <div className="filters recent-date-filters"><label>من تاريخ<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>إلى تاريخ<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>}<div className="erp-table-wrap"><table className="erp-table"><colgroup><col style={{width:"6%"}}/><col style={{width:"17%"}}/><col style={{width:"18%"}}/><col style={{width:"15%"}}/><col style={{width:"20%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/></colgroup><thead><tr><th>رقم</th><th>التاريخ</th><th>المستند</th><th>النوع</th><th>الطرف</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>{visibleDocs.map((d,index) => <tr key={d.id} onClick={() => openDoc(d.id)}><td className="num-cell">{number(index+1)}</td><td>{formatDateTime(d.occurredAt)}</td><td dir="ltr">{displayDocumentNumber(d)}</td><td>{kindLabels[d.kind]}</td><td className="name-cell">{d.partyName ?? d.title ?? "—"}</td><td>{d.dueTotal > 0 && d.paidTotal < d.dueTotal ? "مستحق" : "معتمد"}</td><td className="num-cell">{privateAmounts?<MoneyValue value={d.total}/>:number(d.total)}</td></tr>)}{!visibleDocs.length && <tr><td colSpan={7}>لا توجد فواتير ضمن الفترة المحددة</td></tr>}</tbody></table></div></>;
  return bare ? table : <FramedSection title={title} className="records recent-table">{table}</FramedSection>;
}
function Heading({ title }: { title: string }) {
  return (
    <div className="heading">
      <h2>{title}</h2>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function InlineCreate({
  label,
  onSave,
}: {
  label: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState("");
  return (
    <div className="mini-form">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={label}
      />
      <button className="primary" onClick={() => void onSave(v)}>
        حفظ
      </button>
    </div>
  );
}
