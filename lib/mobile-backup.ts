/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import type { ContaBackup } from './backup.ts';
import { mobileCostBasisSignature } from './product-cost.ts';
import { resolveInvoiceLineTotal } from '../app/invoice-line-amount.ts';

type Row = Record<string, any>;
type ImportedBackup = ContaBackup & { mobileImport: { sourceFormat: 'alkarna-web-backup'; schemaVersion: 1 } };
const COLLECTIONS = ['employees', 'parties', 'warehouses', 'products', 'productCategories', 'expenseCategories', 'documents', 'stockMovements', 'financialMovements', 'paymentAccounts', 'recurringExpenses', 'accountTransfers', 'counters', 'auditEvents', 'appSettings', 'users', 'importMappings'] as const;
const KINDS = new Set(['sale', 'purchase', 'expense', 'receive', 'pay', 'deposit', 'withdraw', 'transfer', 'stocktransfer', 'adjustment', 'offset']);
const commercial = (kind: string) => kind === 'sale' || kind === 'purchase';
const id = (kind: string, value: string | number) => `mobile23:${kind}:${value}`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const warehouseId = (name: string) => id('warehouse', digest(name).slice(0, 20));
const fail = (detail: string): never => { throw new Error(`نسخة Mobile غير متوافقة: ${detail}`); };
const record = (value: unknown, label: string): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : fail(label);
const array = (value: unknown, label: string): Row[] => Array.isArray(value) ? value : fail(label);
const numeric = (value: unknown, label: string, signed = false) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e14 && (signed || value >= 0) ? value : fail(label);
const positiveId = (value: unknown, label: string) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail(label);
const text = (value: unknown, label: string, optional = false) => typeof value === 'string' && (optional || value.trim()) ? value : optional && value === undefined ? '' : fail(label);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const near = (left: number, right: number) => Math.abs(left - right) <= Math.min(1e-7, Math.max(1e-9, Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 16));
const sameMoney = (left: number, right: number) => near(money(left), money(right));
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function jsonData(value: unknown, seen = new Set<object>(), depth = 0): void {
  if (depth > 80) fail('بنية متداخلة أكثر من الصيغة المدعومة');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || seen.has(value)) return fail('بيانات غير قابلة للحفظ بصيغة JSON');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) fail('كائن غير مدعوم في النسخة');
  seen.add(value);
  for (const child of Object.values(value)) jsonData(child, seen, depth + 1);
  seen.delete(value);
}
function day(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(label);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01') return fail(label);
  return value;
}
function timestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return fail(label);
  return value;
}
function rowMap(rows: Row[], label: string) {
  const result = new Map<number, Row>();
  for (const input of rows) { const row = record(input, label), key = positiveId(row.id, `معرف ${label}`); if (result.has(key)) fail(`معرف ${label} مكرر: ${key}`); result.set(key, row); }
  return result;
}
function openingMap(value: unknown, known: Set<string>, label: string, signed: boolean) {
  const values = record(value, label), result = new Map<string, number>();
  for (const [key, amount] of Object.entries(values)) { if (!known.has(key)) fail(`${label} يشير إلى معرف غير موجود: ${key}`); result.set(key, numeric(amount, label, signed)); }
  return result;
}
function unsupported(row: Row, label: string) {
  for (const key of ['discount', 'discountAmount', 'discountTotal', 'tax', 'taxRate', 'taxTotal', 'employeeId', 'perfumeAllocations', 'allocations', 'batchId', 'returnedQuantity']) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== 0 && value !== '' && (!Array.isArray(value) || value.length)) fail(`${label}: الحقل المالي ${key} غير مدعوم`);
  }
}

/** Pure conversion of the approved-runtime schema used by Android23. No DB,
 * authentication, device settings or cloud configuration is read or activated.
 * Current records have one effective posting; embedded revisions/stockEvents
 * remain immutable original evidence, never fabricated native movement proofs. */
export function convertMobileBackup(value: unknown): ImportedBackup {
  jsonData(value);
  const raw = record(value, 'ملف غير صالح'), state = jsonClone(record(raw.state, 'state مفقود'));
  if (raw.format !== 'alkarna-web-backup' || raw.schemaVersion !== 1) fail('صيغة أو إصدار غير مدعوم');
  const createdAt = timestamp(raw.createdAt, 'وقت إنشاء النسخة غير صالح');
  if (state.featureSchema !== undefined && state.featureSchema !== 2) fail('إصدار ميزات Mobile غير مدعوم');
  const priorDesktop = state.desktopOriginal == null ? null : record(state.desktopOriginal, 'مصدر Desktop السابق غير صالح');
  const originalExpenseCategories: Row[] = [];
  if (priorDesktop) {
    if (priorDesktop.format !== 'conta-backup' || priorDesktop.schemaVersion !== 1) fail('إصدار مصدر Desktop السابق غير مدعوم');
    const prior = record(priorDesktop.collections, 'أجزاء مصدر Desktop السابق مفقودة');
    for (const key of ['products', 'parties', 'warehouses', 'documents', 'paymentAccounts', 'financialMovements']) array(prior[key], `جزء Desktop السابق ${key} مفقود`);
    if (prior.employees?.length || prior.recurringExpenses?.some((row: Row) => row.isActive === true)) fail('مصدر Desktop السابق يحتوي التزامات موظفين أو جدولة غير ممثلة في Mobile');
    const priorKinds = new Set(['sale', 'purchase', 'expense', 'payment', 'transfer', 'account-transfer', 'adjustment', 'offset', 'account-adjustment']);
    for (const d of prior.documents) {
      if (!priorKinds.has(d.kind)) fail(`نوع Desktop سابق غير ممثل في Mobile: ${String(d.kind)}`);
      unsupported(d, `سند Desktop السابق ${String(d.id)}`);
      for (const l of d.lines ?? []) unsupported(l, `بند Desktop السابق ${String(d.id)}`);
    }
    for (const p of prior.products) if (p.perfumeForm || p.perfumeStockUnit || p.perfumeLots?.length || p.parentProductId || p.decantSizeMl != null) fail('مصدر Desktop السابق يحتوي وحدات أو تقسيمات غير ممثلة في Mobile');
    for (const category of prior.expenseCategories ?? []) {
      const row = record(category, 'فئة مصروف Desktop سابقة غير صالحة');
      if (typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80 || row.kind !== undefined && !['recurring', 'nonrecurring'].includes(row.kind)) fail('فئة مصروف Desktop سابقة غير صالحة');
      originalExpenseCategories.push(row);
    }
  }
  for (const key of ['employees', 'employeeDocuments', 'recurringExpenses', 'returns', 'expenseCategories', 'batches']) if (state[key] !== undefined && (!Array.isArray(state[key]) || state[key].length)) fail(`بيانات مالية غير مدعومة: ${key}`);
  array(raw.users, 'users مفقود');
  if (state.users !== undefined) array(state.users, 'مستخدمو المصدر غير صالحين');
  const products = rowMap(array(state.products, 'products مفقود'), 'المنتج');
  const parties = rowMap(array(state.parties, 'parties مفقود'), 'الطرف');
  const accounts = rowMap(array(state.accounts, 'accounts مفقود'), 'الحساب');
  const records = rowMap(array(state.records, 'records مفقود'), 'السند');
  const categories = rowMap(state.categories === undefined ? [] : array(state.categories, 'الفئات غير صالحة'), 'الفئة');
  const warehouses: string[] = Array.isArray(state.warehouses) ? state.warehouses : fail('المخازن مفقودة');
  if (!warehouses.length || new Set(warehouses).size !== warehouses.length || warehouses.some(name => typeof name !== 'string' || !name.trim() || name.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(name))) fail('أسماء المخازن غير صالحة أو مكررة');
  const warehouseNames = new Set(warehouses), meta = state.warehouseMeta === undefined ? {} : record(state.warehouseMeta, 'بيانات المخازن غير صالحة');
  for (const name of warehouses) if (meta[name] !== undefined && (typeof meta[name] !== 'object' || typeof meta[name].archived !== 'boolean')) fail('حالة المخزن غير صالحة');
  const salesWarehouse = state.salesWarehouse ?? state.warehouse;
  if (!warehouseNames.has(salesWarehouse) || meta[salesWarehouse]?.archived === true) fail('مخزن البيع الافتراضي غير صالح');
  if (!warehouseNames.has(state.warehouse)) fail('المخزن المحدد غير موجود');
  const opening = record(state.opening, 'الأرصدة الافتتاحية مفقودة');
  const openingAccounts = openingMap(opening.accounts, new Set([...accounts.keys()].map(String)), 'رصيد الحساب الافتتاحي', true);
  const openingParties = openingMap(opening.parties, new Set([...parties.keys()].map(String)), 'رصيد الطرف الافتتاحي', true);
  const sourceOpeningStocks = record(opening.stocks, 'المخزون الافتتاحي مفقود'), openingStocks = new Map<number, Map<string, number>>();
  for (const key of Object.keys(sourceOpeningStocks)) if (!products.has(Number(key)) || String(Number(key)) !== key) fail('المخزون الافتتاحي يشير إلى منتج غير موجود');
  const categoryNames = new Set<string>(), barcodes = new Set<string>();
  for (const category of categories.values()) { const name = text(category.name, 'اسم الفئة غير صالح').trim(); if (name.length > 80 || categoryNames.has(name.toLocaleLowerCase())) fail('اسم فئة مكرر أو طويل'); categoryNames.add(name.toLocaleLowerCase()); }
  for (const p of products.values()) {
    text(p.name, `اسم المنتج ${p.id} غير صالح`); text(p.sku, `باركود المنتج ${p.id} غير صالح`, true);
    for (const key of ['price', 'cost']) numeric(p[key], `قيمة ${key} للمنتج ${p.id} غير صالحة`);
    if (p.wholesale !== undefined && p.wholesale !== null) numeric(p.wholesale, `سعر جملة المنتج ${p.id} غير صالح`);
    for (const key of ['note', 'expiry']) if (p[key] != null) text(p[key], `حقل ${key} للمنتج ${p.id} غير صالح`, true);
    if (p.expiry) day(p.expiry, `صلاحية المنتج ${p.id} غير صالحة`);
    if (p.openingCost !== undefined && p.openingCost !== null) numeric(p.openingCost, `تكلفة افتتاحية للمنتج ${p.id} غير صالحة`);
    if (p.legacyOpeningCost !== undefined && p.legacyOpeningCost !== null) numeric(p.legacyOpeningCost, `تكلفة افتتاحية قديمة للمنتج ${p.id} غير صالحة`);
    if (p.categoryId && !categories.has(p.categoryId)) fail(`فئة المنتج ${p.id} غير موجودة`);
    const stocks = record(p.stocks, `مخزون المنتج ${p.id} غير صالح`);
    for (const [name, qty] of Object.entries(stocks)) { if (!warehouseNames.has(name)) fail(`مخزن المنتج ${p.id} غير موجود`); numeric(qty, `كمية المنتج ${p.id} غير صالحة`); }
    if (p.qty !== undefined && !near(numeric(p.qty, `كمية المنتج ${p.id} غير صالحة`), stocks[state.warehouse] ?? 0)) fail(`الرصيد المختصر للمنتج ${p.id} لا يطابق المخزن المحدد`);
    // In approved-runtime the optional p.sku field is the scanned barcode.
    // Desktop sku is a different required unique internal product code.
    const barcode = p.sku || '';
    if (barcode && barcodes.has(barcode)) fail('باركود مكرر'); if (barcode) barcodes.add(barcode);
    openingStocks.set(p.id, openingMap(sourceOpeningStocks[String(p.id)] ?? {}, warehouseNames, `مخزون البداية للمنتج ${p.id}`, false));
    unsupported(p, `المنتج ${p.id}`);
  }
  for (const p of parties.values()) { text(p.name, 'اسم طرف غير صالح'); if (!['customer', 'supplier'].includes(p.type)) fail('نوع طرف غير صالح'); numeric(p.balance, `رصيد الطرف ${p.id} غير صالح`, true); }
  for (const a of accounts.values()) { text(a.name, 'اسم حساب غير صالح'); numeric(a.balance, `رصيد الحساب ${a.id} غير صالح`); if (a.openingBalance !== undefined) numeric(a.openingBalance, 'رصيد بداية الحساب غير صالح'); }
  const currency = state.currency ?? { code: 'MRU', availableCodes: ['MRU'] };
  if (typeof currency.code !== 'string' || !/^[A-Z]{3}$/.test(currency.code) || (currency.availableCodes !== undefined && (!Array.isArray(currency.availableCodes) || currency.availableCodes.some((code: unknown) => typeof code !== 'string' || !/^[A-Z]{3}$/.test(code))))) fail('عملة غير صالحة');

  const validateRecord = (r: Row, historical = false) => {
    positiveId(r.id, 'معرف سند غير صالح'); if (!KINDS.has(r.kind)) fail(`نوع سند غير مدعوم: ${String(r.kind)}`);
    // Previous versions may refer to an old warehouse name or deleted item.
    // They are archived evidence, never an additional posting or native proof.
    if (historical) {
      day(r.date, `تاريخ مراجعة السند ${r.id} غير صالح`); numeric(r.total, `إجمالي مراجعة السند ${r.id} غير صالح`);
      for (const l of array(r.lines, `بنود مراجعة السند ${r.id} غير صالحة`)) { positiveId(l.product, 'معرف منتج المراجعة غير صالح'); numeric(l.qty, 'كمية المراجعة غير صالحة'); numeric(l.price, 'سعر المراجعة غير صالح'); }
      return;
    }
    unsupported(r, `السند ${r.id}`); day(r.date, `تاريخ السند ${r.id} غير صالح`);
    for (const key of ['title', 'subtitle', 'note']) if (r[key] != null) text(r[key], `نص ${key} للسند ${r.id} غير صالح`, true);
    if (typeof r.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.time)) fail(`وقت السند ${r.id} غير صالح`);
    numeric(r.total, `إجمالي السند ${r.id} غير صالح`); numeric(r.paid ?? 0, `مدفوع السند ${r.id} غير صالح`); numeric(r.due ?? 0, `متبقي السند ${r.id} غير صالح`);
    if (r.voided !== undefined && typeof r.voided !== 'boolean') fail(`حالة السند ${r.id} غير صالحة`);
    if (r.status !== undefined && r.status !== 'posted' && !(r.status === 'voided' && r.voided === true)) fail(`حالة إضافية غير مدعومة للسند ${r.id}`);
    if (r.reversed || r.isReversal) fail(`سند عكس أجنبي غير مدعوم: ${r.id}`);
    if (r.revision !== undefined && (!Number.isSafeInteger(r.revision) || r.revision < 0)) fail(`إصدار السند ${r.id} غير صالح`);
    for (const key of ['createdAt', 'updatedAt', 'voidedAt']) if (r[key] !== undefined) timestamp(r[key], `وقت ${key} غير صالح للسند ${r.id}`);
    for (const key of ['party', 'otherParty']) if (r[key] != null && r[key] !== 0 && !parties.has(r[key])) fail(`طرف السند ${r.id} غير موجود`);
    for (const key of ['account', 'to']) if (r[key] != null && r[key] !== 0 && !accounts.has(r[key])) fail(`حساب السند ${r.id} غير موجود`);
    for (const key of ['warehouse', 'from', 'toWarehouse']) if (r[key] != null && !warehouseNames.has(r[key])) fail(`مخزن السند ${r.id} غير موجود`);
    array(r.lines, `بنود السند ${r.id} غير صالحة`);
    const used = new Set<string>();
    for (const l of r.lines) {
      record(l, `بند السند ${r.id} غير صالح`);
      const lineKey = r.kind === 'adjustment' && r.openingCorrection === true ? `${l.product}:${l.warehouse ?? r.warehouse}` : String(l.product);
      if (!products.has(l.product) || used.has(lineKey)) fail(`منتج مكرر أو مفقود في السند ${r.id}`); used.add(lineKey);
      if (l.name != null) text(l.name, `اسم بند السند ${r.id} غير صالح`, true);
      numeric(l.qty, `كمية بند السند ${r.id} غير صالحة`); numeric(l.price, `سعر بند السند ${r.id} غير صالح`); unsupported(l, `بند السند ${r.id}`);
      if (l.warehouse !== undefined && !warehouseNames.has(l.warehouse)) fail(`مخزن بند السند ${r.id} غير موجود`);
      if (l.costAtSale !== undefined && l.costAtSale !== null) numeric(l.costAtSale, `تكلفة بند السند ${r.id} غير صالحة`);
      if (r.kind === 'adjustment') numeric(l.delta, `فرق جرد السند ${r.id} غير صالح`, true);
      else if (l.qty <= 0) fail(`كمية بند السند ${r.id} يجب أن تكون موجبة`);
    }
    const paid = r.paid ?? 0, due = r.due ?? 0;
    if (commercial(r.kind)) {
      if (!r.lines.length || !r.warehouse || r.total <= 0 || !near(r.total, r.lines.reduce((sum: number, l: Row) => sum + money(l.qty * l.price), 0)) || !near(paid + due, r.total) || !((paid === 0 && due === r.total) || (due === 0 && paid === r.total))) fail(`مجموع أو تسوية فاتورة ${r.id} غير متسق`);
      if (r.party && parties.get(r.party)!.type !== (r.kind === 'sale' ? 'customer' : 'supplier')) fail(`نوع طرف الفاتورة ${r.id} غير مطابق`);
      if (due > 0 && !r.party || paid > 0 && !r.account) fail(`حساب أو طرف الفاتورة ${r.id} مفقود`);
      if (r.profit !== undefined && r.profit !== null) {
        numeric(r.profit, `ربح السند ${r.id} غير صالح`, true);
        if (r.kind === 'sale' && !r.voided && r.lines.every((l: Row) => l.costAtSale !== undefined && l.costAtSale !== null) && !sameMoney(r.profit, r.lines.reduce((sum: number, l: Row) => sum + (l.price - l.costAtSale) * l.qty, 0))) fail(`لقطة الربح وتكاليف البيع غير متسقة في السند ${r.id}`);
      }
      if (r.kind === 'sale' && !r.voided) {
        const missing = r.lines.filter((l: Row) => l.costAtSale === undefined || l.costAtSale === null);
        if (missing.length) {
          if (missing.length !== 1 || r.profit === undefined || r.profit === null) fail(`تكلفة البيع التاريخية غير قابلة للإثبات لكل منتج في السند ${r.id}`);
          const knownCost = r.lines.reduce((sum: number, l: Row) => sum + (l.costAtSale == null ? 0 : l.qty * l.costAtSale), 0);
          const remainingCost = r.total - r.profit - knownCost, l = missing[0];
          if (remainingCost < 0) fail(`لقطة الربح لا تثبت تكلفة موجبة في السند ${r.id}`);
          l.costAtSale = numeric(remainingCost / l.qty, `تكلفة مشتقة غير صالحة في السند ${r.id}`);
          l.mobileDerivedCost = { method: 'only-unpriced-line-from-saved-total-profit', total: r.total, profit: r.profit, knownLineCost: knownCost };
        }
        if (r.profit != null && !near(r.total - r.lines.reduce((sum: number, l: Row) => sum + l.qty * l.costAtSale, 0), r.profit)) fail(`تقريب الربح التاريخي لا يطابق حسابات Desktop في السند ${r.id}`);
      }
    } else if (['expense', 'receive', 'pay', 'deposit', 'withdraw', 'transfer'].includes(r.kind)) {
      if (r.total <= 0 || !r.account || !near(paid, r.total) || due !== 0 || r.lines.length) fail(`تسوية الحركة ${r.id} غير متسقة`);
      if (['receive', 'pay'].includes(r.kind) && !r.party) fail(`طرف حركة ${r.id} مفقود`);
      if (r.kind === 'transfer' && (!r.to || r.account === r.to)) fail(`وجهة التحويل ${r.id} غير صالحة`);
    } else {
      if (paid !== 0 || due !== 0) fail(`الحركة ${r.id} غير نقدية لكن لها مبلغ نقدي`);
      if (r.kind === 'stocktransfer' && (!r.lines.length || !r.from || !r.toWarehouse || r.from === r.toWarehouse)) fail(`تحويل المخزون ${r.id} غير صالح`);
      if (r.kind === 'adjustment' && (!r.lines.length || r.lines.some((l: Row) => !l.warehouse && !r.warehouse))) fail(`مخزن الجرد ${r.id} مفقود`);
      if (r.kind === 'offset' && (!r.party || !r.otherParty || parties.get(r.party)!.type !== 'customer' || parties.get(r.otherParty)!.type !== 'supplier' || r.total <= 0 || r.lines.length)) fail(`طرفا التقاص ${r.id} غير صالحين`);
    }
    if (r.revisions !== undefined) for (const previous of array(r.revisions, `مراجعات السند ${r.id} غير صالحة`)) { if (previous.id !== r.id) fail(`هوية مراجعات السند ${r.id} غير متسقة`); validateRecord(previous, true); }
  };
  for (const r of records.values()) validateRecord(r);
  if (state.stockEvents !== undefined) for (const event of array(state.stockEvents, 'سجل مخزون المصدر غير صالح')) {
    if (!products.has(Number(event.productId)) || String(Number(event.productId)) !== event.productId || !warehouseNames.has(event.warehouseId)) fail('مرجع حدث مخزون المصدر غير صالح');
    numeric(event.quantityDelta, 'فرق حدث مخزون المصدر غير صالح', true);
    if (!records.has(Number(event.documentId)) && event.documentId !== `legacy-${event.productId}`) fail('حدث مخزون يشير إلى سند مفقود');
    if (typeof event.type !== 'string' || !/^(?:legacy-opening|sale|purchase|adjustment|opening|opening-correction|transfer-in|transfer-out|transfer-edit|transfer-void)(?:-edit|-void)?$/.test(event.type)) fail('نوع حدث مخزون غير مدعوم');
  }

  const cash = new Map([...accounts.keys()].map(key => [key, openingAccounts.get(String(key)) ?? 0]));
  const debt = new Map([...parties.keys()].map(key => [key, openingParties.get(String(key)) ?? 0]));
  const stocks = new Map([...products.keys()].map(key => [key, new Map(warehouses.map(name => [name, openingStocks.get(key)!.get(name) ?? 0]))]));
  const ordered = [...records.values()].sort((a, b) => a.id - b.id);
  const addCash = (key: number, amount: number) => cash.set(key, cash.get(key)! + amount);
  const addParty = (key: number, amount: number) => debt.set(key, debt.get(key)! + amount);
  const addStock = (key: number, name: string, amount: number) => stocks.get(key)!.set(name, stocks.get(key)!.get(name)! + amount);
  for (const r of ordered.filter(row => !row.voided)) {
    if (commercial(r.kind)) { if (r.paid) addCash(r.account, (r.kind === 'sale' ? 1 : -1) * r.paid); if (r.party) addParty(r.party, r.due ?? 0); for (const l of r.lines) addStock(l.product, r.warehouse, (r.kind === 'sale' ? -1 : 1) * l.qty); }
    else if (r.kind === 'receive' || r.kind === 'pay') { addCash(r.account, (r.kind === 'receive' ? 1 : -1) * r.total); const p = parties.get(r.party)!; addParty(r.party, (p.type === 'customer' ? r.kind === 'receive' ? -1 : 1 : r.kind === 'pay' ? -1 : 1) * r.total); }
    else if (['expense', 'deposit', 'withdraw', 'transfer'].includes(r.kind)) { addCash(r.account, (r.kind === 'deposit' ? 1 : -1) * r.total); if (r.kind === 'transfer') addCash(r.to, r.total); }
    else if (r.kind === 'offset') { addParty(r.party, -r.total); addParty(r.otherParty, -r.total); }
    else if (r.kind === 'adjustment') for (const l of r.lines) addStock(l.product, l.warehouse ?? r.warehouse, l.delta);
    else if (r.kind === 'stocktransfer') for (const l of r.lines) { addStock(l.product, r.from, -l.qty); addStock(l.product, r.toWarehouse, l.qty); }
  }
  for (const a of accounts.values()) if (!near(cash.get(a.id)!, a.balance)) fail(`رصيد الحساب ${a.id} لا يطابق البداية والحركات الفعالة دون فرق تقريب غير موثق`);
  for (const p of parties.values()) if (!near(debt.get(p.id)!, p.balance)) fail(`رصيد الطرف ${p.id} لا يطابق البداية والحركات الفعالة دون فرق تقريب غير موثق`);
  for (const p of products.values()) for (const name of warehouses) if (!near(stocks.get(p.id)!.get(name)!, p.stocks[name] ?? 0)) fail(`مخزون المنتج ${p.id} في المخزن ${name} لا يطابق البداية والحركات الفعالة`);

  const collections = Object.fromEntries(COLLECTIONS.map(name => [name, []])) as unknown as ContaBackup['collections'];
  const source = (kind: string, key: string | number) => ({ format: raw.format, schemaVersion: 1, entity: kind, id: key, originId: state.originId ?? null });
  const earliest = ordered.length ? ordered.reduce((date, r) => r.date < date ? r.date : date, ordered[0].date) : day(createdAt.slice(0, 10), 'تاريخ البداية غير صالح');
  const baselineAt = `${earliest}T00:00:00.000Z`;
  const base = (documentId: string, kind: string, number: string, occurredAt: string) => ({ id: documentId, kind, number, status: 'posted', revision: 0, occurredAt, businessDate: occurredAt.slice(0, 10), partyId: null, partyName: null, warehouseId: null, warehouseName: null, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: null, total: 0, paidTotal: 0, dueTotal: 0, cashAmount: 0, lines: [], importedFrom: 'mobile-v23' } as Row);
  for (const name of warehouses) collections.warehouses.push({ _id: warehouseId(name), id: warehouseId(name), name, isSalesDefault: name === salesWarehouse, isArchived: meta[name]?.archived === true, mobileSource: source('warehouses', name) });
  for (const category of categories.values()) collections.productCategories.push({ id: id('category', category.id), name: category.name, mobileSource: source('categories', category.id) });
  const expenseCategoryIds = new Map<string, string>();
  for (const category of originalExpenseCategories) {
    if (expenseCategoryIds.has(category.id)) fail('معرف فئة مصروف Desktop سابق مكرر');
    const categoryId = id('expense-category', digest(category.id).slice(0, 20)); expenseCategoryIds.set(category.id, categoryId);
    collections.expenseCategories.push({ ...jsonClone(category), id: categoryId, _id: categoryId, mobileSource: source('desktopExpenseCategories', category.id) });
  }
  for (const p of products.values()) {
    collections.products.push({ id: id('product', p.id), sku: `M23-${p.id}`, name: p.name, barcode: p.sku || null, note: p.note ?? null, piecePrice: p.price, wholesalePrice: p.wholesale ?? p.price, pieceCost: p.cost, categoryId: p.categoryId ? id('category', p.categoryId) : null, stocks: Object.fromEntries(warehouses.map(name => [warehouseId(name), p.stocks[name] ?? 0])), isArchived: p.archived === true, ...(p.expiry ? { expiryDate: p.expiry } : {}), ...(p.openingCost != null || p.legacyOpeningCost != null ? { legacyOpeningCost: p.openingCost ?? p.legacyOpeningCost } : {}), mobileImportedCurrentCost: p.cost, mobileSource: { ...source('products', p.id), originalSku: p.sku ?? '', originalCost: p.cost } });
  }
  for (const p of parties.values()) { const net = p.balance * (p.type === 'supplier' ? -1 : 1); collections.parties.push({ id: id('party', p.id), name: p.name, phone: p.phone ?? '', partyType: p.type, receivable: Math.max(net, 0), payable: Math.max(-net, 0), isArchived: p.archived === true, mobileSource: source('parties', p.id) }); }
  const accountBases = new Map([...accounts.keys()].map(key => [key, openingAccounts.get(String(key)) ?? 0]));
  for (const r of ordered.filter(row => !row.voided && row.openingAccountCorrection)) {
    if (!['deposit', 'withdraw'].includes(r.kind)) fail(`تصحيح بداية الحساب ${r.id} ليس سحبًا أو إيداعًا`);
    const before = numeric(r.openingBalanceBefore, `قبل تصحيح الحساب ${r.id} غير صالح`), after = numeric(r.openingBalanceAfter, `بعد تصحيح الحساب ${r.id} غير صالح`);
    if (!near(before, accountBases.get(r.account)!) || !near(after - before, (r.kind === 'deposit' ? 1 : -1) * r.total)) fail(`تسلسل تصحيح بداية الحساب ${r.id} غير متسق`);
    accountBases.set(r.account, after);
  }
  for (const a of accounts.values()) {
    const currentBasis = a.openingBalance ?? accountBases.get(a.id)!;
    if (!near(currentBasis, accountBases.get(a.id)!)) fail(`رصيد بداية الحساب ${a.id} الحالي لا يطابق تصحيحاته الفعالة`);
    collections.paymentAccounts.push({ id: id('account', a.id), code: id('account', a.id), name: a.name, balance: a.balance, openingBalance: currentBasis, isActive: a.active !== false && a.archived !== true, isArchived: a.archived === true, allowNegativeBalance: true, mobileSource: { ...source('accounts', a.id), baselineOpeningBalance: openingAccounts.get(String(a.id)) ?? 0 } });
  }
  const financial = (doc: Row, account: number, direction: 'in' | 'out', amount: number, type: string, suffix = '') => { if (amount) collections.financialMovements.push({ id: `${doc.id}:financial${suffix}`, documentId: doc.id, documentNumber: doc.number, paymentMethod: id('account', account), paymentCode: id('account', account), direction, amount, type, occurredAt: doc.occurredAt, partyId: doc.partyId, partyName: doc.partyName, transferId: doc.transferId ?? null, note: doc.note ?? null, status: 'posted', revision: doc.revision, importedFrom: 'mobile-v23', mobileCurrentEffect: true }); };
  for (const a of accounts.values()) { const amount = openingAccounts.get(String(a.id)) ?? 0; if (amount) { const doc = { ...base(id('opening-account', a.id), 'opening-balance', `M23-ACCOUNT-BASE-${a.id}`, baselineAt), note: 'رصيد مصدر افتتاحي سابق للحركات المستوردة', mobileBaseline: true }; financial(doc, a.id, amount > 0 ? 'in' : 'out', Math.abs(amount), 'opening-balance'); } }
  for (const p of parties.values()) {
    const net = (openingParties.get(String(p.id)) ?? 0) * (p.type === 'supplier' ? -1 : 1); if (!net) continue;
    const doc = { ...base(id('opening-party', p.id), 'party-opening', `M23-PARTY-BASE-${p.id}`, baselineAt), partyId: id('party', p.id), partyName: p.name, total: Math.abs(net), note: 'رصيد المصدر قبل الحركات المستوردة', partyOpeningVersion: 1, partyOpeningDirection: net > 0 ? 'receivable' : 'payable', partyOpeningAmount: Math.abs(net), partyOpeningContribution: net, partyBalanceDelta: net, partyOpeningBalanceBefore: 0, partyOpeningAppliedDelta: net, partyOpeningBalanceAfter: net, legacyKey: id('opening-party', p.id), mobileBaseline: true };
    collections.documents.push(doc);
  }
  for (const p of products.values()) for (const [name, qty] of openingStocks.get(p.id)!) {
    if (!qty) continue;
    const docId = `${id('opening-stock', p.id)}:${digest(name).slice(0, 20)}`, number = `M23-STOCK-BASE-${p.id}-${digest(name).slice(0, 8)}`;
    collections.documents.push({ ...base(docId, 'adjustment', number, baselineAt), warehouseId: warehouseId(name), warehouseName: name, title: 'رصيد مخزون المصدر قبل الحركات المستوردة', legacyKey: docId, mobileBaseline: true, lines: [{ id: `${docId}:line`, productId: id('product', p.id), description: p.name, quantity: qty, unitPrice: p.openingCost ?? p.legacyOpeningCost ?? 0, lineTotal: 0 }] });
    collections.stockMovements.push({ id: `${docId}:stock`, productId: id('product', p.id), productName: p.name, warehouseId: warehouseId(name), warehouseName: name, documentId: docId, documentNumber: number, quantityDelta: qty, type: 'legacy-opening', occurredAt: baselineAt, importedFrom: 'mobile-v23', mobileBaseline: true });
  }
  const sequenceUsed = new Map<string, Set<number>>(), sourceNumbers = new Map<string, number>();
  for (const r of ordered) { const rawNumber = String(r.number ?? `${r.kind.toUpperCase()}-${r.id}`); sourceNumbers.set(rawNumber, (sourceNumbers.get(rawNumber) ?? 0) + 1); }
  let openingCorrectionSequence = 0;
  for (const r of ordered) {
    const kinds: Record<string, string> = { receive: 'payment', pay: 'payment', deposit: 'account-adjustment', withdraw: 'account-adjustment', transfer: 'account-transfer', stocktransfer: 'transfer', offset: 'settlement' };
    const kind = kinds[r.kind] ?? r.kind, docId = id('record', r.id), rawNumber = String(r.number ?? `${r.kind.toUpperCase()}-${r.id}`), reference = sourceNumbers.get(rawNumber) === 1 ? rawNumber : `M23-${r.kind.toUpperCase()}-${r.id}`;
    const doc = { ...base(docId, kind, reference, `${r.date}T${r.time}:00.000Z`), status: r.voided ? 'voided' : 'posted', revision: r.revision ?? 0, mobileSource: { ...source('records', r.id), number: r.number ?? null, revision: r.revision ?? 0, historicalProfit: r.profit ?? null }, mobileAccountingTimeWithoutZone: true, title: r.title ?? null, note: r.note ?? null,
      total: r.total, paidTotal: r.paid ?? 0, cashAmount: r.paid ?? 0, dueTotal: r.due ?? 0, paymentMethod: r.account ? id('account', r.account) : commercial(r.kind) && r.due ? 'note' : null,
      partyId: r.party ? id('party', r.party) : null, partyName: r.party ? parties.get(r.party)!.name : null, ...(r.createdAt ? { createdAt: r.createdAt } : {}), ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}), ...(r.voidedAt ? { voidedAt: r.voidedAt } : {}) } as Row;
    if (['sale', 'purchase', 'expense'].includes(r.kind)) { const used = sequenceUsed.get(r.kind) ?? new Set<number>(); let sequence = r.sequence; if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence <= 0 || used.has(sequence))) fail(`رقم تسلسلي مكرر أو غير صالح: ${r.id}`); if (sequence === undefined) { sequence = 1; while (used.has(sequence)) sequence++; } used.add(sequence); sequenceUsed.set(r.kind, used); doc.sequence = sequence; }
    if (r.warehouse) { doc.warehouseId = warehouseId(r.warehouse); doc.warehouseName = r.warehouse; }
    if (r.kind === 'stocktransfer') { doc.warehouseId = warehouseId(r.from); doc.warehouseName = r.from; doc.destinationWarehouseId = warehouseId(r.toWarehouse); doc.destinationWarehouseName = r.toWarehouse; }
    doc.lines = r.lines.map((l: Row, index: number) => ({ id: `${docId}:line:${index + 1}`, productId: id('product', l.product), description: l.name ?? products.get(l.product)!.name, quantity: r.kind === 'adjustment' ? l.delta : l.qty, unitPrice: l.price, lineTotal: commercial(r.kind) ? money(l.qty * l.price) : 0, ...(r.kind === 'sale' ? { costAtSale: l.costAtSale ?? null, grossProfit: l.costAtSale == null ? null : money(l.qty * l.price) - l.qty * l.costAtSale, ...(l.mobileDerivedCost ? { mobileDerivedCost: l.mobileDerivedCost } : {}) } : {}), ...(l.warehouse ? { warehouseId: warehouseId(l.warehouse) } : {}) }));
    if (commercial(r.kind)) {
      for (const line of doc.lines) {
        try { resolveInvoiceLineTotal(line.quantity, line.unitPrice, line.lineTotal, true); line.lineTotalMode = 'exact'; }
        catch { doc.legacyKey = docId; doc.mobileReadOnlyReason = 'Historical cent-rounded line total differs from quantity × original unit price; original unit price and total retained'; }
      }
    }
    if (commercial(r.kind)) doc.partyBalanceDelta = (r.kind === 'sale' ? 1 : -1) * (r.due ?? 0);
    if (r.kind === 'receive' || r.kind === 'pay') { doc.partyCashDirection = r.kind === 'receive' ? 'receive' : 'pay'; doc.partyBalanceDelta = (r.kind === 'receive' ? -1 : 1) * r.total; }
    if (r.kind === 'deposit' || r.kind === 'withdraw') doc.accountAdjustmentDirection = r.kind === 'deposit' ? 'deposit' : 'withdrawal';
    if (r.kind === 'expense' && r.desktop?.expenseCategoryId) {
      const categoryId = expenseCategoryIds.get(String(r.desktop.expenseCategoryId));
      if (!categoryId) fail(`فئة المصروف التاريخي ${r.id} غير موجودة`);
      doc.expenseCategoryId = categoryId; doc.expenseCategoryName = originalExpenseCategories.find(row => row.id === r.desktop.expenseCategoryId)!.name;
    }
    if (r.kind === 'transfer') { doc.transferId = docId; doc.fromAccountId = id('account', r.account); doc.toAccountId = id('account', r.to); collections.accountTransfers.push({ id: docId, documentId: docId, number: reference, fromAccountId: doc.fromAccountId, toAccountId: doc.toAccountId, amount: r.total, note: doc.note, occurredAt: doc.occurredAt, status: doc.status, revision: doc.revision, importedFrom: 'mobile-v23' }); }
    if (r.kind === 'adjustment' && (r.openingStock || r.openingCorrection)) { doc.legacyKey = docId; doc.mobileOpening = jsonClone(r); if (r.openingCorrection === true) doc.openingCorrection = true; }
    if (r.openingAccountCorrection) { doc.legacyKey = docId; doc.mobileOpeningAccountCorrection = { before: r.openingBalanceBefore, after: r.openingBalanceAfter }; }
    if (r.kind === 'offset') {
      doc.legacyKey = docId; doc.partyBalanceDelta = -r.total; doc.paidTotal = 0; doc.cashAmount = 0; doc.dueTotal = 0;
      const peerId = `${docId}:counterparty`; doc.mobileOffsetPeerId = peerId;
      collections.documents.push({ ...doc, id: peerId, number: `${reference}-SUP`, partyId: id('party', r.otherParty), partyName: parties.get(r.otherParty)!.name, partyBalanceDelta: r.total, legacyKey: peerId, mobileOffsetPeerId: docId, mobileSource: { ...doc.mobileSource, side: 'supplier' } });
    }
    collections.documents.push(doc);
    if (r.voided) continue;
    if (commercial(r.kind) && r.paid) financial(doc, r.account, r.kind === 'sale' ? 'in' : 'out', r.paid, r.kind);
    else if (['expense', 'receive', 'pay', 'deposit', 'withdraw', 'transfer'].includes(r.kind)) {
      const type = r.openingAccountCorrection ? 'opening-balance-correction' : ({ receive: 'party-receipt', pay: 'party-payment', deposit: 'manual-deposit', withdraw: 'manual-withdrawal', transfer: 'transfer-out' } as Record<string, string>)[r.kind] ?? r.kind;
      financial(doc, r.account, r.kind === 'receive' || r.kind === 'deposit' ? 'in' : 'out', r.total, type);
      if (r.openingAccountCorrection) Object.assign(collections.financialMovements.at(-1)!, { openingBalanceBefore: r.openingBalanceBefore, openingBalanceAfter: r.openingBalanceAfter, delta: (r.kind === 'deposit' ? 1 : -1) * r.total, openingCorrectionSequence: ++openingCorrectionSequence, reason: r.note ?? 'تصحيح افتتاحي محفوظ في المصدر' });
      if (r.kind === 'transfer') financial(doc, r.to, 'in', r.total, 'transfer-in', ':in');
    }
    for (const [index, l] of r.lines.entries()) {
      const push = (name: string, quantityDelta: number, type: string, suffix = '') => { if (quantityDelta) collections.stockMovements.push({ id: `${docId}:stock:${index + 1}${suffix}`, productId: id('product', l.product), productName: products.get(l.product)!.name, warehouseId: warehouseId(name), warehouseName: name, documentId: docId, documentNumber: reference, quantityDelta, type, occurredAt: doc.occurredAt, revision: doc.revision, importedFrom: 'mobile-v23', mobileCurrentEffect: true }); };
      if (commercial(r.kind)) push(r.warehouse, (r.kind === 'sale' ? -1 : 1) * l.qty, r.kind === 'sale' && doc.revision > 0 ? 'sale-edit' : r.kind);
      else if (r.kind === 'adjustment') push(l.warehouse ?? r.warehouse, l.delta, r.openingStock || r.openingCorrection ? 'legacy-opening' : 'adjustment');
      else if (r.kind === 'stocktransfer') { push(r.from, -l.qty, 'transfer-out'); push(r.toWarehouse, l.qty, 'transfer-in', ':in'); }
    }
  }
  const documentsByProduct = new Map<string, Row[]>();
  for (const document of collections.documents) for (const productId of new Set<string>((document.lines ?? []).map((line: Row) => String(line.productId)))) {
    const related = documentsByProduct.get(productId) ?? []; related.push(document); documentsByProduct.set(productId, related);
  }
  for (const product of collections.products) product.mobileImportedCostBasis = mobileCostBasisSignature(product.id, documentsByProduct.get(String(product.id)) ?? []);
  for (const kind of ['sale', 'purchase', 'expense']) { const highwater = state.sequences?.[kind] ?? 0; if (!Number.isSafeInteger(highwater) || highwater < 0) fail('عداد المصدر غير صالح'); collections.counters.push({ _id: `documentSequence:${kind}`, value: Math.max(highwater, ...[...(sequenceUsed.get(kind) ?? [])], 0) }); }
  const sourceHash = digest(JSON.stringify(raw));
  collections.appSettings.push({ _id: `mobile-backup:archive:${sourceHash}`, sourceFormat: 'alkarna-web-backup', schemaVersion: 1, sourceSha256: sourceHash, originalBackup: jsonClone(raw), inertSourceArchive: true });
  collections.appSettings.push({ _id: 'currency-settings', ...jsonClone(currency), schemaVersion: 1 });
  const brand = state.brandInfo == null ? {} : record(state.brandInfo, 'بيانات المحل غير صالحة');
  const brandText = (value: unknown, maximum: number, label: string, fallback = '') => { const result = value === undefined ? fallback : text(value, label, true).trim(); if (result.length > maximum) fail(label); return result; };
  const logo = brandText(brand.logo, 500000, 'شعار المحل لا يلائم الصيغة المدعومة');
  if (logo && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(logo)) fail('شعار المحل غير صالح');
  const font = brand.nameFont ?? 'tahoma', fontSize = brand.nameFontSize ?? 24, fontWeight = brand.nameFontWeight ?? 800;
  if (!['tahoma', 'arial', 'segoe-ui', 'times-new-roman'].includes(font) || !Number.isFinite(fontSize) || fontSize < 16 || fontSize > 32 || ![400, 600, 800].includes(fontWeight)) fail('خط اسم المحل غير صالح');
  collections.appSettings.push({ _id: 'invoice-branding', schemaVersion: 1, storeName: brandText(state.branding, 80, 'اسم المحل غير صالح', 'الكرنه') || 'الكرنه', storePhone: brandText(brand.phone, 80, 'هاتف المحل طويل'), storeAddress: brandText(brand.address, 160, 'عنوان المحل طويل'), footerNote: brandText(brand.footer, 160, 'تذييل الفاتورة طويل'), registrationNumber: brandText(brand.registrationNumber, 60, 'رقم التسجيل طويل'), taxNumber: brandText(brand.taxNumber, 60, 'الرقم الضريبي طويل'), storeLogoDataUrl: logo, nameFont: font, nameFontSize: fontSize, nameFontWeight: fontWeight });
  collections.auditEvents.push({ id: `mobile-import:${sourceHash}`, action: 'mobile-backup.convert', status: 'committed', sourceFormat: raw.format, sourceSchemaVersion: 1, sourceSha256: sourceHash, createdAt, baselineTiming: 'start-of-earliest-imported-accounting-day; not an original event timestamp', sourceRecordIds: ordered.map(r => r.id), usersActivated: 0 });
  // Root restore integration preserves the existing Desktop users/device prefs.
  return { format: 'conta-backup', schemaVersion: 1, createdAt, appVersion: 'mobile-schema-1', encoding: 'json-v2', collections, counts: Object.fromEntries(COLLECTIONS.map(name => [name, collections[name].length])) as ContaBackup['counts'], mobileImport: { sourceFormat: 'alkarna-web-backup', schemaVersion: 1 } };
}
