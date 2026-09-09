import fs from "node:fs";

const path = "app/conta-app.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous ${label}`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
  'import { SortableTableHeader, useSortableRows } from "./table-sorting";',
  'import { SortableTableHeader, compareTableValues, sortTableRows, useSortableRows, type TableValueType } from "./table-sorting";',
  "table sorting import",
);

replaceOnce(
  'const query=normalizeSearch(q), list=data.parties.filter(p=>resolvePartyType(p)===partyType&&(!query||normalizeSearch(`${p.name} ${p.phone}`).includes(query))).sort((a,b)=>a.name.localeCompare(b.name));',
  'const query=normalizeSearch(q), list=data.parties.filter(p=>resolvePartyType(p)===partyType&&(!query||normalizeSearch(`${p.name} ${p.phone}`).includes(query))).sort((a,b)=>compareTableValues(a.name,b.name,"text","asc"));',
  "party name sort",
);

const reportStart = source.indexOf('const reportColumns = (type: ReportType');
const reportEndMarker = '} as Record<ReportType,Array<[string,string]>>)[type];';
const reportEndAt = source.indexOf(reportEndMarker, reportStart);
if (reportStart < 0 || reportEndAt < 0) throw new Error("Missing reportColumns block");
const reportEnd = reportEndAt + reportEndMarker.length;
const reportBlock = `const reportColumns = (type: ReportType, productId: string, groupBy: string): Array<[string,string,TableValueType]> => ({
 overview:[["date",tr("التاريخ"),"date"],["sales",tr("المبيعات"),"money"],["purchases",tr("المشتريات"),"money"],["expenses",tr("المصاريف"),"money"],["received",tr("المقبوض"),"money"],["paid",tr("المدفوع"),"money"],["net",tr("صافي الحركة"),"money"]],
 sales:productId?[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["product",tr("المنتج"),"text"],["quantity",tr("الكمية"),"number"],["unitPrice",tr("سعر البيع"),"money"],["cost",tr("تكلفة الشراء"),"money"],["profit",tr("الربح"),"money"]]:[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["party",tr("العميل / بيع مباشر"),"text"],["total",tr("قيمة البيع"),"money"],["cost",tr("تكلفة الشراء"),"money"],["profit",tr("الربح"),"money"]],
 purchases:productId?[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["party",tr("المورد"),"text"],["product",tr("المنتج"),"text"],["quantity",tr("الكمية"),"number"],["unitPrice",tr("سعر الشراء"),"money"],["total",tr("إجمالي المنتج"),"money"]]:[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["party",tr("المورد"),"text"],["paymentMethod",tr("طريقة التسوية"),"text"],["total",tr("الإجمالي"),"money"],["paid",tr("المدفوع"),"money"],["due",tr("المستحق"),"money"]],
 "product-sales":[["product",tr("اسم المنتج"),"text"],["soldQuantity",tr("الكمية المباعة"),"number"],["currentQuantity",tr("الكمية الحالية"),"number"],["netSales",tr("صافي المبيعات"),"money"],["purchasedQuantity",tr("الكمية المشتراة"),"number"],["purchases",tr("إجمالي المشتريات"),"money"],["netPurchases",tr("صافي المشتريات"),"money"],["averagePrice",tr("متوسط سعر البيع"),"money"],["averagePurchasePrice",tr("متوسط سعر الشراء"),"money"],["profit",tr("الربح"),"money"]],
 stock:[["occurredAt",tr("التاريخ"),"date"],["product",tr("المنتج"),"text"],["warehouse",tr("المخزن"),"text"],["movementType",tr("العملية"),"text"],["before",tr("قبل"),"number"],["change",tr("التغيير"),"number"],["after",tr("بعد"),"number"],["documentNumber",tr("المستند"),"text"]],
 profit:groupBy==="product"?[["product",tr("اسم المنتج"),"text"],["quantity",tr("الكمية"),"number"],["revenue",tr("صافي المبيعات"),"money"],["cost",tr("التكلفة"),"money"],["profit",tr("الربح"),"money"],["margin",tr("الهامش %"),"number"],["invoiceCount",tr("عدد الفواتير"),"number"]]:[["number",tr("رقم الفاتورة"),"number"],["occurredAt",tr("التاريخ"),"date"],["revenue",tr("صافي المبيعات"),"money"],["cost",tr("التكلفة"),"money"],["profit",tr("الربح"),"money"],["margin",tr("الهامش %"),"number"]],
 debts:[["name",tr("اسم الحساب"),"text"],["accountType",tr("نوع الحساب"),"text"],["phone",tr("الهاتف"),"text"],["balance",tr("الرصيد المستحق"),"money"],["lastMovement",tr("آخر حركة"),"date"]],
 "party-ledger":[["occurredAt",tr("التاريخ"),"date"],["movementType",tr("نوع العملية"),"text"],["documentNumber",tr("رقم المستند"),"text"],["description",tr("البيان"),"text"],["debit",tr("مدين"),"money"],["credit",tr("دائن"),"money"],["paymentMethod",tr("وسيلة الدفع"),"text"]],
 financial:[["occurredAt",tr("التاريخ"),"date"],["paymentMethod",tr("وسيلة الدفع"),"text"],["movementType",tr("نوع العملية"),"text"],["incoming",tr("داخل"),"money"],["outgoing",tr("خارج"),"money"],["party",tr("الطرف"),"text"],["documentNumber",tr("المستند"),"text"]],
 expenses:[["occurredAt",tr("التاريخ"),"date"],["title",tr("عنوان المصروف"),"text"],["recurring",tr("النوع"),"text"],["paymentMethod",tr("وسيلة الدفع"),"text"],["total",tr("المبلغ"),"money"],["number",tr("المستند"),"number"]],
} as Record<ReportType,Array<[string,string,TableValueType]>>)[type];`;
source = source.slice(0, reportStart) + reportBlock + source.slice(reportEnd);

const productStart = source.indexOf('  const stockOf = (product: Product) => Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);');
const productEnd = source.indexOf('  const toggleSort = (key: "price" | "cost" | "stock")', productStart);
if (productStart < 0 || productEnd < 0) throw new Error("Missing product sorting block");
const productBlock = `  const stockOf = (product: Product) => Object.values(product.stocks).reduce((sum, value) => sum + Number(value), 0);
  const productSortColumns=useMemo(()=>[
    {key:"price",type:"money" as const,get:(product:Product)=>product.piecePrice},
    {key:"cost",type:"money" as const,get:(product:Product)=>product.lastPurchaseCost},
    {key:"stock",type:"number" as const,get:(product:Product)=>Object.values(product.stocks).reduce((sum,value)=>sum+Number(value),0)},
  ],[]);
  const products=useMemo(()=>sortTableRows(filteredProducts,sort,productSortColumns),[filteredProducts,sort,productSortColumns]);
`;
source = source.slice(0, productStart) + productBlock + source.slice(productEnd);

const sortStart = source.indexOf('  const sortedRows=!sortState?table.rows:');
const sortEnd = source.indexOf('  if(type==="overview") {', sortStart);
if (sortStart < 0 || sortEnd < 0) throw new Error("Missing report sorting comparator");
const sortBlock = `  const reportSortColumns=columns.map(([key,,columnType])=>({key,type:columnType,get:(row:ReportResponse["rows"][number])=>row[key]}));
  const sortedRows=sortTableRows(table.rows,sortState,reportSortColumns,locale);
  const toggleReportSort=(key:string)=>{const column=columns.find(([columnKey])=>columnKey===key),initial=column?.[2]==="number"||column?.[2]==="money"?"desc":"asc";setSortState(current=>current?.key===key?{key,direction:current.direction==="asc"?"desc":"asc"}:{key,direction:initial})};
`;
source = source.slice(0, sortStart) + sortBlock + source.slice(sortEnd);

if (source.includes('numeric=typeof leftValue==="number"||typeof rightValue==="number"')) throw new Error("Legacy report comparator remains");
if (!source.includes('sortTableRows(table.rows,sortState,reportSortColumns,locale)')) throw new Error("Central report sorting was not wired");
if (!source.includes('productSortColumns=useMemo')) throw new Error("Product sorting was not centralized");

fs.writeFileSync(path, source);
