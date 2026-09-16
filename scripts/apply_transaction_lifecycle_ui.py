from pathlib import Path

path = Path("app/conta-app.tsx")
text = path.read_text(encoding="utf-8")


def must_replace(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)


def replace_between(start: str, end: str, replacement: str) -> None:
    global text
    first = text.find(start)
    if first < 0:
        raise SystemExit(f"start marker not found: {start!r}")
    last = text.find(end, first)
    if last < 0:
        raise SystemExit(f"end marker not found after {start!r}: {end!r}")
    text = text[:first] + replacement.rstrip() + "\n\n" + text[last:]


must_replace(
    'import { isOpeningStockCorrectionDocument, isOpeningStockDocument, optionalFiniteNumber } from "./stock-movement";\n',
    'import { isOpeningStockCorrectionDocument, isOpeningStockDocument, optionalFiniteNumber } from "./stock-movement";\nimport { adjustmentActualQuantity, canUseCapability, documentProductQuantityEffect } from "./transaction-ui";\n',
)

recent = r'''function LifecycleActions({onEdit,onVoid}:{onEdit?:()=>void;onVoid?:()=>void}) {
  if(!onEdit&&!onVoid)return null;
  return <div className="party-row-actions lifecycle-row-actions">{onEdit&&<button type="button" className="soft" onClick={event=>{event.stopPropagation();onEdit()}}><PencilLine/>{tr("تعديل")}</button>}{onVoid&&<button type="button" className="danger compact-delete" onClick={event=>{event.stopPropagation();onVoid()}}>{tr("حذف")}</button>}</div>;
}
function Recent({
  title,
  docs,
  openDoc,
  dateFilter = false,
  bare = false,
  privateAmounts = false,
  actions,
}: {
  title: string;
  docs: DocumentRecord[];
  openDoc: (id: string) => void;
  dateFilter?: boolean;
  bare?: boolean;
  privateAmounts?: boolean;
  actions?: (document: DocumentRecord) => ReactNode;
}) {
  const today = localBusinessDay();
  const [from, setFrom] = useState(dateFilter ? today : "");
  const [to, setTo] = useState(dateFilter ? today : "");
  const visibleDocs = dateFilter
    ? docs.filter(document => {
        const occurredOn = document.occurredAt.slice(0, 10);
        if (!from && !to) return occurredOn === today;
        return (!from || occurredOn >= from) && (!to || occurredOn <= to);
      })
    : docs;
  const statusLabel=(document:DocumentRecord)=>document.status==="voided"?tr("ملغى"):document.dueTotal>0&&document.paidTotal<document.dueTotal?tr("مستحق"):tr("معتمد");
  const columns=useMemo(()=>[{key:"date",type:"date" as const,get:(d:DocumentRecord)=>d.occurredAt},{key:"number",type:"number" as const,get:(d:DocumentRecord)=>d.sequence??d.number},{key:"kind",type:"text" as const,get:(d:DocumentRecord)=>tr(kindLabels[d.kind])},{key:"party",type:"text" as const,get:(d:DocumentRecord)=>invoicePartyName(d)??d.title},{key:"status",type:"text" as const,get:(d:DocumentRecord)=>statusLabel(d)},{key:"total",type:"money" as const,get:(d:DocumentRecord)=>d.total}],[]),{sort,sortedRows,toggle}=useSortableRows(visibleDocs,columns);
  const hasActions=Boolean(actions);
  const table = <>{dateFilter && <div className="filters recent-date-filters"><label>{tr("من تاريخ")}<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>{tr("إلى تاريخ")}<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>}<div className="erp-table-wrap"><table className="erp-table">{hasActions?<colgroup><col style={{width:"5%"}}/><col style={{width:"14%"}}/><col style={{width:"15%"}}/><col style={{width:"12%"}}/><col style={{width:"17%"}}/><col style={{width:"10%"}}/><col style={{width:"12%"}}/><col style={{width:"15%"}}/></colgroup>:<colgroup><col style={{width:"6%"}}/><col style={{width:"17%"}}/><col style={{width:"18%"}}/><col style={{width:"15%"}}/><col style={{width:"20%"}}/><col style={{width:"12%"}}/><col style={{width:"12%"}}/></colgroup>}<thead><tr><th>{tr("رقم")}</th><SortableTableHeader column="date" label={tr("التاريخ")} sort={sort} toggle={toggle}/><SortableTableHeader column="number" label={tr("المستند")} sort={sort} toggle={toggle}/><SortableTableHeader column="kind" label={tr("النوع")} sort={sort} toggle={toggle}/><SortableTableHeader column="party" label={tr("الطرف")} sort={sort} toggle={toggle}/><SortableTableHeader column="status" label={tr("الحالة")} sort={sort} toggle={toggle}/><SortableTableHeader column="total" label={tr("المبلغ")} sort={sort} toggle={toggle}/>{hasActions&&<th>{tr("إجراءات")}</th>}</tr></thead><tbody>{sortedRows.map((d,index) => <tr key={d.id} onClick={() => openDoc(d.id)}><td className="num-cell">{number(index+1)}</td><td>{formatDateTime(d.occurredAt)}</td><td dir="ltr">{displayDocumentNumber(d)}</td><td>{tr(kindLabels[d.kind])}</td><td className="name-cell">{invoicePartyName(d) ?? d.title ?? "—"}</td><td>{statusLabel(d)}</td><td className="num-cell">{privateAmounts?<MoneyValue value={d.total}/>:money(d.total)}</td>{hasActions&&<td className="action-cell">{actions?.(d)??"—"}</td>}</tr>)}{!sortedRows.length && <tr><td colSpan={hasActions?8:7}>{tr("لا توجد فواتير ضمن الفترة المحددة")}</td></tr>}</tbody></table></div></>;
  return bare ? table : <FramedSection title={title} className="records recent-table">{table}</FramedSection>;
}'''
replace_between("function Recent({", "function Heading(", recent)

party_page = r'''function PartyPage({party,data,openDoc,run}:{party:Party;data:BootstrapData;openDoc:(id:string)=>void;run:RunCommand}) {
  const confirmAction=useAppConfirm();
  const today=localBusinessDay(),[from,setFrom]=useState(today),[to,setTo]=useState(today),[amount,setAmount]=useState(""),[paymentMethod,setPaymentMethod]=useState(""),[direction,setDirection]=useState<"receive"|"pay">("receive"),[note,setNote]=useState(""),[editingPaymentId,setEditingPaymentId]=useState<string|null>(null);
  const customer=resolvePartyType(party)==="customer", balance=party.receivable-party.payable,summary=data.partyFinancialSummaries.find(item=>item.partyId===party.id),metrics=partyTradeMetrics(summary,customer?"customer":"supplier");
  const canEditPayment=canUseCapability(data.principal,customer?"customers.collect.edit":"suppliers.pay.edit"),canDeletePayment=canUseCapability(data.principal,customer?"customers.collect.delete":"suppliers.pay.delete");
  // Legacy records remain traceable inside an existing party audit view only.
  const kinds=customer?["sale","return","payment","settlement"]:["purchase","payment","settlement"];
  const docs=data.documents.filter(d=>d.partyId===party.id&&kinds.includes(d.kind)&&(!from||d.occurredAt.slice(0,10)>=from)&&(!to||d.occurredAt.slice(0,10)<=to));
  const resetPaymentEditor=()=>{setEditingPaymentId(null);setAmount("");setNote("");setPaymentMethod("");setDirection("receive")};
  const editPayment=(document:DocumentRecord)=>{if(!canEditPayment||document.kind!=="payment"||!document.partyCashDirection){openDoc(document.id);return}const activeAccount=data.paymentAccounts.find(account=>(account.id===document.paymentMethod||account.code===document.paymentMethod)&&account.isActive!==false&&account.isArchived!==true);setEditingPaymentId(document.id);setAmount(String(document.cashAmount??document.total));setPaymentMethod(activeAccount?.id??"");setDirection(document.partyCashDirection);setNote(String((document as DocumentRecord&{note?:string|null}).note??""))};
  const submit=async()=>{await run({type:editingPaymentId?"party-cash.update":"party-cash.post",...(editingPaymentId?{documentId:editingPaymentId}:{partyId:party.id,partyType:resolvePartyType(party)}),direction,amount:val(amount),paymentMethod,note},tr("تم تسجيل الحركة"),resetPaymentEditor)};
  const removePayment=async(document:DocumentRecord)=>{if(!canDeletePayment||document.kind!=="payment"||!document.partyCashDirection)return;if(!await confirmAction({message:`هل تريد حذف الحركة رقم ${displayDocumentNumber(document)}؟\nسيتم عكس أثرها على رصيد الطرف والحساب المالي مع الاحتفاظ بسجل التدقيق.`,confirmLabel:tr("حذف"),tone:"danger"}))return;await run({type:"party-cash.void",documentId:document.id},"تم إلغاء الحركة",()=>{if(editingPaymentId===document.id)resetPaymentEditor()})};
  return <section className={`party-detail ${customer?"customer-detail":"supplier-detail"}`}><div className="party-detail-top"><FramedSection title={customer?tr("حساب العميل"):tr("حساب المورد")} className="party-account-summary"><div className="party-identity"><div className="party-identity-field"><small>{tr("الاسم")}</small><strong>{party.name}</strong><small>{tr("الهاتف")}</small><strong><bdi dir="ltr">{party.phone||"—"}</bdi></strong></div></div><div className={`party-balance ${balance>0?"receivable":balance<0?"payable":"neutral"}`}><span>{balance>0?tr("مستحق لنا"):balance<0?tr("مستحق علينا"):tr("الحساب متوازن")}</span><MoneyValue value={Math.abs(balance)} tone={balance>0?"positive":balance<0?"negative":"neutral"} className="financial-amount-summary"/></div></FramedSection><FramedSection title={editingPaymentId?`${tr("تعديل")} · ${tr("حركة مالية")}`:tr("حركة مالية")} className="party-payment-panel"><div className="party-payment-row"><div className="party-cash-direction"><button type="button" className="selection-option" aria-pressed={direction==="receive"} onClick={()=>setDirection("receive")}>{tr("استلام من")} {customer?tr("العميل"):tr("المورد")}</button><button type="button" className="selection-option" aria-pressed={direction==="pay"} onClick={()=>setDirection("pay")}>{tr("دفع لل")}{customer?tr("عميل"):tr("مورد")}</button></div><label>{tr("الحساب")}<PaymentAccountSelect accounts={data.paymentAccounts} activeOnly value={paymentMethod} onChange={setPaymentMethod}/></label><label>{tr("المبلغ")}<Num value={amount} onChange={setAmount}/></label><label>{tr("ملاحظة")}<input value={note} onChange={e=>setNote(e.target.value)}/></label><div className="party-row-actions"><button className="primary" disabled={!Number.isFinite(val(amount))||val(amount)<=0||!paymentMethod} onClick={()=>void submit()}>{editingPaymentId?tr("حفظ التعديل"):tr("تسجيل الحركة")}</button>{editingPaymentId&&<button type="button" className="soft" onClick={resetPaymentEditor}>{tr("إلغاء التعديل")}</button>}</div></div></FramedSection></div><FramedSection title={tr("سجل الحساب")} className="party-history"><div className="party-history-toolbar"><CompactDateRange from={from} to={to} allTime={!from&&!to} onAllTime={()=>{setFrom("");setTo("")}} onFromChange={setFrom} onToChange={setTo}/></div><Recent title={tr("الحركات")} docs={docs} openDoc={openDoc} bare privateAmounts actions={document=>document.kind==="payment"&&document.partyCashDirection?<LifecycleActions onEdit={canEditPayment?()=>editPayment(document):undefined} onVoid={canDeletePayment?()=>void removePayment(document):undefined}/>:null}/><PartyMetricStrip items={[{labelKey:customer?"إجمالي ما اشتراه منا":"إجمالي مشترياتنا منه",value:metrics.total},{labelKey:customer?"إجمالي ما دفع لنا":"إجمالي ما دفعناه له",value:customer?summary?.cashIn??0:summary?.cashOut??0},{labelKey:customer?"إجمالي ما دفعناه له":"إجمالي ما دفع لنا",value:customer?summary?.cashOut??0:summary?.cashIn??0},{labelKey:customer?"الربح الإجمالي من مبيعاته":"عدد فواتير الشراء",value:customer?metrics.grossProfit??0:summary?.supplierInvoiceCount??0,tone:customer?(Number(metrics.grossProfit??0)>0?"positive":Number(metrics.grossProfit??0)<0?"negative":"neutral"):"neutral",count:!customer}]}/></FramedSection></section>;
}'''
replace_between("function PartyPage(", "export const ALL_WAREHOUSES", party_page)

stock_block = r'''function StockDraftTable({ mode, lines, products, warehouseId, onChange, onRemove, lockedProducts=false }: { mode: "transfer" | "adjust"; lines: DraftLine[]; products: Product[]; warehouseId: string; onChange: (line: DraftLine) => void; onRemove: (id: string) => void; lockedProducts?:boolean }) {
  const adjustment = mode === "adjust";
  return <div className="erp-table-wrap stock-draft"><table className="erp-table" aria-label={tr("المنتجات الجاري تنفيذ العملية عليها")}><colgroup><col style={{width:"7%"}}/><col style={{width:"37%"}}/><col style={{width:"18%"}}/><col style={{width:"30%"}}/><col style={{width:"8%"}}/></colgroup><thead><tr><th>{tr("رقم")}</th><th>{tr("المنتج")}</th><th>{adjustment ? tr("المخزون الحالي") : tr("المتوفر")}</th><th>{adjustment ? tr("الكمية الفعلية") : tr("الكمية للتحويل")}</th><th>{tr("حذف")}</th></tr></thead><tbody>{lines.map((line,index)=>{const product=products.find(item=>item.id===line.productId),available=Number(product?.stocks?.[warehouseId]??0);return <tr key={line.productId}><td className="num-cell">{number(index+1)}</td><td>{product?.name??line.productId}</td><td className="num-cell">{number(available)}</td><td><Num value={adjustment?line.actualQuantity:line.quantity} onChange={value=>onChange(adjustment?{...line,actualQuantity:value}:{...line,quantity:value})}/></td><td className="action-cell"><button type="button" className="icon danger" disabled={lockedProducts} aria-label={tr("ui.deleteItem",{name:product?.name??line.productId})} onClick={()=>onRemove(line.productId)}><X/></button></td></tr>})}{!lines.length&&<tr><td colSpan={5} className="draft-empty">{tr("أضف منتجًا لبدء العملية")}</td></tr>}</tbody></table></div>;
}

function MultiStockForm({
  data,
  mode,
  run,
  openDoc,
  prefill,
  clearPrefill,
  editingDocument,
  onCancelEdit,
}: {
  data: BootstrapData;
  mode: "transfer" | "adjust";
  run: RunCommand;
  openDoc: (id: string) => void;
  prefill?: AdjustmentPrefill | null;
  clearPrefill?: () => void;
  editingDocument?: DocumentRecord | null;
  onCancelEdit?: () => void;
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
    if (editingDocument || mode !== "adjust" || !prefill) return;
    const product = data.products.find(item => item.id === prefill.productId);
    setFrom(prefill.warehouseId);
    setLines(product ? [{ ...lineFor(product), actualQuantity: "", unitPrice: "" }] : []);
    setReason("");
  }, [data.products, editingDocument, mode, prefill, setFrom, setLines, setReason]);
  useEffect(()=>{
    if(!editingDocument)return;
    setFrom(editingDocument.warehouseId??"");
    setTo(editingDocument.destinationWarehouseId??"");
    setReason(editingDocument.title??"");
    setLines(editingDocument.lines.filter(line=>line.productId).map(line=>({productId:String(line.productId),quantity:String(line.quantity),piecePrice:"",unitPrice:"",actualQuantity:mode==="adjust"?adjustmentActualQuantity(editingDocument,String(line.productId)):""})));
    setQ("");
  },[editingDocument,mode,setFrom,setLines,setReason,setTo]);
  const resetEditor=()=>{setLines([]);setReason("");setQ("");onCancelEdit?.();if(mode==="adjust")clearPrefill?.()};
  async function submit() {
    const body = mode === "transfer"
      ? {type:editingDocument?"transfer.update":"transfer.post",...(editingDocument?{documentId:editingDocument.id}:{}),fromWarehouseId:from,toWarehouseId:to,lines:lines.map(l=>({productId:l.productId,quantity:val(l.quantity)}))}
      : {type:editingDocument?"adjustment.update":"adjustment.post",...(editingDocument?{documentId:editingDocument.id}:{}),warehouseId:from,reason,lines:lines.map(l=>({productId:l.productId,actualQuantity:val(l.actualQuantity)}))};
    const id=await run(body,mode==="transfer"?tr("تم التحويل بين المخازن"):tr("تم تسجيل تصحيح المخزون"),resetEditor);
    openDoc(id);
  }
  const invalidAdjustment = mode === "adjust" && lines.some(line => {
    const product = data.products.find(item => item.id === line.productId);
    const hasWarehouseFootprint = Boolean(product && from && (Object.prototype.hasOwnProperty.call(product.stocks ?? {}, from) || data.movements.some(movement => movement.productId === product.id && movement.warehouseId === from)));
    return line.actualQuantity === "" || !hasWarehouseFootprint;
  });
  const lockedAdjustmentProducts=mode==="adjust"&&Boolean(editingDocument);
  return <div className="form-stack stock-operation-panel">
      <div className="form-row"><label>{mode === "transfer" ? tr("من") : tr("المخزن")}<SearchableSelect value={from} onChange={setFrom} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={activeWarehouses(data.warehouses).map(w => ({ value: w.id, label: w.name }))} /></label>{mode === "transfer" && <label>{tr("إلى")}<SearchableSelect value={to} onChange={setTo} placeholder={tr("اختر الوجهة")} searchPlaceholder={tr("ابحث عن مخزن الوجهة")} options={activeWarehouses(data.warehouses).filter(w => w.id !== from).map(w => ({ value: w.id, label: w.name }))} /></label>}</div>
      {!lockedAdjustmentProducts&&<SearchProducts data={data} query={q} setQuery={setQ} mode={mode === "adjust" ? "adjustment" : "transfer"} warehouseId={from} stockScope="selected-warehouse" collapseResultsWhenIdle onPick={(p) => {setLines(x => x.some(l => l.productId === p.id) ? x : [...x, mode === "adjust" ? { ...lineFor(p), unitPrice: "" } : lineFor(p)]);setQ("")}} />}
      <StockDraftTable mode={mode} lines={lines} products={data.products} warehouseId={from} lockedProducts={lockedAdjustmentProducts} onChange={(line) => setLines(current => current.map(item => item.productId === line.productId ? line : item))} onRemove={(productId) => setLines(current => current.filter(item => item.productId !== productId))} />
      {mode === "adjust" && <label>{tr("سبب التصحيح")}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("مثال: نتيجة الجرد الفعلي")} /></label>}
      <div className="dialog-actions stock-operation-actions"><button className="primary stock-primary-action" disabled={!from || (mode === "transfer" && !to) || !lines.length || (mode === "adjust" && (!reason.trim() || invalidAdjustment))} onClick={() => void submit()}>{editingDocument?tr("حفظ التعديل"):mode === "transfer" ? tr("اعتماد التحويل") : tr("اعتماد التصحيح")}</button>{editingDocument&&<button type="button" className="soft" onClick={resetEditor}>{tr("إلغاء التعديل")}</button>}</div>
    </div>;
}
function Transfer(p: {data: BootstrapData;run: RunCommand;openDoc: (id: string) => void;}) {
  const confirmAction=useAppConfirm(),[editing,setEditing]=useState<DocumentRecord|null>(null);
  const canEdit=canUseCapability(p.data.principal,"warehouses.transfer.edit"),canDelete=canUseCapability(p.data.principal,"warehouses.transfer.delete");
  const transfers = p.data.documents.filter(document => document.kind === "transfer");
  const remove=async(document:DocumentRecord)=>{if(!await confirmAction({message:`هل تريد حذف تحويل المخزون رقم ${displayDocumentNumber(document)}؟\nسيتم عكس أثره على المخزنين إذا كان المخزون المحول ما زال متاحًا.`,confirmLabel:tr("حذف"),tone:"danger"}))return;await p.run({type:"transfer.void",documentId:document.id},"تم إلغاء تحويل المخزون",()=>{if(editing?.id===document.id)setEditing(null)})};
  const transferColumns=useMemo(()=>[{key:"date",type:"date" as const,get:(d:DocumentRecord)=>d.occurredAt},{key:"number",type:"number" as const,get:(d:DocumentRecord)=>d.sequence??d.number},{key:"from",type:"text" as const,get:(d:DocumentRecord)=>d.warehouseName},{key:"to",type:"text" as const,get:(d:DocumentRecord)=>d.destinationWarehouseName},{key:"quantity",type:"number" as const,get:(d:DocumentRecord)=>d.lines.reduce((sum,line)=>sum+Number(line.quantity),0)}],[]),{sort:transferSort,sortedRows:sortedTransfers,toggle:toggleTransferSort}=useSortableRows(transfers,transferColumns);
  return <section className="stock-workspace">
      <FramedSection title={editing?`${tr("تعديل")} · ${tr("تحويل بين المخازن")}`:tr("تحويل بين المخازن")} className="stock-workspace-main" allowOverflow><MultiStockForm {...p} mode="transfer" editingDocument={editing} onCancelEdit={()=>setEditing(null)}/></FramedSection>
      <FramedSection title={tr("سجل التحويلات")} className="records transfer-history"><div className="erp-table-wrap transfer-list"><table className="erp-table" aria-label={tr("سجل التحويلات")}><colgroup><col style={{width:"16%"}}/><col style={{width:"18%"}}/><col style={{width:"17%"}}/><col style={{width:"17%"}}/><col style={{width:"12%"}}/><col style={{width:"20%"}}/></colgroup><thead><tr><SortableTableHeader column="date" label={tr("التاريخ")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="number" label={tr("المستند")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="from" label={tr("من")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="to" label={tr("إلى")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="quantity" label={tr("الكمية")} sort={transferSort} toggle={toggleTransferSort}/><th>{tr("إجراءات")}</th></tr></thead><tbody>{sortedTransfers.map(document => <tr key={document.id} onClick={() => p.openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td dir="ltr">{displayDocumentNumber(document)}</td><td>{document.warehouseName ?? "—"}</td><td>{document.destinationWarehouseName ?? "—"}</td><td className="num-cell">{number(document.lines.reduce((sum, line) => sum + Number(line.quantity), 0))}</td><td className="action-cell"><LifecycleActions onEdit={canEdit?()=>setEditing(document):undefined} onVoid={canDelete?()=>void remove(document):undefined}/></td></tr>)}{!transfers.length && <tr><td colSpan={6}>{tr("لا توجد تحويلات مسجلة")}</td></tr>}</tbody></table></div></FramedSection>
    </section>;
}
function Adjustment(p: {data: BootstrapData;run: RunCommand;openDoc: (id: string) => void;prefill?: AdjustmentPrefill | null;clearPrefill?: () => void;}) {
  const confirmAction=useAppConfirm(),[editing,setEditing]=useState<DocumentRecord|null>(null);
  const canEdit=canUseCapability(p.data.principal,"warehouses.adjust.edit"),canDelete=canUseCapability(p.data.principal,"warehouses.adjust.delete");
  const openingDocs = p.data.documents.filter(document => isOpeningStockDocument(document));
  const adjustmentDocs = p.data.documents.filter(document => document.kind === "adjustment" && !isOpeningStockDocument(document));
  const remove=async(document:DocumentRecord)=>{if(!await confirmAction({message:`هل تريد حذف تصحيح المخزون رقم ${displayDocumentNumber(document)}؟\nسيتم عكس أثر التصحيح إذا كان المخزون الناتج عنه ما زال متاحًا.`,confirmLabel:tr("حذف"),tone:"danger"}))return;await p.run({type:"adjustment.void",documentId:document.id},"تم إلغاء تصحيح المخزون",()=>{if(editing?.id===document.id)setEditing(null)})};
  return <section className="stock-workspace adjustment-workspace">
      <FramedSection title={editing?`${tr("تعديل")} · ${tr("تصحيح المخزون")}`:tr("تصحيح المخزون")} className="stock-workspace-main" allowOverflow><MultiStockForm {...p} mode="adjust" editingDocument={editing} onCancelEdit={()=>setEditing(null)}/></FramedSection>
      <Recent title={tr("سجل التصحيحات")} docs={adjustmentDocs} openDoc={p.openDoc} actions={document=><LifecycleActions onEdit={canEdit?()=>setEditing(document):undefined} onVoid={canDelete?()=>void remove(document):undefined}/>}/>
      <OpeningStockHistory data={p.data} docs={openingDocs} openDoc={p.openDoc} />
    </section>;
}'''
replace_between("function StockDraftTable(", "function Records({", stock_block)

must_replace(
'''function Banks({ data, run, openDoc, tab }: { data: BootstrapData; run: RunCommand; openDoc:(id:string)=>void; tab:BankTab }) {
  const [editing,setEditing]=useState<PaymentAccount|null>(null),[detail,setDetail]=useState<FinancialDetail|null>(null),[showArchived,setShowArchived]=useState(false);''',
'''function Banks({ data, run, openDoc, tab }: { data: BootstrapData; run: RunCommand; openDoc:(id:string)=>void; tab:BankTab }) {
  const confirmAction=useAppConfirm();
  const [editing,setEditing]=useState<PaymentAccount|null>(null),[detail,setDetail]=useState<FinancialDetail|null>(null),[showArchived,setShowArchived]=useState(false),[editingTransferId,setEditingTransferId]=useState<string|null>(null),[editingAdjustmentId,setEditingAdjustmentId]=useState<string|null>(null);''')

bank_logic_marker='''  const splitPanel=tab==="transfers"||tab==="adjustment";'''
bank_logic=r'''  const splitPanel=tab==="transfers"||tab==="adjustment";
  const canTransferEdit=canUseCapability(data.principal,"banks.transfer.edit"),canTransferDelete=canUseCapability(data.principal,"banks.transfer.delete"),canAdjustmentEdit=canUseCapability(data.principal,"banks.deposit_withdraw.edit"),canAdjustmentDelete=canUseCapability(data.principal,"banks.deposit_withdraw.delete");
  const activeAccountId=(value:string)=>active.find(account=>account.id===value||account.code===value)?.id??"";
  const resetTransferEditor=()=>{setEditingTransferId(null);setTransferFrom("");setTransferTo("");setAmount("");setNote("")};
  const loadTransfer=(transfer:BootstrapData["accountTransfers"][number])=>{setEditingTransferId(transfer.documentId??transfer.id);setTransferFrom(activeAccountId(transfer.fromAccountId));setTransferTo(activeAccountId(transfer.toAccountId));setAmount(String(transfer.amount));setNote(transfer.note??"")};
  const saveTransfer=async()=>{await run({type:editingTransferId?"account-transfer.update":"account-transfer.post",...(editingTransferId?{documentId:editingTransferId}:{}),fromAccountId:transferFrom,toAccountId:transferTo,amount:val(amount),note},tr("تم التحويل بين الحسابات"),resetTransferEditor)};
  const removeTransfer=async(transfer:BootstrapData["accountTransfers"][number])=>{const id=transfer.documentId??transfer.id;if(!await confirmAction({message:`هل تريد حذف التحويل رقم ${transfer.number}؟\nسيتم عكس طرفي التحويل مع الاحتفاظ بسجل التدقيق.`,confirmLabel:tr("حذف"),tone:"danger"}))return;await run({type:"account-transfer.void",documentId:id},"تم إلغاء التحويل البنكي",()=>{if(editingTransferId===id)resetTransferEditor()})};
  const resetAdjustmentEditor=()=>{setEditingAdjustmentId(null);setAdjustmentAccount("");setAdjustmentDirection("deposit");setAdjustmentAmount("");setAdjustmentNote("")};
  const loadAdjustment=(movement:BootstrapData["financialMovements"][number])=>{setEditingAdjustmentId(movement.documentId);setAdjustmentAccount(activeAccountId(movement.paymentMethod));setAdjustmentDirection(movement.type==="manual-withdrawal"?"withdrawal":"deposit");setAdjustmentAmount(String(movement.amount));setAdjustmentNote(movement.note??"")};
  const saveAdjustment=async()=>{await run({type:editingAdjustmentId?"account-adjustment.update":"account-adjustment.post",...(editingAdjustmentId?{documentId:editingAdjustmentId}:{}),accountId:adjustmentAccount,direction:adjustmentDirection,amount:val(adjustmentAmount),note:adjustmentNote},adjustmentDirection==="deposit"?tr("تم الإيداع"):tr("تم السحب"),resetAdjustmentEditor)};
  const removeAdjustment=async(movement:BootstrapData["financialMovements"][number])=>{if(!await confirmAction({message:`هل تريد حذف عملية ${movementLabels[movement.type]??movement.type} رقم ${movement.documentNumber}؟\nسيتم عكس أثرها على الحساب مع الاحتفاظ بسجل التدقيق.`,confirmLabel:tr("حذف"),tone:"danger"}))return;await run({type:"account-adjustment.void",documentId:movement.documentId},"تم إلغاء العملية المالية",()=>{if(editingAdjustmentId===movement.documentId)resetAdjustmentEditor()})};'''
must_replace(bank_logic_marker,bank_logic)

transfer_tab = r'''  {tab==="transfers"&&<div className="bank-tab-content bank-tab-transfers"><FramedSection title={editingTransferId?`${tr("تعديل")} · ${tr("تحويل جديد")}`:tr("تحويل جديد")} className="bank-operation"><form className="transfer-form bank-operation-form" onSubmit={async e=>{e.preventDefault();await saveTransfer()}}><div className="bank-operation-row transfer-account-row"><label>{tr("من الحساب")}<PaymentAccountSelect required accounts={active} value={transferFrom} onChange={setTransferFrom} placeholder={tr("اختر المصدر")}/></label><label>{tr("إلى الحساب")}<PaymentAccountSelect required accounts={active} value={transferTo} onChange={setTransferTo} placeholder={tr("اختر الوجهة")}/></label></div><div className="bank-operation-row transfer-detail-row"><label>{tr("المبلغ")}<Num value={amount} onChange={setAmount}/></label><label>{tr("ملاحظة")}<input value={note} onChange={e=>setNote(e.target.value)}/></label><div className="party-row-actions"><button className="primary" disabled={!transferFrom||!transferTo||transferFrom===transferTo||!Number.isFinite(val(amount))||val(amount)<=0}>{editingTransferId?tr("حفظ التعديل"):tr("اعتماد التحويل")}</button>{editingTransferId&&<button type="button" className="soft" onClick={resetTransferEditor}>{tr("إلغاء التعديل")}</button>}</div></div></form></FramedSection><FramedSection title={tr("سجل التحويلات")} className="bank-history"><div className="bank-history-filter-stack"><div className="bank-history-date-row"><div className="bank-scope-controls"><CompactDateRange from={transferScope.draftFrom} to={transferScope.draftTo} allTime={transferScope.period===null&&!transferFromFilter&&!transferToFilter} onApply={transferScope.commit} onAllTime={resetTransferFilters} onFromChange={transferScope.setDraftFrom} onToChange={transferScope.setDraftTo}/></div></div><div className="bank-history-select-row"><PaymentAccountSelect accounts={data.paymentAccounts} value={transferFromFilter} onChange={setTransferFromFilter} placeholder={tr("كل المرسلين")}/><PaymentAccountSelect accounts={data.paymentAccounts} value={transferToFilter} onChange={setTransferToFilter} placeholder={tr("كل المستلمين")}/></div></div><div className="erp-table-wrap transfer-list"><table className="erp-table bank-transfer-table"><colgroup><col style={{width:"18%"}}/><col style={{width:"16%"}}/><col style={{width:"16%"}}/><col style={{width:"14%"}}/><col style={{width:"18%"}}/><col style={{width:"18%"}}/></colgroup><thead><tr><SortableTableHeader column="date" label={tr("التاريخ")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="from" label={tr("من")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="to" label={tr("إلى")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="amount" label={tr("المبلغ")} sort={transferSort} toggle={toggleTransferSort}/><SortableTableHeader column="reference" label={tr("المرجع")} sort={transferSort} toggle={toggleTransferSort}/><th>{tr("إجراءات")}</th></tr></thead><tbody>{sortedTransfers.map(t=><tr key={t.id} onClick={()=>setDetail({type:tr("تحويل"),occurredAt:t.occurredAt,amount:t.amount,reference:t.number,note:t.note,from:name(t.fromAccountId),to:name(t.toAccountId)})}><td>{formatDateTime(t.occurredAt)}</td><td>{name(t.fromAccountId)}</td><td>{name(t.toAccountId)}</td><td className="num-cell bank-amount-neutral"><MoneyValue value={t.amount}/></td><td dir="ltr">{t.number}</td><td className="action-cell"><LifecycleActions onEdit={canTransferEdit?()=>loadTransfer(t):undefined} onVoid={canTransferDelete?()=>void removeTransfer(t):undefined}/></td></tr>)}</tbody></table></div></FramedSection></div>}'''
replace_between('  {tab==="transfers"&&<div className="bank-tab-content bank-tab-transfers">','  {tab==="adjustment"&&<div className="bank-tab-content bank-tab-adjustment">',transfer_tab)

adjustment_tab = r'''  {tab==="adjustment"&&<div className="bank-tab-content bank-tab-adjustment"><FramedSection title={editingAdjustmentId?`${tr("تعديل")} · ${tr("عملية سحب أو إيداع")}`:tr("عملية سحب أو إيداع")} className="bank-operation"><form className="bank-adjustment-form bank-operation-form" onSubmit={async e=>{e.preventDefault();await saveAdjustment()}}><div className="bank-operation-row adjustment-account-row"><div className="bank-adjustment-direction"><button type="button" className="selection-option deposit-option" aria-pressed={adjustmentDirection==="deposit"} onClick={()=>setAdjustmentDirection("deposit")}>{tr("إيداع")}</button><button type="button" className="selection-option withdrawal-option" aria-pressed={adjustmentDirection==="withdrawal"} onClick={()=>setAdjustmentDirection("withdrawal")}>{tr("سحب")}</button></div><label>{tr("الحساب")}<PaymentAccountSelect required accounts={active} value={adjustmentAccount} onChange={setAdjustmentAccount} placeholder={tr("اختر الحساب")}/></label></div><div className="bank-operation-row adjustment-detail-row"><label>{tr("المبلغ")}<Num value={adjustmentAmount} onChange={setAdjustmentAmount}/></label><label>{tr("ملاحظة")}<input value={adjustmentNote} onChange={e=>setAdjustmentNote(e.target.value)}/></label><div className="party-row-actions"><button className="primary" disabled={!adjustmentAccount||!Number.isFinite(val(adjustmentAmount))||val(adjustmentAmount)<=0}>{editingAdjustmentId?tr("حفظ التعديل"):tr("اعتماد العملية")}</button>{editingAdjustmentId&&<button type="button" className="soft" onClick={resetAdjustmentEditor}>{tr("إلغاء التعديل")}</button>}</div></div></form></FramedSection><FramedSection title={tr("سجل السحب والإيداع")} className="bank-history"><div className="bank-history-filter-stack"><div className="bank-history-date-row"><div className="bank-scope-controls"><CompactDateRange from={adjustmentScope.draftFrom} to={adjustmentScope.draftTo} allTime={adjustmentScope.period===null&&!adjustmentFilter&&!adjustmentType} onApply={adjustmentScope.commit} onAllTime={resetAdjustmentFilters} onFromChange={adjustmentScope.setDraftFrom} onToChange={adjustmentScope.setDraftTo}/></div></div><div className="bank-history-select-row"><PaymentAccountSelect accounts={data.paymentAccounts} value={adjustmentFilter} onChange={setAdjustmentFilter} placeholder={tr("كل الحسابات")}/><select value={adjustmentType} onChange={e=>setAdjustmentType(e.target.value)}><option value="">{tr("إيداع وسحب")}</option><option value="manual-deposit">{tr("إيداع")}</option><option value="manual-withdrawal">{tr("سحب")}</option></select></div></div><div className="erp-table-wrap adjustment-list"><table className="erp-table"><thead><tr><SortableTableHeader column="document" label={tr("المرجع")} sort={adjustmentSort} toggle={toggleAdjustmentSort}/><SortableTableHeader column="date" label={tr("التاريخ")} sort={adjustmentSort} toggle={toggleAdjustmentSort}/><SortableTableHeader column="account" label={tr("الحساب")} sort={adjustmentSort} toggle={toggleAdjustmentSort}/><SortableTableHeader column="type" label={tr("النوع")} sort={adjustmentSort} toggle={toggleAdjustmentSort}/><SortableTableHeader column="amount" label={tr("المبلغ")} sort={adjustmentSort} toggle={toggleAdjustmentSort}/><th>{tr("الملاحظة")}</th><th>{tr("إجراءات")}</th></tr></thead><tbody>{sortedAdjustments.map(m=><tr key={m.id} onClick={()=>inspectMovement(m)}><td dir="ltr">{m.documentNumber}</td><td>{formatDateTime(m.occurredAt)}</td><td>{name(m.paymentMethod)}</td><td>{movementLabels[m.type]}</td><td className={`num-cell ${m.direction==="in"?"bank-amount-positive":"bank-amount-negative"}`}><MoneyValue value={m.amount} tone={m.direction==="in"?"positive":"negative"}/></td><td>{m.note||"—"}</td><td className="action-cell"><LifecycleActions onEdit={canAdjustmentEdit?()=>loadAdjustment(m):undefined} onVoid={canAdjustmentDelete?()=>void removeAdjustment(m):undefined}/></td></tr>)}</tbody></table></div></FramedSection></div>}'''
replace_between('  {tab==="adjustment"&&<div className="bank-tab-content bank-tab-adjustment">','  </div></FramedSection>{showArchived&&',adjustment_tab)

product_panel = r'''function ProductMovementPanel({ product, selectedWarehouseId, data, filter, setFilter, close, openDoc, from, to }: { product: Product; selectedWarehouseId: string; data: BootstrapData; filter: string; setFilter: (value: string) => void; close: () => void; openDoc: (id: string) => void; from:string;to:string }) {
  const activeIds=new Set(activeWarehouses(data.warehouses).map(warehouse=>warehouse.id)),allSelected=selectedWarehouseId===ALL_WAREHOUSES;
  const relevantWarehouse=(document:DocumentRecord)=>allSelected?(!!document.warehouseId&&activeIds.has(document.warehouseId)):(document.warehouseId===selectedWarehouseId||document.destinationWarehouseId===selectedWarehouseId);
  const docs = data.documents.filter(document => relevantWarehouse(document) && document.status === "posted" && (!from||document.occurredAt.slice(0,10)>=from)&&(!to||document.occurredAt.slice(0,10)<=to) && document.lines.some(line => line.productId === product.id));
  const selectedQty = allSelected?[...activeIds].reduce((sum,id)=>sum+stockInWarehouse(product,id),0):stockInWarehouse(product, selectedWarehouseId), current = selectedQty;
  const selectedWarehouse = data.warehouses.find(warehouse => warehouse.id === selectedWarehouseId),scopeLabel=allSelected?tr("كل المخازن"):selectedWarehouse?.name??tr("المخزن");
  const filteredMovementDocs = docs.filter(document => filter === "all" || document.kind === filter);
  const labels: Record<string, string> = { purchase: tr("شراء"), sale: tr("بيع"), transfer: tr("تحويل"), adjustment: tr("تصحيح"), return: tr("حركة تاريخية"), opening: tr("رصيد افتتاحي") };
  const operationLabel = (document: DocumentRecord) => isOpeningStockCorrectionDocument(document) ? tr("تصحيح رصيد البداية") : isOpeningStockDocument(document) ? tr("رصيد بداية") : labels[document.kind] ?? document.kind;
  const party = (document: DocumentRecord) => (document.partyId?data.parties.find(p => p.id === document.partyId)?.name:null) || document.partyName || (document.kind === "sale" ? tr("بيع مباشر") : tr("شراء مباشر"));
  const movementColumns=useMemo(()=>[{key:"date",type:"date" as const,get:(d:DocumentRecord)=>d.occurredAt},{key:"kind",type:"text" as const,get:(d:DocumentRecord)=>operationLabel(d)},{key:"party",type:"text" as const,get:(d:DocumentRecord)=>d.partyName??d.warehouseName},{key:"quantity",type:"number" as const,get:(d:DocumentRecord)=>documentProductQuantityEffect(d,product.id,selectedWarehouseId,allSelected)},{key:"price",type:"money" as const,get:(d:DocumentRecord)=>d.lines.find(line=>line.productId===product.id)?.unitPrice},{key:"number",type:"number" as const,get:(d:DocumentRecord)=>d.sequence??d.number}], [allSelected,product.id,selectedWarehouseId]),{sort:movementSort,sortedRows:movementDocs,toggle:toggleMovementSort}=useSortableRows(filteredMovementDocs,movementColumns);
  return <FramedSection title={tr("تفاصيل المنتج وحركته")} className="product-movement-panel"><div className="movement-product-head"><strong>{product.name}</strong><button className="soft" onClick={()=>window.print()}><Printer/>  {tr("طباعة")}</button><button className="icon" aria-label={tr("إغلاق التفاصيل")} onClick={close}><X /></button></div><div className="movement-summary"><span><small>{tr("الكمية في")} {scopeLabel}</small><b>{number(selectedQty)}</b></span><span><small>{tr("إجمالي الكمية")}</small><b>{number(current)}</b></span><span><small>{tr("تكلفة الوحدة")}</small><b>{money(inventoryUnitCost(product))}</b></span><span><small>{tr("القيمة في")} {scopeLabel}</small><b>{money(selectedQty * inventoryUnitCost(product))}</b></span></div><div className="movement-filters">{[["all",tr("الكل")],["purchase",tr("شراء")],["sale",tr("بيع")],["transfer",tr("تحويل")],["adjustment",tr("تصحيح")]].map(([id,label]) => <button key={id} className="choice selection-option" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="erp-table-wrap movement-timeline"><table className="erp-table" aria-label={tr("سجل حركة المنتج")}><colgroup><col style={{width:"17%"}}/><col style={{width:"13%"}}/><col style={{width:"27%"}}/><col style={{width:"13%"}}/><col style={{width:"14%"}}/><col style={{width:"16%"}}/></colgroup><thead><tr><SortableTableHeader column="date" label={tr("التاريخ")} sort={movementSort} toggle={toggleMovementSort}/><SortableTableHeader column="kind" label={tr("العملية")} sort={movementSort} toggle={toggleMovementSort}/><SortableTableHeader column="party" label={tr("الطرف / المخزن")} sort={movementSort} toggle={toggleMovementSort}/><SortableTableHeader column="quantity" label={tr("الكمية")} sort={movementSort} toggle={toggleMovementSort}/><SortableTableHeader column="price" label={tr("السعر")} sort={movementSort} toggle={toggleMovementSort}/><SortableTableHeader column="number" label={tr("المستند")} sort={movementSort} toggle={toggleMovementSort}/></tr></thead><tbody>{movementDocs.map(document => {const line=document.lines.find(item=>item.productId===product.id)!;const quantityEffect=documentProductQuantityEffect(document,product.id,selectedWarehouseId,allSelected),before=Number(line.balanceBefore),after=Number(line.balanceAfter),hasBalances=Number.isFinite(before)&&Number.isFinite(after);const details=document.kind==="purchase"||document.kind==="sale"?party(document):document.kind==="transfer"?`${document.warehouseName??"—"} ← ${document.destinationWarehouseName??"—"}`:`${document.warehouseName??"—"}${hasBalances?` · ${number(before)} ← ${number(after)}`:""} · ${document.title??tr("بدون سبب")}`;return <tr key={document.id} onClick={() => openDoc(document.id)}><td>{formatDate(document.occurredAt)}</td><td>{operationLabel(document)}</td><td title={details}>{details}</td><td className="num-cell">{number(quantityEffect)}</td><td className="num-cell">{document.kind === "purchase" || document.kind === "sale" ? money(line.unitPrice) : "—"}</td><td dir="ltr">{displayDocumentNumber(document)}</td></tr>})}{!movementDocs.length && <tr><td colSpan={6}>{tr("لا توجد حركات فعلية ضمن هذا الفلتر")}</td></tr>}</tbody></table></div></FramedSection>;
}'''
replace_between("function ProductMovementPanel(", "function Products(", product_panel)

path.write_text(text, encoding="utf-8")
print("transaction lifecycle UI patch applied")
