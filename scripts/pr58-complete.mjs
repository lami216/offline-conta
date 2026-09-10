import { readFileSync, writeFileSync } from "node:fs";

function read(path) { return readFileSync(path, "utf8"); }
function write(path, value) { writeFileSync(path, value); }
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}
function replaceRegex(source, regex, to, label) {
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`Expected one regex match for ${label}, found ${matches.length}`);
  return source.replace(regex, to);
}

// Opening provenance: distinguish native openings from imported snapshots and preserve
// existing allocations unless the user explicitly changes the opening warehouse.
{
  const path = "lib/opening-stock.ts";
  let s = read(path);
  s = replaceOnce(s,
`  warehouseId: string | null;\n  cost: number | null;\n};`,
`  warehouseId: string | null;\n  cost: number | null;\n  hasNativeOpening: boolean;\n  hasStockHistory: boolean;\n  legacySnapshot: boolean;\n};`, "opening state flags");
  s = replaceOnce(s,
`  if (!productId) return { total: 0, remaining: 0, consumed: 0, allocations: {}, warehouseId: null, cost: null };\n  const movements = await db.collection("stockMovements").find({ productId }, { session }).sort({ occurredAt: 1 }).toArray();`,
`  if (!productId) return { total: 0, remaining: 0, consumed: 0, allocations: {}, warehouseId: null, cost: null, hasNativeOpening: false, hasStockHistory: false, legacySnapshot: false };\n  const movements = await db.collection("stockMovements").find({ productId }, { session }).sort({ occurredAt: 1 }).toArray();\n  const hasNativeOpening = movements.some(movement => movement.type === "opening" || movement.type === "opening-correction");\n  const hasStockHistory = movements.length > 0;\n  const legacySnapshot = movements.some(movement => movement.type === "legacy-opening") || positive(product.legacyOpeningCost) !== null;`, "opening history flags");
  s = replaceOnce(s,
`  if (metadataTotal !== null && metadataTotal >= 0 && movements.some(movement => movement.type === "opening-correction")) total = metadataTotal;`,
`  if (metadataTotal !== null && metadataTotal >= 0 && hasNativeOpening) total = metadataTotal;`, "metadata opening total");
  s = replaceOnce(s,
`  return { total, remaining, consumed, allocations, warehouseId, cost };\n}\n\nexport function planOpeningStockCorrection(state: OpeningStockState, desiredTotal: number, targetWarehouseId: string | null) {\n  if (!Number.isInteger(desiredTotal) || desiredTotal < 0) throw new Error("رصيد البداية غير صالح");\n  if (desiredTotal < state.consumed) throw new Error(\`لا يمكن خفض رصيد البداية عن \${state.consumed} لأن هذه الكمية تم التصرف بها سابقًا\`);\n  const desiredRemaining = desiredTotal - state.consumed;\n  if (desiredRemaining > 0 && !targetWarehouseId) throw new Error("مخزن رصيد البداية مطلوب");\n  const desiredAllocations: Record<string, number> = {};\n  if (desiredRemaining > 0 && targetWarehouseId) desiredAllocations[targetWarehouseId] = desiredRemaining;\n  const warehouses = new Set([...Object.keys(state.allocations), ...Object.keys(desiredAllocations)]);\n  const deltas = [...warehouses].map(warehouseId => ({\n    warehouseId,\n    delta: Number(desiredAllocations[warehouseId] ?? 0) - Number(state.allocations[warehouseId] ?? 0),\n  })).filter(item => item.delta !== 0);\n  return { desiredRemaining, desiredAllocations, deltas };\n}`,
`  return { total, remaining, consumed, allocations, warehouseId, cost, hasNativeOpening, hasStockHistory, legacySnapshot };\n}\n\nexport function planOpeningStockCorrection(state: OpeningStockState, desiredTotal: number, targetWarehouseId: string | null, relocateRemaining = false) {\n  if (!Number.isInteger(desiredTotal) || desiredTotal < 0) throw new Error("رصيد البداية غير صالح");\n  if (desiredTotal < state.consumed) throw new Error(\`لا يمكن خفض رصيد البداية عن \${state.consumed} لأن هذه الكمية تم التصرف بها سابقًا\`);\n  const desiredRemaining = desiredTotal - state.consumed;\n  const fallbackWarehouseId = targetWarehouseId ?? state.warehouseId ?? Object.keys(state.allocations).sort()[0] ?? null;\n  if (desiredRemaining > 0 && !fallbackWarehouseId) throw new Error("مخزن رصيد البداية مطلوب");\n  const desiredAllocations: Record<string, number> = {};\n  if (relocateRemaining) {\n    if (desiredRemaining > 0 && fallbackWarehouseId) desiredAllocations[fallbackWarehouseId] = desiredRemaining;\n  } else {\n    for (const [warehouseId, quantity] of Object.entries(state.allocations)) if (quantity > 0) desiredAllocations[warehouseId] = quantity;\n    const change = desiredRemaining - state.remaining;\n    if (change > 0 && fallbackWarehouseId) desiredAllocations[fallbackWarehouseId] = Number(desiredAllocations[fallbackWarehouseId] ?? 0) + change;\n    if (change < 0) {\n      let reduction = -change;\n      const order = [...new Set([fallbackWarehouseId, ...Object.keys(desiredAllocations).sort()].filter((value): value is string => Boolean(value)))];\n      for (const warehouseId of order) {\n        if (reduction <= 0) break;\n        const available = Number(desiredAllocations[warehouseId] ?? 0);\n        const removed = Math.min(available, reduction);\n        desiredAllocations[warehouseId] = available - removed;\n        reduction -= removed;\n      }\n      if (reduction > 1e-9) throw new Error("تعذر مطابقة رصيد البداية مع سجل الحركات");\n    }\n    for (const warehouseId of Object.keys(desiredAllocations)) if (desiredAllocations[warehouseId] <= 0) delete desiredAllocations[warehouseId];\n  }\n  const warehouseIds = new Set([...Object.keys(state.allocations), ...Object.keys(desiredAllocations)]);\n  const deltas = [...warehouseIds].map(warehouseId => ({ warehouseId, delta: Number(desiredAllocations[warehouseId] ?? 0) - Number(state.allocations[warehouseId] ?? 0) })).filter(item => item.delta !== 0);\n  return { desiredRemaining, desiredAllocations, deltas };\n}`,
  "opening correction planner");
  write(path, s);
}

// Product-opening endpoint: surface enough context to render a historical/archived source warehouse.
{
  const path = "app/api/product-opening/route.ts";
  let s = read(path);
  s = replaceOnce(s,
`  const state = await deriveOpeningStockState(db, undefined, product);\n  return Response.json(state);`,
`  const state = await deriveOpeningStockState(db, undefined, product);\n  const warehouse = state.warehouseId ? await db.collection("warehouses").findOne({ _id: state.warehouseId }) : null;\n  return Response.json({ ...state, warehouseName: warehouse?.name ?? null });`, "opening endpoint warehouse name");
  write(path, s);
}

// Command safety: no historical legacy snapshot invention; explicit relocation; prevent
// retroactive native openings after real history; protect opening stock on create too.
{
  const path = "app/api/command/route.ts";
  let s = read(path);
  s = replaceOnce(s,
`  const product = await db.collection("products").findOne({ id: productId }, { session });\n  const legacy = Number(product?.legacyOpeningCost);\n  return Number.isFinite(legacy) && legacy > 0 ? legacy : null;`,
`  return null;`, "historical legacy cost removal");
  s = replaceOnce(s,
`    const state = await deriveOpeningStockState(db, session, product);\n    const openingStock = optionalNumber(body.openingStock,"رصيد البداية") ?? 0;`,
`    const state = await deriveOpeningStockState(db, session, product);\n    const openingStock = optionalNumber(body.openingStock,"رصيد البداية") ?? 0;\n    if (!state.hasNativeOpening && state.hasStockHistory && openingStock > 0) throw new CommandError("لا يمكن إنشاء رصيد بداية رجعي بعد وجود حركات مخزون. استخدم تصحيح المخزون بدلًا من ذلك.", 409);`, "retroactive opening guard");
  s = replaceOnce(s,
`    let plan;\n    try { plan = planOpeningStockCorrection(state, openingStock, targetWarehouse?._id ?? null); }`,
`    const relocateOpeningStock = body.relocateOpeningStock === true;\n    let plan;\n    try { plan = planOpeningStockCorrection(state, openingStock, targetWarehouse?._id ?? openingWarehouseId ?? null, relocateOpeningStock); }`, "explicit opening relocation");
  s = replaceOnce(s,
`    const warehouseChanged = Boolean(openingStock > state.consumed && openingWarehouseId !== state.warehouseId);`,
`    const warehouseChanged = Boolean(relocateOpeningStock && openingStock > state.consumed && openingWarehouseId !== state.warehouseId);`, "warehouse changed flag");
  s = replaceOnce(s,
`        const warehouse = item.delta > 0 ? targetWarehouse : await warehouses(db).findOne({ _id: item.warehouseId }, { session });\n        if (!warehouse || String(warehouse._id) !== item.warehouseId) throw new CommandError("تعذر تحديد مخزن رصيد البداية", 409);`,
`        const warehouse = item.delta > 0 ? await warehouses(db).findOne({ _id: item.warehouseId, isArchived: { $ne: true } }, { session }) : await warehouses(db).findOne({ _id: item.warehouseId }, { session });\n        if (!warehouse || String(warehouse._id) !== item.warehouseId) throw new CommandError(item.delta > 0 ? "مخزن رصيد البداية غير متاح" : "تعذر تحديد مخزن رصيد البداية", 409);`, "opening correction warehouse resolution");
  s = replaceOnce(s,
`    if(type==="product.update"&&body.replaceOpeningStock===true){const stockDenied=await requireCapability(request,"warehouses.adjust");if(stockDenied)return stockDenied;}`,
`    if((type==="product.update"&&body.replaceOpeningStock===true)||(type==="product.create"&&Number(body.openingStock??0)>0)){const stockDenied=await requireCapability(request,"warehouses.adjust");if(stockDenied)return stockDenied;}`,
  "opening stock permission guard");
  write(path, s);
}

// Reports: native opening is a valid historical fallback; imported legacy snapshot is not.
// Current inventory/expiry valuation must never fall back to the editable product-card pieceCost.
{
  const path = "lib/reports.ts";
  let s = read(path);
  s = replaceOnce(s,
`type Cost = { unit: number | null; source: "snapshot" | "historical-purchase" | "unknown" };`,
`type Cost = { unit: number | null; source: "snapshot" | "historical-purchase" | "historical-opening" | "unknown" };`, "report cost source");
  s = replaceOnce(s,
`  const [identityRows,parentRows,purchaseRows]=await Promise.all([\n    db.collection("products").find({ id: { $in: productIds } }).project({ id: 1, name: 1, sku: 1 }).toArray(),\n    db.collection("documents").find({id:{$in:parentIds},kind:"sale"}).project({id:1,occurredAt:1}).toArray(),\n    productIds.length?db.collection("documents").find({kind:"purchase",status:"posted","lines.productId":{$in:productIds}}).project({occurredAt:1,lines:1}).sort({occurredAt:1}).toArray():Promise.resolve([]),\n  ]);`,
`  const [identityRows,parentRows,purchaseRows,openingRows]=await Promise.all([\n    db.collection("products").find({ id: { $in: productIds } }).project({ id: 1, name: 1, sku: 1 }).toArray(),\n    db.collection("documents").find({id:{$in:parentIds},kind:"sale"}).project({id:1,occurredAt:1}).toArray(),\n    productIds.length?db.collection("documents").find({kind:"purchase",status:"posted","lines.productId":{$in:productIds}}).project({occurredAt:1,lines:1}).sort({occurredAt:1}).toArray():Promise.resolve([]),\n    productIds.length?db.collection("documents").find({kind:"adjustment",status:"posted","lines.productId":{$in:productIds}}).project({number:1,openingCorrection:1,occurredAt:1,lines:1}).sort({occurredAt:1}).toArray():Promise.resolve([]),\n  ]);`, "report opening query");
  s = replaceOnce(s,
`  const identities = new Map(identityRows.map(product => [String(product.id), product])),parentDates=new Map(parentRows.map(document=>[String(document.id),String(document.occurredAt)])),purchaseHistory=new Map<string,Array<{at:string;unit:number}>>();\n  for(const purchase of purchaseRows)for(const purchaseLine of (purchase.lines??[]) as Document[]){const key=String(purchaseLine.productId);if(!productIds.includes(key)||!Number.isFinite(Number(purchaseLine.unitPrice)))continue;const rows=purchaseHistory.get(key)??[];rows.push({at:String(purchase.occurredAt),unit:n(purchaseLine.unitPrice)});purchaseHistory.set(key,rows)}`,
`  const identities = new Map(identityRows.map(product => [String(product.id), product])),parentDates=new Map(parentRows.map(document=>[String(document.id),String(document.occurredAt)])),purchaseHistory=new Map<string,Array<{at:string;unit:number}>>(),openingHistory=new Map<string,Array<{at:string;unit:number}>>();\n  for(const purchase of purchaseRows)for(const purchaseLine of (purchase.lines??[]) as Document[]){const key=String(purchaseLine.productId);if(!productIds.includes(key)||!Number.isFinite(Number(purchaseLine.unitPrice)))continue;const rows=purchaseHistory.get(key)??[];rows.push({at:String(purchase.occurredAt),unit:n(purchaseLine.unitPrice)});purchaseHistory.set(key,rows)}\n  for(const opening of openingRows){if(!(opening.openingCorrection===true||String(opening.number??"").startsWith("OPEN-")))continue;for(const openingLine of (opening.lines??[]) as Document[]){const key=String(openingLine.productId),unit=Number(openingLine.unitPrice);if(!productIds.includes(key)||!Number.isFinite(unit)||unit<=0)continue;const rows=openingHistory.get(key)??[];rows.push({at:String(opening.occurredAt),unit});openingHistory.set(key,rows)}}`, "report opening history");
  s = replaceOnce(s,
`    const historical=[...(purchaseHistory.get(String(line.productId))??[])].reverse().find(row=>row.at<=costDate);\n    const cost:Cost=line.costAtSale!==null&&line.costAtSale!==undefined&&Number.isFinite(Number(line.costAtSale))?{unit:n(line.costAtSale),source:"snapshot"}:historical?{unit:historical.unit,source:"historical-purchase"}:{unit:null,source:"unknown"};`,
`    const historical=[...(purchaseHistory.get(String(line.productId))??[])].reverse().find(row=>row.at<=costDate),historicalOpening=[...(openingHistory.get(String(line.productId))??[])].reverse().find(row=>row.at<=costDate);\n    const cost:Cost=line.costAtSale!==null&&line.costAtSale!==undefined&&Number.isFinite(Number(line.costAtSale))?{unit:n(line.costAtSale),source:"snapshot"}:historical?{unit:historical.unit,source:"historical-purchase"}:historicalOpening?{unit:historicalOpening.unit,source:"historical-opening"}:{unit:null,source:"unknown"};`, "report historical opening fallback");
  s = replaceOnce(s,
`    const cost = Number.isFinite(product.lastPurchaseCost) ? n(product.lastPurchaseCost) : Number.isFinite(product.pieceCost) ? n(product.pieceCost) : 0;`,
`    const cost = inventoryUnitCost(product);`, "expired inventory cost");
  s = replaceOnce(s,
`    db.collection("products").find().project({stocks:1,lastPurchaseCost:1,pieceCost:1}).toArray(),`,
`    db.collection("products").find().project({stocks:1,lastPurchaseCost:1,openingCost:1,legacyOpeningCost:1}).toArray(),`, "overview inventory projection");
  s = replaceRegex(s,
/inventoryUnitCost\(\{lastPurchaseCost:Number\.isFinite\(product\.lastPurchaseCost\)\?n\(product\.lastPurchaseCost\):null,pieceCost:Number\.isFinite\(product\.pieceCost\)\?n\(product\.pieceCost\):null\}\)/,
`inventoryUnitCost({lastPurchaseCost:Number.isFinite(product.lastPurchaseCost)?n(product.lastPurchaseCost):null,openingCost:Number.isFinite(product.openingCost)?n(product.openingCost):null,legacyOpeningCost:Number.isFinite(product.legacyOpeningCost)?n(product.legacyOpeningCost):null})`, "overview inventory valuation");
  write(path, s);
}

// Product editor: load native opening state from full DB history, edit it as a replacement,
// show consumed/remaining quantity, and only relocate remaining provenance when warehouse changes.
{
  const path = "app/conta-app.tsx";
  let s = read(path);
  s = replaceOnce(s,
`<ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} categories={data.categories} close={() => setFormOpen(false)} />`,
`<ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} categories={data.categories} canAdjustOpening={data.principal.principalType === "owner" || data.principal.permissions.includes("warehouses.adjust")} close={() => setFormOpen(false)} />`, "product form permission prop");
  const productForm = String.raw`type ProductOpeningView = { total:number; remaining:number; consumed:number; allocations:Record<string,number>; warehouseId:string|null; warehouseName?:string|null; cost:number|null; hasNativeOpening:boolean; hasStockHistory:boolean; legacySnapshot:boolean };
function ProductForm({ run, close, product, warehouses, categories, canAdjustOpening }: { run: RunCommand; close: () => void; product: Product | null; warehouses: BootstrapData["warehouses"]; categories: BootstrapData["categories"]; canAdjustOpening:boolean }) {
  const confirmAction=useAppConfirm();
  const defaultWarehouseId=warehouses.find(warehouse=>warehouse.isSalesDefault)?.id??"";
  const [name,setName]=useState(product?.name??""),[cost,setCost]=useState(String(product?.pieceCost??"")),[price,setPrice]=useState(String(product?.piecePrice??"")),[wholesalePrice,setWholesalePrice]=useState(String(product?.wholesalePrice??"")),
    [openingStock,setOpeningStock]=useState(product?String(product.openingStock??""):""),[openingCost,setOpeningCost]=useState(product?String(product.openingCost??""):String(product?.pieceCost??"")),[openingWarehouseId,setOpeningWarehouseId]=useState(product?.openingWarehouseId??defaultWarehouseId),
    [openingState,setOpeningState]=useState<ProductOpeningView|null>(null),[openingLoading,setOpeningLoading]=useState(Boolean(product)),[openingError,setOpeningError]=useState(""),
    [barcode,setBarcode]=useState(product?.barcode??""),[categoryId,setCategoryId]=useState(product?.categoryId??""),[expiryDate,setExpiryDate]=useState(product?.expiryDate??""),[note,setNote]=useState(product?.note??"");
  const barcodeInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(!product){setOpeningLoading(false);return}
    const controller=new AbortController();setOpeningLoading(true);setOpeningError("");
    void fetch("/api/product-opening?productId="+encodeURIComponent(product.id),{signal:controller.signal}).then(readApiResponse).then(value=>{const state=value as ProductOpeningView;setOpeningState(state);setOpeningStock(String(state.total));setOpeningCost(state.cost==null?"":String(state.cost));setOpeningWarehouseId(state.warehouseId??"")}).catch(error=>{if((error as Error).name!=="AbortError")setOpeningError(error instanceof Error?error.message:"تعذر تحميل رصيد البداية")}).finally(()=>{if(!controller.signal.aborted)setOpeningLoading(false)});
    return()=>controller.abort();
  },[product]);
  const historyLocked=Boolean(product&&openingState&&!openingState.hasNativeOpening&&openingState.hasStockHistory),openingEditable=!product||canAdjustOpening&&!historyLocked;
  const desiredOpening=val(openingStock),desiredOpeningCost=openingCost===""?null:val(openingCost),openingWarehouseChanged=Boolean(product&&openingState&&openingWarehouseId!==(openingState.warehouseId??""));
  const openingDirty=Boolean(product&&openingState&&openingEditable&&(desiredOpening!==openingState.total||Number(desiredOpeningCost??0)!==Number(openingState.cost??0)||openingWarehouseChanged));
  const openingInvalid=openingEditable&&desiredOpening>0&&(!openingWarehouseId||!desiredOpeningCost||desiredOpeningCost<=0)||(openingState?desiredOpening<openingState.consumed:false);
  const openingWarehouseOptions=[...(openingState?.warehouseId&&!warehouses.some(warehouse=>warehouse.id===openingState.warehouseId)?[{value:openingState.warehouseId,label:openingState.warehouseName||"مخزن سابق"}]:[]),...warehouses.map(warehouse=>({value:warehouse.id,label:warehouse.name}))];
  return <form className="panel product-form" onSubmit={async event=>{event.preventDefault();const sensitive=Boolean(product&&(name.trim()!==product.name||(cost===""?null:val(cost))!==product.pieceCost||openingDirty));const confirmed=sensitive?await confirmAction({message:tr("product.sensitiveChangeConfirm",{name:product?.name??name})}):true;if(!confirmed)return;
    await run({type:product?"product.update":"product.create",id:product?.id,name,barcode,expiryDate,note,pieceCost:cost,piecePrice:price,wholesalePrice,categoryId,openingStock,openingWarehouseId,...(product?{replaceOpeningStock:openingDirty,relocateOpeningStock:openingDirty&&openingWarehouseChanged,openingCost:desiredOpeningCost}:{}) ,confirmSensitive:confirmed},product?tr("تم تعديل المنتج"):tr("تم إنشاء المنتج"));close()}}>
    <div className="product-form-head"><div><small>{product?tr("بيانات المنتج"):tr("منتج جديد")}</small><h2>{product?tr("تعديل المنتج"):tr("إضافة منتج جديد")}</h2></div><button type="button" className="icon" aria-label={tr("إغلاق")} onClick={close}><X /></button></div>
    <div className="product-form-halves">
      <FramedSection title={tr("المعلومات الأساسية")} className="product-form-group">
        <label>{tr("اسم المنتج")}<input required value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>{tr("الفئة")}<SearchableSelect value={categoryId} onChange={setCategoryId} options={categories.map(category=>({value:category.id,label:category.name}))} placeholder={tr("بدون فئة")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty floating/></label>
        <label className="barcode-field">{tr("الباركود")}<input ref={barcodeInput} dir="ltr" autoComplete="off" value={barcode} onChange={event=>setBarcode(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault()}}/><button type="button" className="soft" onClick={()=>barcodeInput.current?.focus()}>{tr("مسح الباركود")}</button></label>
        <label>{tr("تاريخ انتهاء الصلاحية — اختياري")}<input type="date" dir="ltr" value={expiryDate} onChange={event=>setExpiryDate(event.target.value)}/></label>
        <label>{tr("ملاحظة عن المنتج — اختياري")}<textarea maxLength={1000} rows={2} value={note} onChange={event=>setNote(event.target.value)}/></label>
      </FramedSection>
      <FramedSection title={tr("الأسعار والمخزون")} className="product-form-group">
        <label>{tr("سعر الشراء للفرد")}<Num value={cost} onChange={setCost}/></label><label>{tr("سعر البيع للفرد")}<Num value={price} onChange={setPrice}/></label><label>{tr("سعر البيع بالجملة")}<Num value={wholesalePrice} onChange={setWholesalePrice}/></label>
        <label>{tr("رصيد البداية")}<Num value={openingStock} onChange={value=>{setOpeningStock(value);if(!value||Number(value)<=0)setOpeningWarehouseId("");else if(!openingWarehouseId)setOpeningWarehouseId(defaultWarehouseId)}} /></label>
        {product&&openingLoading&&<small>جاري تحميل رصيد البداية من سجل المخزون الكامل…</small>}
        {product&&openingError&&<small className="error">{openingError} — يمكن تعديل بيانات المنتج، لكن تعديل رصيد البداية متوقف.</small>}
        {product&&openingState&&<small>تم التصرف سابقًا من رصيد البداية: <b>{number(openingState.consumed)}</b> · المتبقي الحالي منه: <b>{number(openingState.remaining)}</b>{desiredOpening>=openingState.consumed&&desiredOpening!==openingState.total?<> · المتبقي بعد التعديل: <b>{number(desiredOpening-openingState.consumed)}</b></>:null}</small>}
        {historyLocked&&<small className="error">هذا المنتج لديه سجل مخزون سابق بدون رصيد بداية أصلي قابل للتعديل. استخدم شاشة تصحيح المخزون حتى لا نعيد كتابة التاريخ.</small>}
        {product&&openingState?.legacySnapshot&&!openingState.hasNativeOpening&&<small>الرصيد المرحل من DataAcc لقطة حالية محفوظة، وليس رصيد بداية أصليًا يمكن نقله رجعيًا.</small>}
        {product&&openingState?.hasNativeOpening&&<label>تكلفة رصيد البداية<Num value={openingCost} onChange={setOpeningCost}/></label>}
        {!product&&desiredOpening>0&&<small>تكلفة رصيد البداية عند الإنشاء هي سعر الشراء للفرد أعلاه.</small>}
        {desiredOpening>0&&<label>{tr("مخزن رصيد البداية")}<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} disabled={!openingEditable||openingLoading} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={openingWarehouseOptions} floating preferUp resultsMaxHeight={126}/></label>}
        {product&&!canAdjustOpening&&<small>تعديل رصيد البداية يحتاج صلاحية تصحيح المخزون. يمكنك تعديل بيانات المنتج والأسعار فقط.</small>}
      </FramedSection>
    </div><div className="product-form-actions"><button type="button" className="soft" onClick={close}>{tr("إلغاء")}</button><button className="primary" disabled={Boolean(product&&openingLoading)||Boolean(openingDirty&&openingInvalid)}>{product?tr("حفظ التعديلات"):tr("حفظ المنتج")}</button></div>
  </form>;
}`;
  s = replaceRegex(s,/function ProductForm\([\s\S]*?\nfunction StockDraftTable\(/,productForm+"\nfunction StockDraftTable(","product form replacement");
  s = replaceOnce(s,`increasing&&product.lastPurchaseCost==null`,`increasing&&inventoryUnitCost(product)<=0`,"adjustment UI accounting cost fallback");
  s = replaceOnce(s,`line.actualQuantity === "" || (val(line.actualQuantity) > before && product?.lastPurchaseCost == null && val(line.unitPrice) <= 0)`,`line.actualQuantity === "" || (val(line.actualQuantity) > before && (!product || inventoryUnitCost(product) <= 0) && val(line.unitPrice) <= 0)`,"adjustment validation accounting cost fallback");
  write(path,s);
}

// Regression suite updates and deeper scenarios.
{
  const path="tests/opening-stock-integrity.test.mjs";
  let s=read(path);
  s=replaceOnce(s,
`const updateOpening = (id, quantity, cost, warehouse) => command({\n  type: "product.update", id, name: "Opened", pieceCost: 999, piecePrice: 100,\n  replaceOpeningStock: true, openingStock: quantity, openingCost: cost, openingWarehouseId: warehouse,\n});`,
`const updateOpening = (id, quantity, cost, warehouse, relocateOpeningStock = false) => command({\n  type: "product.update", id, name: "Opened", pieceCost: 999, piecePrice: 100,\n  replaceOpeningStock: true, relocateOpeningStock, openingStock: quantity, openingCost: cost, openingWarehouseId: warehouse,\n});`,"test update helper relocation");
  s=replaceOnce(s,`await updateOpening(productId, 8, 50, "wh-b");`,`await updateOpening(productId, 8, 50, "wh-b", true);`,"warehouse relocation test");
  s=replaceOnce(s,`await updateOpening(productId, 6, 55, "wh-b");`,`await updateOpening(productId, 6, 55, "wh-b", true);`,"transfer relocation test");
  s=replaceOnce(s,
`  const state = { total: 10, remaining: 7, consumed: 3, allocations: { a: 4, b: 3 }, warehouseId: "a", cost: 50 };\n  assert.deepEqual(planOpeningStockCorrection(state, 8, "b"), { desiredRemaining: 5, desiredAllocations: { b: 5 }, deltas: [{ warehouseId: "a", delta: -4 }, { warehouseId: "b", delta: 2 }] });\n  assert.throws(() => planOpeningStockCorrection(state, 2, "b"), /لا يمكن خفض/);`,
`  const state = { total: 10, remaining: 7, consumed: 3, allocations: { a: 4, b: 3 }, warehouseId: "a", cost: 50, hasNativeOpening: true, hasStockHistory: true, legacySnapshot: false };\n  assert.deepEqual(planOpeningStockCorrection(state, 8, "b"), { desiredRemaining: 5, desiredAllocations: { a: 4, b: 1 }, deltas: [{ warehouseId: "b", delta: -2 }] });\n  assert.deepEqual(planOpeningStockCorrection(state, 8, "b", true), { desiredRemaining: 5, desiredAllocations: { b: 5 }, deltas: [{ warehouseId: "a", delta: -4 }, { warehouseId: "b", delta: 2 }] });\n  assert.throws(() => planOpeningStockCorrection(state, 2, "b"), /لا يمكن خفض/);`,"planner expectations");
  s += `\n\ntest("quantity-only opening edit preserves transferred allocation instead of silently relocating it", async () => {\n  const productId=await createOpened(10,50,"wh-a");\n  await command({type:"transfer.post",fromWarehouseId:"wh-a",toWarehouseId:"wh-b",lines:[{productId,quantity:5}]});\n  await command({type:"sale.post",warehouseId:"wh-b",partyId:"customer",paymentMethod:"note",lines:[{productId,quantity:2,piecePrice:100}]});\n  await updateOpening(productId,6,50,"wh-a",false);\n  const product=await db.collection("products").findOne({id:productId});\n  assert.deepEqual(product.stocks,{"wh-a":1,"wh-b":3});\n});\n\ntest("voiding a sale restores its consumed opening provenance", async () => {\n  const productId=await createOpened(10,50,"wh-a");\n  const saleId=await command({type:"sale.post",warehouseId:"wh-a",partyId:"customer",paymentMethod:"note",lines:[{productId,quantity:3,piecePrice:100}]});\n  let product=await db.collection("products").findOne({id:productId});\n  assert.equal((await deriveOpeningStockState(db,undefined,product)).consumed,3);\n  await command({type:"sale.void",documentId:saleId});\n  product=await db.collection("products").findOne({id:productId});\n  const state=await deriveOpeningStockState(db,undefined,product);\n  assert.deepEqual([state.consumed,state.remaining,product.stocks["wh-a"]],[0,10,10]);\n});\n\ntest("multiple purchases fall back latest to previous to opening when voided", async () => {\n  const productId=await createOpened(10,50,"wh-a");\n  const first=await command({type:"purchase.post",warehouseId:"wh-a",partyId:"supplier",paymentMethod:"note",lines:[{productId,quantity:2,unitPrice:70}]});\n  const second=await command({type:"purchase.post",warehouseId:"wh-a",partyId:"supplier",paymentMethod:"note",lines:[{productId,quantity:2,unitPrice:90}]});\n  let product=await db.collection("products").findOne({id:productId});assert.equal(product.lastPurchaseCost,90);\n  await command({type:"purchase.void",documentId:second});product=await db.collection("products").findOne({id:productId});assert.equal(product.lastPurchaseCost,70);\n  await command({type:"purchase.void",documentId:first});product=await db.collection("products").findOne({id:productId});assert.deepEqual([product.lastPurchaseCost,product.lastPurchaseCostSource],[50,"opening"]);\n});\n\ntest("opening can be established later only while product has no stock history", async () => {\n  const productId=await command({type:"product.create",name:"Empty",pieceCost:40,piecePrice:100,openingStock:0});\n  await command({type:"product.update",id:productId,name:"Empty",pieceCost:40,piecePrice:100,replaceOpeningStock:true,openingStock:4,openingCost:40,openingWarehouseId:"wh-a"});\n  let product=await db.collection("products").findOne({id:productId});assert.equal(product.stocks["wh-a"],4);\n  const legacyId="legacy-history";await db.collection("products").insertOne({id:legacyId,name:"Legacy history",sku:"L2",barcode:"",pieceCost:20,legacyOpeningCost:20,stocks:{"wh-a":2}});\n  await db.collection("stockMovements").insertOne({id:"legacy-h",productId:legacyId,productName:"Legacy history",warehouseId:"wh-a",warehouseName:"A",documentId:"legacy-opening",documentNumber:"LEG-OPEN",type:"legacy-opening",quantityDelta:2,balanceBefore:0,balanceAfter:2,occurredAt:"2025-01-01T00:00:00.000Z"});\n  await assert.rejects(command({type:"product.update",id:legacyId,name:"Legacy history",pieceCost:20,piecePrice:100,replaceOpeningStock:true,openingStock:2,openingCost:20,openingWarehouseId:"wh-a"}),/لا يمكن إنشاء رصيد بداية رجعي/);\n});\n\ntest("cost-only opening correction changes future cost without stock movement", async () => {\n  const productId=await createOpened(10,50,"wh-a"),before=await db.collection("stockMovements").countDocuments();\n  await updateOpening(productId,10,65,"wh-a",false);\n  assert.equal(await db.collection("stockMovements").countDocuments(),before);\n  const correction=await db.collection("documents").findOne({openingCorrection:true});assert.equal(correction.lines[0].quantity,0);\n  const saleId=await command({type:"sale.post",warehouseId:"wh-a",partyId:"customer",paymentMethod:"note",lines:[{productId,quantity:1,piecePrice:100}]});\n  assert.equal((await db.collection("documents").findOne({id:saleId})).lines[0].costAtSale,65);\n});\n`;
  write(path,s);
}

{
  const path="tests/reports.test.mjs";
  let s=read(path);
  s=replaceOnce(s,`{id:"legacy-cost",stocks:{old:3},pieceCost:10},`,`{id:"legacy-cost",stocks:{old:3},pieceCost:999,legacyOpeningCost:10},`,"legacy inventory fixture");
  s += `\n\ntest("historical report cost falls back to native opening but never invents DataAcc snapshot cost",async()=>{\n  await db.collection("products").insertMany([{id:"native",name:"Native",sku:"N",openingCost:55},{id:"legacy",name:"Legacy",sku:"L",legacyOpeningCost:80}]);\n  await db.collection("documents").insertMany([\n    {id:"open",number:"OPEN-1",kind:"adjustment",status:"posted",occurredAt:"2026-08-01T09:00:00.000Z",total:0,paidTotal:0,dueTotal:0,lines:[line("ol","native",10,55)]},\n    doc("native-sale","sale","2026-08-10",[line("ns","native",2,100)]),\n    doc("legacy-sale","sale","2026-08-10",[line("ls","legacy",2,100)]),\n  ]);\n  const report=await buildReport(db,filters("profit",{groupBy:"product"}));\n  const native=report.rows.find(row=>row.productId==="native"),legacy=report.rows.find(row=>row.productId==="legacy");\n  assert.deepEqual([native.cost,native.profit,native.costKnown],[110,90,true]);\n  assert.deepEqual([legacy.cost,legacy.profit,legacy.costKnown],[0,200,false]);\n});\n`;
  write(path,s);
}

console.log("PR58 completion patches applied");
