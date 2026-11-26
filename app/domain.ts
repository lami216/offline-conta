import { getDisplayCurrencyCode, type CurrencySettings } from "../lib/currency-core";
import { formatAccountingDecimal, formatAccountingPercentage } from "../lib/accounting-format";
import { displayDocumentNumber as formatDocumentReference } from "../lib/document-sequences.ts";
export type PaymentMethod = string;
export type DocumentKind =
  | "purchase"
  | "sale"
  /** Legacy read-only document kind; new creation is disabled. */
  | "return"
  | "transfer"
  | "adjustment"
  | "expense"
  | "payment"
  | "offset"
  | "settlement"
  | "account-transfer"
  | "account-adjustment"
  | "party-opening"
  | "employee-opening"
  | "employee-accrual"
  | "employee-payment"
  | "employee-closure";
export type PartyType = "customer" | "supplier" | "trader";
export interface Party {
  id: string;
  name: string;
  phone: string;
  partyType: PartyType;
  receivable: number;
  payable: number;
  net: number;
  isArchived?: boolean;
  archivedAt?: string | null;
}
/** Single compatibility authority: pre-role parties were suppliers in Conta. */
export function resolvePartyType(party: unknown): PartyType {
  const role = (party as { partyType?: unknown } | null)?.partyType;
  return role === "trader" ? "trader" : role === "customer" ? "customer" : "supplier";
}
/** A shared trader keeps one identity and supports either commercial invoice role. */
export function supportsPartyRole(party: unknown, role: "customer" | "supplier") {
  const actual = resolvePartyType(party);
  return actual === "trader" || actual === role;
}
export interface Warehouse {
  id: string;
  name: string;
  isSalesDefault: boolean;
  isArchived?: boolean;
  archivedAt?: string | null;
}
export function activeWarehouses<T extends Pick<Warehouse, "isArchived">>(warehouses: T[]) { return warehouses.filter(warehouse => !warehouse.isArchived); }
export interface ProductCategory {
  id: string;
  name: string;
  createdAt?: string;
}
export interface ExpenseCategory {id:string;name:string;kind?:"recurring"|"nonrecurring";isArchived?:boolean;revision?:number;createdAt?:string;updatedAt?:string}
export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  /** Editable product-card purchase price; never an accounting cost authority by itself. */
  pieceCost: number | null;
  /** Effective accounting cost: newest posted purchase, otherwise an opening-cost fallback. */
  lastPurchaseCost?: number | null;
  lastPurchaseAt?: string | null;
  lastPurchaseCostSource?: "purchase" | "opening" | "legacy-opening" | "adjustment" | null;
  /** Native opening balance metadata. Historical movement replay remains authoritative for consumed quantity. */
  openingStock?: number | null;
  openingCost?: number | null;
  openingWarehouseId?: string | null;
  /** Imported DataAcc cost fallback. The imported stock row is a snapshot, not an editable native opening balance. */
  legacyOpeningCost?: number | null;
  piecePrice: number | null;
  /** Optional wholesale selling price per individual unit. */
  wholesalePrice: number | null;
  /** Optional business expiry date. The product is sellable through this day. */
  expiryDate?: string | null;
  note?: string | null;
  categoryId?: string | null;
  stocks: Record<string, number>;
  isArchived?: boolean;
  archivedAt?: string | null;
}

/** Products available when creating a new operation. Archived rows remain in
 * bootstrap data for inventory valuation and historical identity. */
export function activeProducts<T extends Pick<Product, "isArchived">>(products: T[]) {
  return products.filter(product => !product.isArchived);
}

export function isProductExpired(product: unknown, businessDate = new Date().toISOString().slice(0, 10)) {
  const expiryDate = (product as { expiryDate?: unknown } | null)?.expiryDate;
  return typeof expiryDate === "string" && expiryDate !== "" && expiryDate < businessDate;
}
export interface DocumentLine {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  lineTotalMode?: "exact";
  costAtSale?: number | null;
  grossProfit?: number | null;
  balanceBefore?: number;
  balanceAfter?: number;
}
export interface DocumentRecord {
  id: string;
  number: string;
  sequence?: number;
  settlementSequence?: number;
  legacyBillCode?: string;
  kind: DocumentKind;
  partyId: string | null;
  partyName: string | null;
  partyNameOriginal?: string | null;
  partyNameSnapshot?: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  destinationWarehouseId: string | null;
  destinationWarehouseName: string | null;
  parentDocumentId: string | null;
  paymentMethod: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  status: string;
  title: string | null;
  employeeId?: string;
  employeeName?: string;
  employeePaymentDirection?: "withdraw" | "deposit";
  employeePaymentVersion?: 2;
  employeeOpeningDirection?: "payable" | "receivable";
  employeeOpeningAnchor?: { openingDocumentId: string };
  amount?: number;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  balanceDelta?: number;
  salaryReserveReleased?: number;
  allocations?: Array<{accrualId:string;amount:number}>;
  partyOpeningDirection?: "receivable"|"payable";
  partyOpeningAmount?: number;
  partyOpeningContribution?: number;
  expenseCategoryId?: string | null;
  expenseCategoryName?: string | null;
  note?: string | null;
  /** Opening-stock audit metadata for initial balances and later corrections. */
  openingCorrection?: boolean;
  openingStockBefore?: number | null;
  openingStockAfter?: number | null;
  openingCostBefore?: number | null;
  openingCostAfter?: number | null;
  /** Final inventory correction generated while archiving/cleaning an archived product. */
  productArchiveStockClearance?: boolean;
  total: number;
  dueTotal: number;
  paidTotal: number;
  /** Actual cash moved; legacy documents fall back to paidTotal. */
  cashAmount?: number;
  partyCashDirection?: "receive" | "pay";
  accountAdjustmentDirection?: "deposit" | "withdrawal";
  partyBalanceBefore?: number;
  partyBalanceDelta?: number;
  partyBalanceAfter?: number;
  occurredAt: string;
  businessDate?: string;
  recordedAt?: string;
  createdAt?: string;
  dailySequence?: number;
  recurringId?: string;
  legacyKey?: string;
  pricingMode?: "retail" | "wholesale";
  revision?: number;
  updatedAt?: string;
  voidedAt?: string;
  lines: DocumentLine[];
}
export interface Movement {
  id: string;
  documentId: string;
  documentNumber: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  type: string;
  quantityDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  occurredAt: string;
  documentRevision?: number;
}
export interface EmployeeAgreement {id:string;startDate:string;endDate?:string;stopDate?:string;canceledAt?:string;amount:number;intervalMonths:number;entitlement:"beginning"|"end"}
export interface Employee {id:string;name:string;phone:string;startDate:string;accountStartDate?:string;balance:number;revision:number;isArchived?:boolean;isDeleted?:boolean;deletedAt?:string;deletionDocumentId?:string|null;agreements:EmployeeAgreement[]}
export interface BootstrapData {
  /** Audit-only opening entries, kept separate from active operational documents. */
  employeeOpeningHistory?: DocumentRecord[];
  employees?: Employee[];
  principal: { principalType: "local" | "owner" | "user"; name: string; permissions: string[] };
  branding: InvoiceBrandingSettings;
  currency: CurrencySettings;
  /** Informational only; product.create allocates the authoritative value atomically. */
  nextProductCode: number;
  /** Informational previews; posting remains authoritative and allocates atomically. */
  nextDocumentSequences: { sale: number; purchase: number; expense: number };
  parties: Party[];
  warehouses: Warehouse[];
  products: Product[];
  categories: ProductCategory[];
  expenseCategories?: ExpenseCategory[];
  documents: DocumentRecord[];
  movements: Movement[];
  financialMovements: FinancialMovement[];
  partyFinancialSummaries: PartyFinancialSummary[];
  paymentAccounts: PaymentAccount[];
  accountTransfers: AccountTransferRecord[];
}
export interface AccountTransferRecord {
  id: string;
  documentId?: string;
  number: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  note: string | null;
  occurredAt: string;
  status?: "posted" | "voided";
  revision?: number;
  updatedAt?: string;
  voidedAt?: string;
}
export const invoiceFonts = ["tahoma", "arial", "segoe-ui", "times-new-roman"] as const;
export type InvoiceFont = typeof invoiceFonts[number];
export type InvoiceBrandingSettings = {
  storeName: string;
  storeLogoDataUrl: string;
  storePhone: string;
  storeAddress: string;
  registrationNumber: string;
  taxNumber: string;
  footerNote: string;
  nameFont: InvoiceFont;
  nameFontSize: number;
  nameFontWeight: 400 | 600 | 800;
};
export interface PartyFinancialSummary {
  partyId: string;
  cashIn: number;
  cashOut: number;
  customerTradeTotal: number;
  customerGrossProfit: number;
  supplierTradeTotal: number;
  supplierInvoiceCount: number;
}
export interface PaymentAccount {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string;
  isActive: boolean;
  allowNegativeBalance: boolean;
  balance: number;
  /** Persisted starting basis; bootstrap normalizes legacy rows to a finite value. */
  openingBalance: number;
  income: number;
  expenses: number;
  purchaseTotal: number;
  isArchived?: boolean;
  archivedAt?: string | null;
}
export function activePaymentAccounts<T extends Pick<PaymentAccount, "isActive" | "isArchived">>(accounts: T[]) { return accounts.filter(account => account.isActive !== false && account.isArchived !== true); }
export interface FinancialMovement {
  importedFrom?: string;
  employeeId?: string;
  employeeName?: string;
  id: string;
  paymentMethod: string;
  direction: "in" | "out";
  amount: number;
  documentId: string;
  documentNumber: string;
  partyId: string | null;
  partyName: string | null;
  partyNameOriginal?: string | null;
  type: string;
  occurredAt: string;
  transferId?: string | null;
  note?: string | null;
  status?: "posted" | "reversed";
  revision?: number;
  isReversal?: boolean;
  reversedAt?: string;
  reversalMovementId?: string;
  reversalReason?: string;
  reversalOfMovementId?: string;
  delta?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  openingBalanceBefore?: number;
  openingBalanceAfter?: number;
  reason?: string;
}
export const paymentMethods: Array<{
  id: Exclude<PaymentMethod, "note">;
  label: string;
}> = [
  { id: "cash", label: "نقدي" },
  { id: "bankily", label: "بنكيلي" },
  { id: "masrvi", label: "مصرفي" },
  { id: "sedad", label: "السداد" },
  { id: "bimbank", label: "بيم" },
];
export const kindLabels: Record<DocumentKind, string> = {
  "party-opening": "رصيد بداية الديون",
  "employee-accrual": "استحقاق عامل",
  "employee-payment": "حركة حساب عامل",
  "employee-closure": "إقفال حساب عامل",
  "employee-opening": "رصيد بداية عامل",
  purchase: "فاتورة شراء",
  sale: "فاتورة بيع",
  return: "حركة تاريخية",
  transfer: "تحويل مخزون",
  adjustment: "تصحيح مخزون",
  expense: "فاتورة مصروفات",
  payment: "سداد",
  offset: "مقاصة",
  settlement: "تسوية يدوية للرصيد",
  "account-transfer": "تحويل بين الحسابات",
  "account-adjustment": "سحب / إيداع",
};
/** Give native party cash movements a direction-specific label, leaving legacy payment records unchanged. */
export function documentKindLabel(document: Pick<DocumentRecord, "kind" | "partyCashDirection" | "employeePaymentDirection">, partyType?: PartyType): string {
  if (document.kind === "employee-payment") return document.employeePaymentDirection === "deposit" ? "إيداع العامل" : "سحب العامل";
  if (document.kind !== "payment" || !document.partyCashDirection) return kindLabels[document.kind];
  if (partyType === "supplier") return document.partyCashDirection === "receive" ? "استلام من المورد" : "دفع للمورد";
  if (partyType === "customer") return document.partyCashDirection === "receive" ? "استلام من العميل" : "دفع للعميل";
  if (partyType === "trader") return document.partyCashDirection === "receive" ? "استلام من التاجر" : "دفع للتاجر";
  return document.partyCashDirection === "receive" ? "استلام من الطرف" : "دفع للطرف";
}
/** Current document kinds offered by user-facing filters. */
export const visibleDocumentKindLabels = Object.fromEntries(
  Object.entries(kindLabels).filter(([kind]) => kind !== "return").map(([kind, label]) => [kind, kind === "payment" ? "دفع واستلام" : label]),
) as Partial<Record<DocumentKind, string>>;
export function western(value: number | string) {
  return String(value)
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}
const DISPLAY_LOCALE = "fr-FR-u-nu-latn";
const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  maximumFractionDigits: 3,
  numberingSystem: "latn",
});

/** Format display values with Latin digits without changing stored data. */
export function formatNumber(value: number) {
  return western(numberFormatter.format(value));
}
export function formatQuantity(value: number) {
  return formatNumber(value);
}
export function formatMoney(value: number) {
  return `${formatNumber(value)} ${getDisplayCurrencyCode()}`;
}
export function accountingNumber(value: number) {
  return western(formatAccountingDecimal(DISPLAY_LOCALE, value));
}
export function accountingMoney(value: number) {
  return `${accountingNumber(value)} ${getDisplayCurrencyCode()}`;
}
export function accountingPercent(value: number) {
  return western(formatAccountingPercentage(DISPLAY_LOCALE, value));
}
export function displayDocumentNumber(document: Pick<DocumentRecord, "number" | "sequence" | "kind">) {
  return formatDocumentReference(document);
}
/** Accounting-backed inventory valuation. Manual pieceCost never silently becomes historical cost. */
export function inventoryUnitCost(product: Pick<Product, "lastPurchaseCost" | "openingCost" | "legacyOpeningCost">) {
  return product.lastPurchaseCost ?? product.openingCost ?? product.legacyOpeningCost ?? 0;
}
/** Ordinary products share one accounting unit cost across warehouses. Keep the
 * existing selected-warehouse quantity calculation; no lot or card-price fallback. */
export function inventoryValueAcrossWarehouses(product: Pick<Product, "stocks" | "lastPurchaseCost" | "openingCost" | "legacyOpeningCost">, warehouseIds: string[]) {
  const quantity=warehouseIds.reduce((sum,warehouseId)=>sum+Number(product.stocks?.[warehouseId]??0),0);
  return quantity*inventoryUnitCost(product);
}
export function inventoryAverageUnitCostAcrossWarehouses(product: Pick<Product, "lastPurchaseCost" | "openingCost" | "legacyOpeningCost">, warehouseIds: string[]) {
  // The common UI supplies its scope, but ordinary cost is not warehouse-specific.
  void warehouseIds;
  return inventoryUnitCost(product);
}
export function formatDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" },
) {
  return western(new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    ...options,
    numberingSystem: "latn",
  }).format(new Date(value)));
}
export function formatDateTime(value: Date | string | number) {
  return formatDate(value, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Existing view-facing names share the same central formatting policy.
export const money = accountingMoney;
export const number = formatNumber;
export function quantity(value: number) {
  return formatQuantity(value);
}
/** Total availability, only for views that intentionally span every warehouse. */
export function totalProductStock(product: Pick<Product, "stocks">) {
  return Object.values(product.stocks ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
}
/** Exact availability in one warehouse; a missing stock entry is zero, never the global total. */
export function stockInWarehouse(product: Pick<Product, "stocks">, warehouseId?: string) {
  if (!warehouseId) return 0;
  return Number(product.stocks?.[warehouseId] ?? 0);
}
export function saleLineTotal(qty: number, piecePrice: number) {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.round(qty * piecePrice);
}
export function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
