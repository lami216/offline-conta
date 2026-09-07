from pathlib import Path
import json
import re

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, got {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))

def regex_once(path, pattern, replacement, flags=0):
    text = read(path)
    out, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: regex expected one match, got {count}: {pattern[:120]!r}')
    write(path, out)

# ---------- domain ----------
replace_once('app/domain.ts',
'''export interface Product {\n''',
'''export interface ProductCategory {\n  id: string;\n  name: string;\n}\nexport interface Product {\n''')
replace_once('app/domain.ts',
'''  note?: string | null;\n  stocks: Record<string, number>;''',
'''  note?: string | null;\n  categoryId?: string | null;\n  stocks: Record<string, number>;''')
replace_once('app/domain.ts',
'''  products: Product[];\n  documents: DocumentRecord[];''',
'''  products: Product[];\n  categories: ProductCategory[];\n  documents: DocumentRecord[];''')

# ---------- bootstrap ----------
replace_once('app/api/bootstrap/route.ts',
'''const [parties, warehouses, products, documents, movements,''',
'''const [parties, warehouses, products, categories, documents, movements,''')
replace_once('app/api/bootstrap/route.ts',
'''db.collection("products").find().sort({ name: 1 }).toArray(), db.collection("documents").find().sort({ occurredAt: -1 }).limit(500).toArray(),''',
'''db.collection("products").find().sort({ name: 1 }).toArray(), db.collection("productCategories").find().sort({ name: 1 }).toArray(), db.collection("documents").find().sort({ occurredAt: -1 }).limit(500).toArray(),''')
replace_once('app/api/bootstrap/route.ts',
'''const cleanProducts = clean(products).map(product => ({ ...product, wholesalePrice: (product as Record<string, unknown>).wholesalePrice ?? null, expiryDate: (product as Record<string, unknown>).expiryDate ?? null, note: (product as Record<string, unknown>).note ?? null }));''',
'''const cleanProducts = clean(products).map(product => ({ ...product, wholesalePrice: (product as Record<string, unknown>).wholesalePrice ?? null, expiryDate: (product as Record<string, unknown>).expiryDate ?? null, note: (product as Record<string, unknown>).note ?? null, categoryId: (product as Record<string, unknown>).categoryId ?? null }));\n    const cleanCategories = clean(categories).map(category => ({ id: String(category.id), name: String(category.name ?? "") })).filter(category => category.name);''')
replace_once('app/api/bootstrap/route.ts',
'''map(({id,name,sku,barcode,piecePrice,wholesalePrice,expiryDate,stocks,isArchived})=>({id,name,sku,barcode,piecePrice,wholesalePrice,expiryDate,stocks,isArchived,pieceCost:null,lastPurchaseCost:null}))''',
'''map(({id,name,sku,barcode,piecePrice,wholesalePrice,expiryDate,categoryId,stocks,isArchived})=>({id,name,sku,barcode,piecePrice,wholesalePrice,expiryDate,categoryId,stocks,isArchived,pieceCost:null,lastPurchaseCost:null}))''')
replace_once('app/api/bootstrap/route.ts',
'''warehouses:clean(warehouses), products:exposedProducts, documents:allowedDocuments,''',
'''warehouses:clean(warehouses), products:exposedProducts, categories:cleanCategories, documents:allowedDocuments,''')

# ---------- command API ----------
replace_once('app/api/command/route.ts',
'''  if (type === "product.create" || type === "product.update") {''',
'''  if (type === "product-category.create") {\n    const name = text(body.name);\n    if (!name) throw new CommandError("اسم الفئة مطلوب");\n    if (name.length > 80) throw new CommandError("اسم الفئة طويل جدًا");\n    const duplicate = await db.collection("productCategories").findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`, $options: "i" } }, { session });\n    if (duplicate) throw new CommandError("هذه الفئة موجودة بالفعل", 409);\n    const category = { id: id("category"), name, createdAt: new Date() };\n    await db.collection("productCategories").insertOne(category, { session });\n    return category.id;\n  }\n  if (type === "product.create" || type === "product.update") {''')
replace_once('app/api/command/route.ts',
'''    const productId = text(body.id);\n    if (barcode && await db.collection("products").findOne''',
'''    const productId = text(body.id), categoryId = text(body.categoryId);\n    if (categoryId && !await db.collection("productCategories").findOne({ id: categoryId }, { session })) throw new CommandError("الفئة غير موجودة", 404);\n    if (barcode && await db.collection("products").findOne''')
replace_once('app/api/command/route.ts',
'''const pieceCost = optionalNumber(body.pieceCost, "سعر الشراء"), values = { name, barcode, expiryDate: optionalDate(body.expiryDate), note: note || null, pieceCost, piecePrice: optionalNumber(body.piecePrice, "سعر البيع"), wholesalePrice: optionalNumber(body.wholesalePrice, "سعر الجملة") };''',
'''const pieceCost = optionalNumber(body.pieceCost, "سعر الشراء"), values = { name, barcode, expiryDate: optionalDate(body.expiryDate), note: note || null, categoryId: categoryId || null, pieceCost, piecePrice: optionalNumber(body.piecePrice, "سعر البيع"), wholesalePrice: optionalNumber(body.wholesalePrice, "سعر الجملة") };''')
replace_once('app/api/command/route.ts',
'''"product.restore":"products.edit","product.create":"products.create","product.update":"products.edit"''',
'''"product.restore":"products.edit","product-category.create":"products.create","product.create":"products.create","product.update":"products.edit"''')

# ---------- report filters/backend ----------
replace_once('app/report-types.ts',
'''partyId?: string; productId?: string; warehouseId?: string;''',
'''partyId?: string; productId?: string; categoryId?: string; warehouseId?: string;''')
replace_once('lib/reports.ts',
'''partyId: text(url.searchParams.get("partyId")) || undefined, productId: text(url.searchParams.get("productId")) || undefined, paymentAccountId:''',
'''partyId: text(url.searchParams.get("partyId")) || undefined, productId: text(url.searchParams.get("productId")) || undefined, categoryId: text(url.searchParams.get("categoryId")) || undefined, paymentAccountId:''')
replace_once('lib/reports.ts',
'''const pageCursor = (cursor: FindCursor<Document>, f: ReportFilters) => f.unpaged ? cursor : cursor.skip((f.page - 1) * f.pageSize).limit(f.pageSize);\nconst lineMatches = (line: Document, f: ReportFilters) => !f.productId || String(line.productId) === f.productId;''',
'''const pageCursor = (cursor: FindCursor<Document>, f: ReportFilters) => f.unpaged ? cursor : cursor.skip((f.page - 1) * f.pageSize).limit(f.pageSize);\ntype ProductScope = Set<string> | null;\nconst lineMatches = (line: Document, f: ReportFilters, categoryScope: ProductScope = null) => (!f.productId || String(line.productId) === f.productId) && (!categoryScope || categoryScope.has(String(line.productId)));\nconst productConstraint = (f: ReportFilters, categoryScope: ProductScope) => f.productId || (categoryScope ? { $in: [...categoryScope] } : undefined);''')
replace_once('lib/reports.ts',
'''async function saleFacts(db: Db, documents: Document[], f: ReportFilters) {''',
'''async function saleFacts(db: Db, documents: Document[], f: ReportFilters, categoryScope: ProductScope = null) {''')
replace_once('lib/reports.ts',
'''    if (!lineMatches(line, f)) continue;''',
'''    if (!lineMatches(line, f, categoryScope)) continue;''')
replace_once('lib/reports.ts',
'''async function directDocuments(db: Db, f: ReportFilters, kind: string) {\n  const query: Document = { kind, status: "posted", ...matchDate(f) };\n  if (f.paymentAccountId) query.paymentMethod = f.paymentAccountId;\n  if (f.productId) query["lines.productId"] = f.productId;''',
'''async function directDocuments(db: Db, f: ReportFilters, kind: string, categoryScope: ProductScope = null) {\n  const query: Document = { kind, status: "posted", ...matchDate(f) };\n  if (f.paymentAccountId) query.paymentMethod = f.paymentAccountId;\n  const constraint = productConstraint(f, categoryScope);\n  if (constraint) query["lines.productId"] = constraint;''')
replace_once('lib/reports.ts',
'''export async function buildReport(db: Db, f: ReportFilters): Promise<ReportResponse> {\n  const expiryLoss''',
'''export async function buildReport(db: Db, f: ReportFilters): Promise<ReportResponse> {\n  const categoryScope: ProductScope = f.categoryId ? new Set((await db.collection("products").find({ categoryId: f.categoryId }).project({ id: 1 }).toArray()).map(product => String(product.id))) : null;\n  const constraint = productConstraint(f, categoryScope), hasProductFilter = Boolean(f.productId || f.categoryId);\n  const expiryLoss''')
replace_once('lib/reports.ts',
'''const sales = await directDocuments(db, f, "sale");''',
'''const sales = await directDocuments(db, f, "sale", categoryScope);''')
replace_once('lib/reports.ts',
'''const returnQuery = { kind: "return", status: "posted", ...matchDate(f), ...(f.productId ? { "lines.productId": f.productId } : {}) };''',
'''const returnQuery = { kind: "return", status: "posted", ...matchDate(f), ...(constraint ? { "lines.productId": constraint } : {}) };''')
replace_once('lib/reports.ts',
'''const summaryFacts = await saleFacts(db, [...sales.all, ...legacySaleAdjustments], f), totals = profitSummary(summaryFacts)''',
'''const summaryFacts = await saleFacts(db, [...sales.all, ...legacySaleAdjustments], f, categoryScope), totals = profitSummary(summaryFacts)''')
replace_once('lib/reports.ts',
'''const rows = f.productId ? pageFacts : sales.rows.map''',
'''const rows = hasProductFilter ? pageFacts : sales.rows.map''')
replace_once('lib/reports.ts',
'''grossSales: sales.all.reduce((s, d) => s + (f.productId ? (d.lines as Document[]).filter(l => lineMatches(l, f)).reduce''',
'''grossSales: sales.all.reduce((s, d) => s + (hasProductFilter ? (d.lines as Document[]).filter(l => lineMatches(l, f, categoryScope)).reduce''')
replace_once('lib/reports.ts',
'''const kind = f.type === "purchases" ? "purchase" : "expense", found = await directDocuments(db, f, kind);''',
'''const kind = f.type === "purchases" ? "purchase" : "expense", found = await directDocuments(db, f, kind, categoryScope);''')
replace_once('lib/reports.ts',
'''const rows = found.rows.map(document => { const selected = ((document.lines ?? []) as Document[]).filter(line => lineMatches(line, f)); if (f.type === "purchases" && f.productId) {''',
'''const rows = found.rows.map(document => { const selected = ((document.lines ?? []) as Document[]).filter(line => lineMatches(line, f, categoryScope)); if (f.type === "purchases" && hasProductFilter) {''')
replace_once('lib/reports.ts',
'''const value = (d: Document) => f.productId ? (d.lines as Document[]).filter(l=>lineMatches(l,f)).reduce''',
'''const value = (d: Document) => hasProductFilter ? (d.lines as Document[]).filter(l=>lineMatches(l,f,categoryScope)).reduce''')
replace_once('lib/reports.ts',
'''(d.lines as Document[]).filter(l=>lineMatches(l,f)).reduce((x,l)=>x+n(l.quantity),0)''',
'''(d.lines as Document[]).filter(l=>lineMatches(l,f,categoryScope)).reduce((x,l)=>x+n(l.quantity),0)''')
replace_once('lib/reports.ts',
'''if (f.productId && f.type === "stock") query.productId=f.productId;''',
'''if (f.type === "stock" && constraint) query.productId=constraint;''')
replace_once('lib/reports.ts',
'''const documents=await db.collection("documents").find({kind:{$in:["sale","return"]},status:"posted",...matchDate(f),...(f.productId?{"lines.productId":f.productId}:{})}).toArray(),facts=await saleFacts(db,documents,f);''',
'''const documents=await db.collection("documents").find({kind:{$in:["sale","return"]},status:"posted",...matchDate(f),...(constraint?{"lines.productId":constraint}:{})}).toArray(),facts=await saleFacts(db,documents,f,categoryScope);''')
replace_once('lib/reports.ts',
'''const purchases=await db.collection("documents").find({kind:"purchase",status:"posted",...matchDate(f),...(f.productId?{"lines.productId":f.productId}:{})}).project({lines:1}).toArray();''',
'''const purchases=await db.collection("documents").find({kind:"purchase",status:"posted",...matchDate(f),...(constraint?{"lines.productId":constraint}:{})}).project({lines:1}).toArray();''')
replace_once('lib/reports.ts',
'''const productQuery:Document={...(f.productId?{id:f.productId}:{})};''',
'''const productQuery:Document={...(f.productId?{id:f.productId}:f.categoryId?{categoryId:f.categoryId}:{})};''')

# ---------- category dialog ----------
write('app/product-category-dialog.tsx', '''"use client";\nimport { useState, type FormEvent } from "react";\nimport { Plus, X } from "lucide-react";\nimport type { ProductCategory } from "./domain";\nimport { tr } from "./i18n/messages";\n\ntype RunCommand = (body: Record<string, unknown>, message: string, afterSuccess?: () => void) => Promise<unknown>;\n\nexport default function ProductCategoryDialog({ categories, run, close }: { categories: ProductCategory[]; run: RunCommand; close: () => void }) {\n  const [name, setName] = useState("");\n  const [busy, setBusy] = useState(false);\n  const submit = async (event: FormEvent) => {\n    event.preventDefault();\n    if (!name.trim() || busy) return;\n    setBusy(true);\n    try { await run({ type: "product-category.create", name: name.trim() }, tr("تمت إضافة الفئة")); setName(""); } finally { setBusy(false); }\n  };\n  return <div className="modal-card product-category-modal">\n    <div className="product-form-head"><div><small>{tr("الفئات")}</small><h2>{tr("إضافة فئة")}</h2></div><button type="button" className="icon" aria-label={tr("إغلاق")} onClick={close}><X /></button></div>\n    <form className="product-category-create" onSubmit={submit}><label>{tr("اسم الفئة")}<input autoFocus maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><button className="primary" disabled={busy || !name.trim()}><Plus />{busy ? tr("جاري الحفظ…") : tr("إضافة فئة")}</button></form>\n    <div className="product-category-list"><strong>{tr("الفئات الحالية")}</strong>{categories.length ? <div>{categories.map(category => <span key={category.id}>{category.name}</span>)}</div> : <p>{tr("لا توجد فئات حتى الآن")}</p>}</div>\n    <div className="product-form-actions"><button type="button" className="soft" onClick={close}>{tr("إغلاق")}</button></div>\n  </div>;\n}\n''')

# ---------- products/reports UI ----------
replace_once('app/conta-app.tsx',
'''import { tr, type MessageKey } from "./i18n/messages";''',
'''import { tr, type MessageKey } from "./i18n/messages";\nimport ProductCategoryDialog from "./product-category-dialog";''')
replace_once('app/conta-app.tsx',
'''  products: [],\n  documents: [],''',
'''  products: [],\n  categories: [],\n  documents: [],''')
replace_once('app/conta-app.tsx',
'''  const [showArchived, setShowArchived] = useState(false);''',
'''  const [showArchived, setShowArchived] = useState(false);\n  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);''')
replace_once('app/conta-app.tsx',
'''      <button className="primary" onClick={() => openForm(null)}><Plus />  {tr("إضافة منتج")}</button>''',
'''      <button className="soft" type="button" onClick={() => setCategoryDialogOpen(true)}><Plus /> {tr("إضافة فئة")}</button>\n      <button className="primary" onClick={() => openForm(null)}><Plus />  {tr("إضافة منتج")}</button>''')
replace_once('app/conta-app.tsx',
'''    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : tr("إضافة منتج")}><div className="modal-card product-modal"><ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} close={() => setFormOpen(false)} /></div></div>}''',
'''    {categoryDialogOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={tr("إضافة فئة")}><ProductCategoryDialog categories={data.categories} run={run} close={() => setCategoryDialogOpen(false)} /></div>}\n    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : tr("إضافة منتج")}><div className="modal-card product-modal"><ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} categories={data.categories} close={() => setFormOpen(false)} /></div></div>}''')
replace_once('app/conta-app.tsx',
'''function ProductForm({ run, close, product, warehouses }: { run: RunCommand; close: () => void; product: Product | null; warehouses: BootstrapData["warehouses"] }) {''',
'''function ProductForm({ run, close, product, warehouses, categories }: { run: RunCommand; close: () => void; product: Product | null; warehouses: BootstrapData["warehouses"]; categories: BootstrapData["categories"] }) {''')
replace_once('app/conta-app.tsx',
'''[barcode, setBarcode] = useState(product?.barcode ?? ""), [expiryDate, setExpiryDate] = useState(product?.expiryDate ?? ""), [note, setNote] = useState(product?.note ?? "");''',
'''[barcode, setBarcode] = useState(product?.barcode ?? ""), [categoryId, setCategoryId] = useState(product?.categoryId ?? ""), [expiryDate, setExpiryDate] = useState(product?.expiryDate ?? ""), [note, setNote] = useState(product?.note ?? "");''')
replace_once('app/conta-app.tsx',
'''name, barcode, expiryDate, note, pieceCost: cost, piecePrice: price, wholesalePrice, openingStock,''',
'''name, barcode, expiryDate, note, pieceCost: cost, piecePrice: price, wholesalePrice, categoryId, openingStock,''')
replace_once('app/conta-app.tsx',
'''        <label>{tr("اسم المنتج")}<input required value={name} onChange={event => setName(event.target.value)} /></label>\n        <label className="barcode-field">''',
'''        <label>{tr("اسم المنتج")}<input required value={name} onChange={event => setName(event.target.value)} /></label>\n        <label>{tr("الفئة")}<SearchableSelect value={categoryId} onChange={setCategoryId} options={categories.map(category => ({ value: category.id, label: category.name }))} placeholder={tr("بدون فئة")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty /></label>\n        <label className="barcode-field">''')

replace_once('app/conta-app.tsx',
'''[partyId,setPartyId]=useState(""),[productId,setProductId]=useState(""),[accountId,setAccountId]''',
'''[partyId,setPartyId]=useState(""),[productId,setProductId]=useState(""),[categoryId,setCategoryId]=useState(""),[accountId,setAccountId]''')
replace_once('app/conta-app.tsx',
'''if(["sales","purchases","product-sales","profit","stock"].includes(type))add("productId",productId);''',
'''if(["sales","purchases","product-sales","profit","stock"].includes(type)){add("categoryId",categoryId);add("productId",productId);}''')
replace_once('app/conta-app.tsx',
'''setCommittedPeriod(null);setProductId("");setAccountId("");''',
'''setCommittedPeriod(null);setCategoryId("");setProductId("");setAccountId("");''')
replace_once('app/conta-app.tsx',
'''},[productId,accountId,groupBy,movementType,direction,debtSide,search,partyId]);''',
'''},[categoryId,productId,accountId,groupBy,movementType,direction,debtSide,search,partyId]);''')
replace_once('app/conta-app.tsx',
'''const productOptions=data.products.map(p=>({value:p.id,label:`${p.name}${p.isArchived ? ` ${tr("(مؤرشف)")}` : ""}`,search:`${p.name} ${p.sku??""} ${p.barcode??""}`})),partyOptions=''',
'''const productReport=["sales","purchases","product-sales","profit","stock"].includes(type),categoryOptions=data.categories.map(category=>({value:category.id,label:category.name,search:category.name})),productOptions=data.products.filter(p=>!categoryId||p.categoryId===categoryId).map(p=>({value:p.id,label:`${p.name}${p.isArchived ? ` ${tr("(مؤرشف)")}` : ""}`,search:`${p.name} ${p.sku??""} ${p.barcode??""}`})),partyOptions=''' )
replace_once('app/conta-app.tsx',
'''table=reportTableModel(reportColumns(type,productId,groupBy),result)''',
'''table=reportTableModel(reportColumns(type,productId||categoryId,groupBy),result)''')
replace_once('app/conta-app.tsx',
'''buildReportFooterMetrics({type,result,productFiltered:Boolean(productId),partyType:partyTypeFilter})''',
'''buildReportFooterMetrics({type,result,productFiltered:Boolean(productId||categoryId),partyType:partyTypeFilter,translate:tr})''')
replace_once('app/conta-app.tsx',
'''{!showDates&&<button className="primary" onClick={applyDraftPeriod}>{tr("عرض")}</button>}<button className="report-print-button"''',
'''{!showDates&&<button className="primary" onClick={applyDraftPeriod}>{tr("عرض")}</button>}{productReport&&<div className="report-category-filter"><SearchableSelect value={categoryId} onChange={value=>{setCategoryId(value);if(productId&&!data.products.some(product=>product.id===productId&&(!value||product.categoryId===value)))setProductId("")}} options={categoryOptions} placeholder={tr("الفئات")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty /></div>}<button className="report-print-button"''')
replace_once('app/conta-app.tsx',
'''{["sales","purchases","product-sales","profit","stock"].includes(type)&&<SearchableSelect value={productId}''',
'''{productReport&&<SearchableSelect value={productId}''')
replace_once('app/conta-app.tsx',
'''{type==="sales"&&(productId?<><col''',
'''{type==="sales"&&((productId||categoryId)?<><col''')
replace_once('app/conta-app.tsx',
'''<td>{d.type}</td>''',
'''<td>{tr(d.type)}</td>''')

# Replace the old single current-position KPI strip with two clearly titled groups.
old_summary = '''<div className="report-summary-area overview-summary-area" aria-label={tr("ملخص الوضع الحالي")}><div className="report-kpis"><span className="report-kpi"><small>{tr("إجمالي الأرصدة الحالية")}</small><span className="report-kpi-value"><b className={`summary-${reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"}`}><MoneyValue value={reportNumber(result.summary.currentAccountsBalance)} tone={reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"} className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي قيمة المخزون")}</small><span className="report-kpi-value"><b className="summary-neutral"><MoneyValue value={reportNumber(result.summary.currentInventoryValue)} tone="neutral" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المستحق لنا")}</small><span className="report-kpi-value"><b className="summary-positive"><MoneyValue value={reportNumber(result.summary.currentReceivable)} tone="positive" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المستحق علينا")}</small><span className="report-kpi-value"><b className="summary-negative"><MoneyValue value={reportNumber(result.summary.currentPayable)} tone="negative" className="financial-amount-summary"/></b></span></span></div></div>'''
new_summary = '''<div className="overview-summary-groups"><section className="overview-summary-group overview-current-status" aria-label={tr("الوضع الحالي")}><h3>{tr("الوضع الحالي")}</h3><div className="report-kpis"><span className="report-kpi"><small>{tr("إجمالي الأرصدة الحالية")}</small><span className="report-kpi-value"><b className={`summary-${reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"}`}><MoneyValue value={reportNumber(result.summary.currentAccountsBalance)} tone={reportNumber(result.summary.currentAccountsBalance)>0?"positive":reportNumber(result.summary.currentAccountsBalance)<0?"negative":"neutral"} className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي قيمة المخزون")}</small><span className="report-kpi-value"><b className="summary-neutral"><MoneyValue value={reportNumber(result.summary.currentInventoryValue)} tone="neutral" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المستحق لنا")}</small><span className="report-kpi-value"><b className="summary-positive"><MoneyValue value={reportNumber(result.summary.currentReceivable)} tone="positive" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المستحق علينا")}</small><span className="report-kpi-value"><b className="summary-negative"><MoneyValue value={reportNumber(result.summary.currentPayable)} tone="negative" className="financial-amount-summary"/></b></span></span></div></section><section className="overview-summary-group overview-period-performance" aria-label={tr("أداء الفترة")}><h3>{tr("أداء الفترة")}</h3><div className="report-kpis"><span className="report-kpi"><small>{tr("صافي المبيعات")}</small><span className="report-kpi-value"><b className="summary-positive"><MoneyValue value={reportNumber(result.summary.sales)} tone="positive" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المشتريات")}</small><span className="report-kpi-value"><b className="summary-neutral"><MoneyValue value={reportNumber(result.summary.purchases)} tone="neutral" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("إجمالي المصاريف")}</small><span className="report-kpi-value"><b className="summary-negative"><MoneyValue value={reportNumber(result.summary.expenses)} tone="negative" className="financial-amount-summary"/></b></span></span><span className="report-kpi"><small>{tr("صافي الربح")}</small><span className="report-kpi-value"><b className={`summary-${reportNumber(result.summary.netOperatingResult)>0?"positive":reportNumber(result.summary.netOperatingResult)<0?"negative":"neutral"}`}><MoneyValue value={reportNumber(result.summary.netOperatingResult)} tone={reportNumber(result.summary.netOperatingResult)>0?"positive":reportNumber(result.summary.netOperatingResult)<0?"negative":"neutral"} className="financial-amount-summary"/></b></span></span></div></section></div>'''
replace_once('app/conta-app.tsx', old_summary, new_summary)

# ---------- report footer translator ----------
write('app/report-footer.ts', '''import { reportNumber, type ReportResponse, type ReportType, type SummaryTone } from "./report-types.ts";\n\nexport type ReportFooterMetric = { key: string; label: string; value: number; tone: SummaryTone; format?: "number" | "percent"; note?: string };\ntype FooterContext = { type: ReportType; result: ReportResponse; productFiltered?: boolean; partyType?: "customer" | "supplier"; translate?: (label: string) => string };\nconst signed = (value: number): SummaryTone => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";\nconst metric = (summary: ReportResponse["summary"], key: string, label: string, tone: SummaryTone, format?: "number" | "percent", note?: string): ReportFooterMetric => ({ key, label, value: reportNumber(summary[key]), tone, format, note });\n\n/** Explicit accounting conclusions for each ordinary report; overview owns its summary strip. */\nexport function buildReportFooterMetrics({ type, result, productFiltered = false, partyType, translate = value => value }: FooterContext): ReportFooterMetric[] {\n  const s = result.summary, t = translate;\n  if (type === "sales") return [metric(s,"netSales",t("صافي المبيعات"),"positive"),metric(s,"cost",t("تكلفة البضاعة المباعة"),"negative"),metric(s,"profit",t("ربح المبيعات"),signed(reportNumber(s.profit))),metric(s,"margin",t("هامش ربح المبيعات %"),signed(reportNumber(s.margin)),"percent")];\n  if (type === "purchases" && productFiltered) { const total=reportNumber(s.total),quantity=reportNumber(s.quantity); return [metric(s,"total",t("إجمالي شراء المنتج"),"neutral"),metric(s,"quantity",t("الكمية المشتراة"),"neutral"),{key:"averagePurchasePrice",label:t("متوسط سعر شراء الوحدة"),value:quantity?total/quantity:0,tone:"neutral"},metric(s,"count",t("عدد الفواتير التي تحتوي المنتج"),"neutral")]; }\n  if (type === "purchases") return [metric(s,"total",t("إجمالي المشتريات"),"neutral"),metric(s,"paid",t("المدفوع عند تسجيل الفواتير"),"neutral"),metric(s,"due",t("الآجل عند تسجيل الفواتير"),"negative"),metric(s,"count",t("عدد فواتير الشراء"),"neutral")];\n  if (type === "product-sales") return [metric(s,"sales",t("صافي مبيعات الفترة"),"positive"),metric(s,"profit",t("ربح المبيعات في الفترة"),signed(reportNumber(s.profit))),metric(s,"quantity",t("الكمية الحالية بالمخزون"),"neutral"),metric(s,"products",t("عدد المنتجات المعروضة"),"neutral")];\n  if (type === "stock") return [metric(s,"incoming",t("إجمالي الوحدات الداخلة"),"neutral"),metric(s,"outgoing",t("إجمالي الوحدات الخارجة"),"neutral"),metric(s,"netChange",t("صافي تغير الكمية"),"neutral"),metric(s,"movements",t("عدد الحركات"),"neutral")];\n  if (type === "debts") return [metric(s,"receivable",t("إجمالي المستحق لنا"),"positive"),metric(s,"payable",t("إجمالي المستحق علينا"),"negative"),metric(s,"net",t("صافي الذمم"),signed(reportNumber(s.net)),undefined,reportNumber(s.net)===0?t("متوازن"):undefined),metric(s,"count",t("عدد الحسابات المطابقة"),"neutral")];\n  if (type === "party-ledger") { const current=reportNumber(s.net),role=partyType??(s.partyType==="supplier"?"supplier":"customer"); return [metric(s,"tradeTotal",t(role==="customer"?"مبيعات العميل في الفترة":"مشترياتنا من المورد في الفترة"),role==="customer"?"positive":"neutral"),metric(s,"debitTotal",t("إجمالي المدين في الفترة"),"neutral"),metric(s,"creditTotal",t("إجمالي الدائن في الفترة"),"neutral"),metric(s,"net",t("الرصيد الحالي الآن"),signed(current),undefined,current===0?t("متوازن"):current>0?t("مستحق لنا"):t("مستحق علينا"))]; }\n  if (type === "financial") return [metric(s,"businessIncoming",t("المقبوضات التشغيلية"),"positive"),metric(s,"businessOutgoing",t("المدفوعات التشغيلية"),"negative"),metric(s,"businessNet",t("صافي التدفق التشغيلي"),signed(reportNumber(s.businessNet))),metric(s,"balanceNet",t("صافي تغير الأرصدة خلال الفترة"),signed(reportNumber(s.balanceNet)))];\n  if (type === "expenses") return [metric(s,"total",t("إجمالي المصاريف"),"negative"),metric(s,"recurringTotal",t("المصاريف المتكررة المسجلة"),"negative"),metric(s,"oneOffTotal",t("المصاريف غير المتكررة"),"negative"),metric(s,"count",t("عدد المصاريف"),"neutral")];\n  if (type === "profit") return [metric(s,"revenue",t("صافي المبيعات"),"positive"),metric(s,"cost",t("تكلفة البضاعة المباعة"),"negative"),metric(s,"profit",t("ربح المبيعات"),signed(reportNumber(s.profit))),metric(s,"margin",t("هامش ربح المبيعات %"),signed(reportNumber(s.margin)),"percent")];\n  return [];\n}\n''')

# ---------- i18n ----------
messages_path = ROOT / 'app/i18n/messages.ts'
messages = messages_path.read_text(encoding='utf-8')
ar_end = messages.index('\n} as const;\n\nexport type MessageKey')
fr_start = messages.index('export const frMessages:')
fr_end = messages.index('\n};\nexport const messages', fr_start)
ar_part = messages[:ar_end]
fr_part = messages[fr_start:fr_end]

translations = {
    'الفئات':'Catégories','الفئة':'Catégorie','إضافة فئة':'Ajouter une catégorie','اسم الفئة':'Nom de la catégorie',
    'الفئات الحالية':'Catégories existantes','لا توجد فئات حتى الآن':'Aucune catégorie pour le moment','تمت إضافة الفئة':'Catégorie ajoutée',
    'بدون فئة':'Sans catégorie','ابحث عن فئة':'Rechercher une catégorie','الوضع الحالي':'Situation actuelle','أداء الفترة':'Performance sur la période',
    'صافي الربح':'Résultat net de la période','صافي المبيعات':'Ventes nettes','تكلفة البضاعة المباعة':'Coût des marchandises vendues',
    'ربح المبيعات':'Marge brute sur ventes','هامش ربح المبيعات %':'Taux de marge brute %','إجمالي شراء المنتج':'Total des achats du produit',
    'الكمية المشتراة':'Quantité achetée','متوسط سعر شراء الوحدة':'Coût moyen d’achat unitaire','عدد الفواتير التي تحتوي المنتج':'Factures contenant ce produit',
    'إجمالي المشتريات':'Total des achats','المدفوع عند تسجيل الفواتير':'Réglé à la saisie','الآجل عند تسجيل الفواتير':'À crédit à la saisie',
    'عدد فواتير الشراء':'Nombre de factures d’achat','صافي مبيعات الفترة':'Ventes nettes de la période','ربح المبيعات في الفترة':'Marge brute de la période',
    'الكمية الحالية بالمخزون':'Stock actuel','عدد المنتجات المعروضة':'Produits affichés','إجمالي الوحدات الداخلة':'Unités entrées',
    'إجمالي الوحدات الخارجة':'Unités sorties','صافي تغير الكمية':'Variation nette du stock','عدد الحركات':'Nombre de mouvements',
    'إجمالي المستحق لنا':'Total à recevoir','إجمالي المستحق علينا':'Total à payer','صافي الذمم':'Solde net des tiers','متوازن':'Soldé',
    'عدد الحسابات المطابقة':'Comptes correspondants','مبيعات العميل في الفترة':'Ventes au client sur la période','مشترياتنا من المورد في الفترة':'Achats auprès du fournisseur sur la période',
    'إجمالي المدين في الفترة':'Total débit sur la période','إجمالي الدائن في الفترة':'Total crédit sur la période','الرصيد الحالي الآن':'Solde actuel',
    'مستحق لنا':'À recevoir','مستحق علينا':'À payer','المقبوضات التشغيلية':'Encaissements d’exploitation','المدفوعات التشغيلية':'Décaissements d’exploitation',
    'صافي التدفق التشغيلي':'Flux net d’exploitation','صافي تغير الأرصدة خلال الفترة':'Variation nette des soldes','إجمالي المصاريف':'Total des dépenses',
    'المصاريف المتكررة المسجلة':'Dépenses récurrentes','المصاريف غير المتكررة':'Dépenses ponctuelles','عدد المصاريف':'Nombre de dépenses',
    'إجمالي الأرصدة الحالية':'Total des soldes actuels','إجمالي قيمة المخزون':'Valeur actuelle du stock',
}

# Add any missing Arabic keys.
ar_insert = ''
for key in translations:
    if f'  {json.dumps(key, ensure_ascii=False)}:' not in ar_part:
        ar_insert += f'  {json.dumps(key, ensure_ascii=False)}: {json.dumps(key, ensure_ascii=False)},\n'
if ar_insert:
    messages = messages[:ar_end] + '\n' + ar_insert.rstrip('\n') + messages[ar_end:]

# Recompute French boundaries after Arabic insertion and replace/add translations.
fr_start = messages.index('export const frMessages:')
fr_end = messages.index('\n};\nexport const messages', fr_start)
fr_part = messages[fr_start:fr_end]
for key, value in translations.items():
    key_literal = json.dumps(key, ensure_ascii=False)
    pattern = re.compile(rf'^(\s*{re.escape(key_literal)}:\s*)"(?:[^"\\]|\\.)*"(,?)$', re.M)
    replacement = rf'\1{json.dumps(value, ensure_ascii=False)}\2'
    fr_part, count = pattern.subn(replacement, fr_part, count=1)
    if count == 0:
        fr_part += f'\n  {key_literal}: {json.dumps(value, ensure_ascii=False)},'
messages = messages[:fr_start] + fr_part + messages[fr_end:]
messages_path.write_text(messages, encoding='utf-8')

# API errors for category actions.
replace_once('app/i18n/api-errors.ts',
'''  "تعذر تنفيذ العملية": "Impossible d’effectuer l’opération",''',
'''  "تعذر تنفيذ العملية": "Impossible d’effectuer l’opération",\n  "اسم الفئة مطلوب": "Le nom de la catégorie est obligatoire",\n  "اسم الفئة طويل جدًا": "Le nom de la catégorie est trop long",\n  "هذه الفئة موجودة بالفعل": "Cette catégorie existe déjà",\n  "الفئة غير موجودة": "Catégorie introuvable",''')

# ---------- styles ----------
with (ROOT / 'app/globals.css').open('a', encoding='utf-8') as fh:
    fh.write('''\n\n/* product-categories + comprehensive-report-summary */\n.product-category-modal{width:min(540px,94vw);display:grid;gap:10px}\n.product-category-create{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:7px}\n.product-category-create label{display:grid;gap:4px;font-size:10px;font-weight:800}\n.product-category-create input,.product-category-create button{height:34px;min-height:34px}\n.product-category-create button{display:flex;align-items:center;gap:5px}.product-category-create button svg{width:15px;height:15px}\n.product-category-list{display:grid;gap:6px;min-height:90px;padding:8px;border:1px solid var(--line);border-radius:6px;background:#fff}\n.product-category-list>div{display:flex;flex-wrap:wrap;gap:5px;max-height:190px;overflow:auto}\n.product-category-list span{padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--panel-soft,#f7f9f8);font-size:10px;font-weight:800}\n.product-category-list p{margin:0;color:var(--muted);font-size:10px}\n.report-category-filter{flex:0 0 180px;min-width:160px;max-width:210px}.report-category-filter .combobox{width:100%;min-width:0}\n.overview-summary-groups{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}\n.overview-summary-group{min-width:0;padding:7px;border:1px solid var(--line);border-radius:7px;background:var(--panel,#fff)}\n.overview-summary-group h3{margin:0 0 6px;padding:0 2px;color:var(--ink);font-size:11px;font-weight:900}\n.overview-summary-group .report-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}\n.overview-summary-group .report-kpi{min-width:0}\n@media(max-width:1050px){.product-category-create{grid-template-columns:1fr}.report-category-filter{flex:1 1 190px;max-width:none}.overview-summary-groups{grid-template-columns:1fr}.overview-summary-group .report-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}\n@media(max-width:620px){.overview-summary-group .report-kpis{grid-template-columns:1fr}}\n''')

# ---------- tests ----------
write('tests/product-categories.test.mjs', '''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { readFile } from "node:fs/promises";\n\nconst source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");\n\ntest("product categories are persisted and exposed through bootstrap", async () => {\n  const [domain, bootstrap, command] = await Promise.all([source("app/domain.ts"), source("app/api/bootstrap/route.ts"), source("app/api/command/route.ts")]);\n  assert.match(domain, /interface ProductCategory/);\n  assert.match(domain, /categoryId\?: string \| null/);\n  assert.match(domain, /categories: ProductCategory\[\]/);\n  assert.match(bootstrap, /collection\("productCategories"\)/);\n  assert.match(bootstrap, /categories:cleanCategories/);\n  assert.match(command, /"product-category\.create":"products\.create"/);\n  assert.match(command, /categoryId: categoryId \|\| null/);\n});\n\ntest("products can create categories and assign them", async () => {\n  const [ui, dialog] = await Promise.all([source("app/conta-app.tsx"), source("app/product-category-dialog.tsx")]);\n  assert.match(ui, /ProductCategoryDialog/);\n  assert.match(ui, /tr\("إضافة فئة"\)/);\n  assert.match(ui, /categories=\{data\.categories\}/);\n  assert.match(ui, /\[categoryId, setCategoryId\] = useState\(product\?\.categoryId \?\? ""\)/);\n  assert.match(ui, /wholesalePrice, categoryId, openingStock/);\n  assert.match(dialog, /product-category\.create/);\n});\n\ntest("category report filter reaches the report backend", async () => {\n  const [ui, filters, reports] = await Promise.all([source("app/conta-app.tsx"), source("app/report-types.ts"), source("lib/reports.ts")]);\n  assert.match(filters, /categoryId\?: string/);\n  assert.match(ui, /add\("categoryId",categoryId\)/);\n  assert.match(ui, /className="report-category-filter"/);\n  assert.match(reports, /categoryId: text\(url\.searchParams\.get\("categoryId"\)\)/);\n  assert.match(reports, /find\(\{ categoryId: f\.categoryId \}\)/);\n  assert.match(reports, /categoryScope/);\n});\n''')
write('tests/overview-period-summary.test.mjs', '''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { readFile } from "node:fs/promises";\n\nconst source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");\n\ntest("overview separates current position from period performance", async () => {\n  const [ui, reports] = await Promise.all([source("app/conta-app.tsx"), source("lib/reports.ts")]);\n  assert.match(ui, /overview-summary-groups/);\n  assert.match(ui, /tr\("الوضع الحالي"\)/);\n  assert.match(ui, /tr\("أداء الفترة"\)/);\n  for (const key of ["currentAccountsBalance","currentInventoryValue","currentReceivable","currentPayable","sales","purchases","expenses","netOperatingResult"]) assert.match(ui, new RegExp(`summary\\.${key}`));\n  assert.match(reports, /netOperatingResult:p\.profit-expenses/);\n});\n''')
write('tests/report-footer-i18n.test.mjs', '''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { readFile } from "node:fs/promises";\n\nconst source = async path => readFile(new URL(`../${path}`, import.meta.url), "utf8");\n\ntest("report footer labels follow the selected language", async () => {\n  const [footer, ui, messages] = await Promise.all([source("app/report-footer.ts"), source("app/conta-app.tsx"), source("app/i18n/messages.ts")]);\n  assert.match(footer, /translate\?: \(label: string\) => string/);\n  assert.match(footer, /t\("صافي المبيعات"\)/);\n  assert.match(footer, /t\("المقبوضات التشغيلية"\)/);\n  assert.match(ui, /translate:tr/);\n  assert.match(messages, /"صافي المبيعات": "Ventes nettes"/);\n  assert.match(messages, /"تكلفة البضاعة المباعة": "Coût des marchandises vendues"/);\n  assert.match(messages, /"المقبوضات التشغيلية": "Encaissements d’exploitation"/);\n  assert.match(messages, /"الوضع الحالي": "Situation actuelle"/);\n  assert.match(messages, /"أداء الفترة": "Performance sur la période"/);\n});\n''')

print('Applied product categories, comprehensive report split, and report footer localization.')
