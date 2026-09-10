from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing exact block in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_between(path, start, end, new):
    p = Path(path)
    text = p.read_text()
    i = text.find(start)
    if i < 0:
        raise SystemExit(f"missing start marker in {path}: {start!r}")
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f"missing end marker in {path}: {end!r}")
    p.write_text(text[:i] + new + text[j:])

# Domain: keep manual catalog purchase price separate from the accounting cost basis.
replace_exact(
    "app/domain.ts",
    '  pieceCost: number | null;\n  /** Cost from the newest posted purchase; manual pieceCost is never authoritative. */\n  lastPurchaseCost?: number | null;\n  lastPurchaseAt?: string | null;\n',
    '  pieceCost: number | null;\n  /** Editable native opening-stock basis. These fields do not rewrite historical sales. */\n  openingStock?: number;\n  openingWarehouseId?: string | null;\n  openingUnitCost?: number | null;\n  /** View-only compatibility hints populated by bootstrap. */\n  openingMultipleWarehouses?: boolean;\n  soldQuantity?: number;\n  hasPostedPurchase?: boolean;\n  /** Imported DataAcc opening valuation, retained as an accounting fallback. */\n  legacyOpeningCost?: number | null;\n  /** Accounting cost for new sales: latest posted purchase, otherwise opening/adjustment fallback. */\n  lastPurchaseCost?: number | null;\n  lastPurchaseAt?: string | null;\n  costBasisSource?: "purchase" | "opening" | "adjustment" | "legacy-opening" | null;\n'
)
replace_exact(
    "app/domain.ts",
    '/** Presentation-only inventory valuation; it does not change accounting cost policy. */\nexport function inventoryUnitCost(product: Pick<Product, "lastPurchaseCost" | "pieceCost">) {\n  return product.lastPurchaseCost ?? product.pieceCost ?? 0;\n}',
    '/** Presentation-only inventory valuation; it does not change accounting cost policy. */\nexport function inventoryUnitCost(product: Pick<Product, "lastPurchaseCost" | "openingUnitCost" | "legacyOpeningCost" | "pieceCost">) {\n  return product.lastPurchaseCost ?? product.openingUnitCost ?? product.legacyOpeningCost ?? product.pieceCost ?? 0;\n}'
)

# Command layer: centralize purchase/opening cost resolution and derive legacy native opening balances.
replace_between(
    "app/api/command/route.ts",
    'async function authoritativeCost(db: Db, session: ClientSession, product: Record<string, unknown>) {',
    'async function changePartyDebt',
    '''const finiteCost = (value: unknown) => { const cost = Number(value); return Number.isFinite(cost) && cost > 0 ? cost : null; };
type OpeningState = { total: number; warehouseId: string | null; byWarehouse: Map<string, number>; unitCost: number | null; at: string | null };
async function latestPostedPurchaseCost(db: Db, session: ClientSession, productId: string, occurredAt?: string) {
  const latest = await db.collection("documents").findOne(
    { kind: "purchase", status: "posted", ...(occurredAt ? { occurredAt: { $lte: occurredAt } } : {}), "lines.productId": productId },
    { session, sort: { occurredAt: -1 }, projection: { lines: 1, occurredAt: 1 } },
  );
  const line = (latest?.lines as Line[] | undefined)?.find(item => item.productId === productId), cost = finiteCost(line?.unitPrice);
  return cost === null ? null : { cost, at: String(latest?.occurredAt ?? "") || null };
}
async function productOpeningState(db: Db, session: ClientSession, product: Record<string, unknown>): Promise<OpeningState> {
  const productId = String(product.id), storedQuantity = Number(product.openingStock), storedWarehouse = text(product.openingWarehouseId);
  const storedValid = product.openingStock !== null && product.openingStock !== undefined && Number.isInteger(storedQuantity) && storedQuantity >= 0 && (storedQuantity === 0 || Boolean(storedWarehouse));
  if (storedValid) return { total: storedQuantity, warehouseId: storedQuantity > 0 ? storedWarehouse : null, byWarehouse: new Map(storedQuantity > 0 ? [[storedWarehouse, storedQuantity]] : []), unitCost: storedQuantity > 0 ? finiteCost(product.openingUnitCost) ?? finiteCost(product.pieceCost) : null, at: String(product.openingUpdatedAt ?? product.createdAt ?? "") || null };
  const movements = await db.collection("stockMovements").find({ productId, type: "opening" }, { session }).sort({ occurredAt: 1 }).toArray(), byWarehouse = new Map<string, number>();
  for (const movement of movements) { const warehouseId = String(movement.warehouseId ?? ""); if (!warehouseId) continue; byWarehouse.set(warehouseId, (byWarehouse.get(warehouseId) ?? 0) + Number(movement.quantityDelta ?? 0)); }
  for (const [warehouseId, quantity] of [...byWarehouse]) if (!Number.isFinite(quantity) || quantity <= 0) byWarehouse.delete(warehouseId);
  const total = [...byWarehouse.values()].reduce((sum, quantity) => sum + quantity, 0), entries = [...byWarehouse.entries()];
  const opening = await db.collection("documents").findOne({ kind: "adjustment", status: "posted", number: { $regex: "^OPEN-" }, "lines.productId": productId }, { session, sort: { occurredAt: -1 } });
  const openingLine = (opening?.lines as Line[] | undefined)?.find(line => line.productId === productId);
  return { total, warehouseId: entries.length === 1 ? entries[0][0] : null, byWarehouse, unitCost: total > 0 ? finiteCost(product.openingUnitCost) ?? finiteCost(openingLine?.unitPrice) ?? finiteCost(product.pieceCost) : null, at: String(opening?.occurredAt ?? product.createdAt ?? "") || null };
}
async function nativeOpeningCostAt(db: Db, session: ClientSession, productId: string, occurredAt: string) {
  const opening = await db.collection("documents").findOne(
    { kind: "adjustment", status: "posted", number: { $regex: "^OPEN-" }, occurredAt: { $lte: occurredAt }, "lines.productId": productId },
    { session, sort: { occurredAt: -1 } },
  );
  if (!opening || (opening.openingStockAfter !== null && opening.openingStockAfter !== undefined && Number(opening.openingStockAfter) <= 0)) return null;
  const line = (opening.lines as Line[] | undefined)?.find(item => item.productId === productId);
  return finiteCost(line?.unitPrice);
}
async function authoritativeCost(db: Db, session: ClientSession, product: Record<string, unknown>) {
  const cached = finiteCost(product.lastPurchaseCost);
  if (cached !== null && product.costBasisSource) return cached;
  const productId = String(product.id), latest = await latestPostedPurchaseCost(db, session, productId);
  if (latest) {
    await db.collection("products").updateOne({ id: productId }, { $set: { lastPurchaseCost: latest.cost, lastPurchaseAt: latest.at, costBasisSource: "purchase" } }, { session });
    Object.assign(product, { lastPurchaseCost: latest.cost, lastPurchaseAt: latest.at, costBasisSource: "purchase" });
    return latest.cost;
  }
  const opening = await productOpeningState(db, session, product), legacy = finiteCost(product.legacyOpeningCost);
  const resolved = opening.total > 0 && opening.unitCost !== null ? { cost: opening.unitCost, at: opening.at, source: "opening" } : legacy !== null ? { cost: legacy, at: null, source: "legacy-opening" } : cached !== null ? { cost: cached, at: product.lastPurchaseAt ?? null, source: "adjustment" } : null;
  if (!resolved) return null;
  await db.collection("products").updateOne({ id: productId }, { $set: { lastPurchaseCost: resolved.cost, lastPurchaseAt: resolved.at, costBasisSource: resolved.source } }, { session });
  Object.assign(product, { lastPurchaseCost: resolved.cost, lastPurchaseAt: resolved.at, costBasisSource: resolved.source });
  return resolved.cost;
}
async function historicalCost(db: Db, session: ClientSession, productId: string, occurredAt: string) {
  const purchase = await latestPostedPurchaseCost(db, session, productId, occurredAt);
  if (purchase) return purchase.cost;
  const opening = await nativeOpeningCostAt(db, session, productId, occurredAt);
  if (opening !== null) return opening;
  const product = await db.collection("products").findOne({ id: productId }, { session, projection: { legacyOpeningCost: 1 } });
  return finiteCost(product?.legacyOpeningCost);
}
'''
)
replace_between(
    "app/api/command/route.ts",
    'async function recomputePurchaseCosts(db: Db, session: ClientSession, productIds: string[]) {',
    'async function refs',
    '''async function recomputePurchaseCosts(db: Db, session: ClientSession, productIds: string[]) {
  for (const productId of new Set(productIds)) {
    const product = await db.collection("products").findOne({ id: productId }, { session }); if (!product) continue;
    const latest = await latestPostedPurchaseCost(db, session, productId);
    if (latest) { await db.collection("products").updateOne({ id: productId }, { $set: { lastPurchaseCost: latest.cost, lastPurchaseAt: latest.at, costBasisSource: "purchase" } }, { session }); continue; }
    const opening = await productOpeningState(db, session, product), legacy = finiteCost(product.legacyOpeningCost), adjustment = product.costBasisSource === "adjustment" ? finiteCost(product.lastPurchaseCost) : null;
    const fallback = opening.total > 0 && opening.unitCost !== null ? { cost: opening.unitCost, at: opening.at, source: "opening" } : legacy !== null ? { cost: legacy, at: null, source: "legacy-opening" } : adjustment !== null ? { cost: adjustment, at: product.lastPurchaseAt ?? null, source: "adjustment" } : null;
    await db.collection("products").updateOne({ id: productId }, { $set: { lastPurchaseCost: fallback?.cost ?? null, lastPurchaseAt: fallback?.at ?? null, costBasisSource: fallback?.source ?? null } }, { session });
  }
}
'''
)

product_block = '''  if (type === "product.create" || type === "product.update") {
    const name = text(body.name), barcode = text(body.barcode);
    if (!name) throw new CommandError("اسم المنتج مطلوب");
    const productId = text(body.id), categoryId = text(body.categoryId);
    if (categoryId && !await db.collection("productCategories").findOne({ id: categoryId }, { session })) throw new CommandError("الفئة غير موجودة", 404);
    if (barcode && await db.collection("products").findOne({ barcode, ...(type === "product.update" ? { id: { $ne: productId } } : {}) }, { session })) throw new CommandError("هذا الباركود مستخدم لمنتج آخر", 409);
    const note = text(body.note);
    if (note.length > 1000) throw new CommandError("ملاحظة المنتج طويلة جدًا");
    const pieceCost = optionalNumber(body.pieceCost, "سعر الشراء"), values = { name, barcode, expiryDate: optionalDate(body.expiryDate), note: note || null, categoryId: categoryId || null, pieceCost, piecePrice: optionalNumber(body.piecePrice, "سعر البيع"), wholesalePrice: optionalNumber(body.wholesalePrice, "سعر الجملة") };
    if (type === "product.create") {
      const openingStock = optionalNumber(body.openingStock, "رصيد البداية") ?? 0;
      if (!Number.isInteger(openingStock)) throw new CommandError("رصيد البداية غير صالح");
      if (openingStock > 0 && (!pieceCost || pieceCost <= 0)) throw new CommandError("سعر الشراء للفرد مطلوب عند إدخال رصيد بداية");
      let warehouse = null;
      if (openingStock > 0) {
        const openingWarehouseId = text(body.openingWarehouseId);
        if (!openingWarehouseId) throw new CommandError("مخزن رصيد البداية مطلوب");
        warehouse = await warehouses(db).findOne({ _id: openingWarehouseId, isArchived: { $ne: true } }, { session });
        if (!warehouse) throw new CommandError("مخزن رصيد البداية مطلوب");
      }
      const sku = await nextProductCode(db, session), now = new Date(), openingWarehouseId = openingStock > 0 ? String(warehouse!._id) : null, product = { id: id("product"), sku, ...values, openingStock, openingWarehouseId, openingUnitCost: openingStock > 0 ? pieceCost : null, openingUpdatedAt: now.toISOString(), ...(openingStock > 0 ? { lastPurchaseCost: pieceCost, lastPurchaseAt: now.toISOString(), costBasisSource: "opening" } : { lastPurchaseCost: null, lastPurchaseAt: null, costBasisSource: null }), stocks: {}, createdAt: now };
      await db.collection("products").insertOne(product, { session });
      if (openingStock > 0 && warehouse) {
        const doc = { ...baseDocument("adjustment", "OPEN"), partyId: null, partyName: null, warehouseId: warehouse._id, warehouseName: warehouse.name, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: null, title: "رصيد بداية", openingStockBefore: 0, openingStockAfter: openingStock, openingUnitCostBefore: null, openingUnitCostAfter: pieceCost, total: 0, dueTotal: 0, paidTotal: 0, lines: [{ id: id("line"), productId: product.id, description: name, quantity: openingStock, unitPrice: pieceCost, lineTotal: 0 }] };
        await changeStock(db, session, product, warehouse, openingStock, doc, "opening");
        await db.collection("documents").insertOne(doc, { session });
      }
      return product.id;
    }
    const product = await db.collection("products").findOne({ id: productId }, { session }); if (!product) throw new CommandError("المنتج غير موجود", 404);
    const currentOpening = await productOpeningState(db, session, product), openingProvided = Object.prototype.hasOwnProperty.call(body, "openingStock");
    const openingStock = openingProvided ? optionalNumber(body.openingStock, "رصيد البداية") ?? 0 : currentOpening.total;
    if (!Number.isInteger(openingStock)) throw new CommandError("رصيد البداية غير صالح");
    const latestPurchase = await latestPostedPurchaseCost(db, session, productId), requestedWarehouseId = text(body.openingWarehouseId);
    const targetWarehouseId = openingProvided ? (openingStock > 0 ? requestedWarehouseId : "") : currentOpening.warehouseId ?? "";
    let targetWarehouse: WarehouseDoc | null = null;
    if (openingStock > 0 && openingProvided) {
      if (!targetWarehouseId) throw new CommandError("مخزن رصيد البداية مطلوب");
      targetWarehouse = await warehouses(db).findOne({ _id: targetWarehouseId, isArchived: { $ne: true } }, { session });
      if (!targetWarehouse) throw new CommandError("مخزن رصيد البداية مطلوب");
    } else if (openingStock > 0 && targetWarehouseId) targetWarehouse = await warehouses(db).findOne({ _id: targetWarehouseId }, { session });
    const manualCost = finiteCost(pieceCost), openingUnitCost = openingStock > 0 ? (latestPurchase ? currentOpening.unitCost ?? manualCost ?? latestPurchase.cost : manualCost) : null;
    if (openingStock > 0 && openingUnitCost === null) throw new CommandError("سعر الشراء للفرد مطلوب عند إدخال رصيد بداية");
    const targetDistribution = openingProvided ? new Map<string, number>(openingStock > 0 ? [[targetWarehouseId, openingStock]] : []) : new Map(currentOpening.byWarehouse);
    const changes = [...new Set([...currentOpening.byWarehouse.keys(), ...targetDistribution.keys()])].map(warehouseId => ({ warehouseId, delta: (targetDistribution.get(warehouseId) ?? 0) - (currentOpening.byWarehouse.get(warehouseId) ?? 0) })).filter(change => change.delta !== 0);
    const openingCostChanged = openingStock > 0 && openingUnitCost !== currentOpening.unitCost, openingChanged = changes.length > 0;
    let costFields: Record<string, unknown>;
    if (latestPurchase) costFields = { lastPurchaseCost: latestPurchase.cost, lastPurchaseAt: latestPurchase.at, costBasisSource: "purchase" };
    else if (openingStock > 0) costFields = { lastPurchaseCost: openingUnitCost, lastPurchaseAt: openingChanged || openingCostChanged ? new Date().toISOString() : currentOpening.at, costBasisSource: "opening" };
    else if (finiteCost(product.legacyOpeningCost) !== null) costFields = { lastPurchaseCost: finiteCost(product.legacyOpeningCost), lastPurchaseAt: null, costBasisSource: "legacy-opening" };
    else if (currentOpening.total > 0 || ["opening", "purchase", "legacy-opening"].includes(String(product.costBasisSource ?? ""))) costFields = { lastPurchaseCost: null, lastPurchaseAt: null, costBasisSource: null };
    else costFields = { lastPurchaseCost: product.lastPurchaseCost ?? null, lastPurchaseAt: product.lastPurchaseAt ?? null, costBasisSource: product.costBasisSource ?? null };
    const openingWarehouseId = openingProvided ? (openingStock > 0 ? targetWarehouseId : null) : currentOpening.warehouseId;
    const openingUpdatedAt = openingChanged || openingCostChanged ? new Date().toISOString() : String(product.openingUpdatedAt ?? currentOpening.at ?? "") || null;
    const productUpdate = { ...values, openingStock, openingWarehouseId, openingUnitCost, openingUpdatedAt, ...costFields };
    await db.collection("products").updateOne({ id: productId }, { $set: productUpdate }, { session }); Object.assign(product, productUpdate);
    const makeCorrection = (warehouse: WarehouseDoc, delta: number) => ({ ...baseDocument("adjustment", "OPEN"), partyId: null, partyName: null, warehouseId: warehouse._id, warehouseName: warehouse.name, destinationWarehouseId: null, destinationWarehouseName: null, parentDocumentId: null, paymentMethod: null, title: "تعديل رصيد البداية", openingStockBefore: currentOpening.total, openingStockAfter: openingStock, openingUnitCostBefore: currentOpening.unitCost, openingUnitCostAfter: openingUnitCost, total: 0, dueTotal: 0, paidTotal: 0, lines: [{ id: id("line"), productId, description: name, quantity: delta, unitPrice: openingUnitCost ?? currentOpening.unitCost ?? 0, lineTotal: 0 }] });
    for (const change of changes.filter(change => change.delta < 0)) {
      const warehouse = await warehouses(db).findOne({ _id: change.warehouseId }, { session }); if (!warehouse) throw new CommandError("تعذر العثور على مخزن رصيد البداية السابق", 409);
      const doc = makeCorrection(warehouse, change.delta);
      try { await changeStock(db, session, product, warehouse, change.delta, doc, "opening"); } catch (error) { if (error instanceof CommandError && /المخزون غير كاف/.test(error.message)) throw new CommandError("لا يمكن تعديل رصيد البداية بهذه الكمية أو نقل مخزنه لأن جزءًا من الرصيد تم التصرف فيه. فواتير البيع والحركات السابقة لا تتغير من شاشة المنتج.", 409); throw error; }
      await db.collection("documents").insertOne(doc, { session });
    }
    for (const change of changes.filter(change => change.delta > 0)) {
      const warehouse = targetWarehouseId === change.warehouseId && targetWarehouse ? targetWarehouse : await warehouses(db).findOne({ _id: change.warehouseId, isArchived: { $ne: true } }, { session }); if (!warehouse) throw new CommandError("مخزن رصيد البداية مطلوب");
      const doc = makeCorrection(warehouse, change.delta); await changeStock(db, session, product, warehouse, change.delta, doc, "opening"); await db.collection("documents").insertOne(doc, { session });
    }
    if (!openingChanged && openingCostChanged && targetWarehouse) await db.collection("documents").insertOne(makeCorrection(targetWarehouse, 0), { session });
    return productId;
  }
'''
replace_between("app/api/command/route.ts", '  if (type === "product.create" || type === "product.update") {', '  if (["sale.update", "purchase.update"].includes(type)) {', product_block)
replace_exact("app/api/command/route.ts", '{ $set: { lastPurchaseCost: line.unitPrice, lastPurchaseAt: doc.occurredAt } }', '{ $set: { lastPurchaseCost: line.unitPrice, lastPurchaseAt: doc.occurredAt, costBasisSource: "purchase" } }')
replace_exact("app/api/command/route.ts", '{ $set: { lastPurchaseCost: line.purchaseCost, lastPurchaseAt: doc.occurredAt } }', '{ $set: { lastPurchaseCost: line.purchaseCost, lastPurchaseAt: doc.occurredAt, costBasisSource: "adjustment" } }')

# Bootstrap: derive editable native opening state from full opening history, and expose sold/purchase hints.
p = Path("app/api/bootstrap/route.ts")
text = p.read_text()
text = text.replace('documents, movements, financialMovements, partyMetricDocuments,', 'documents, movements, openingMovements, financialMovements, partyMetricDocuments,', 1)
text = text.replace('db.collection("stockMovements").find().sort({ occurredAt: -1 }).limit(1000).toArray(),\n      db.collection("financialMovements")', 'db.collection("stockMovements").find().sort({ occurredAt: -1 }).limit(1000).toArray(),\n      db.collection("stockMovements").find({ type: "opening" }).toArray(),\n      db.collection("financialMovements")', 1)
old = '    const cleanProducts = clean(products).map(product => ({ ...product, wholesalePrice: (product as Record<string, unknown>).wholesalePrice ?? null, expiryDate: (product as Record<string, unknown>).expiryDate ?? null, note: (product as Record<string, unknown>).note ?? null, categoryId: (product as Record<string, unknown>).categoryId ?? null }));'
new = '''    const openingByProduct=new Map<string,Map<string,number>>();for(const movement of openingMovements){const productId=String(movement.productId??""),warehouseId=String(movement.warehouseId??"");if(!productId||!warehouseId)continue;const byWarehouse=openingByProduct.get(productId)??new Map<string,number>();byWarehouse.set(warehouseId,(byWarehouse.get(warehouseId)??0)+Number(movement.quantityDelta??0));openingByProduct.set(productId,byWarehouse)}
    const soldByProduct=new Map<string,number>(),purchasedProducts=new Set<string>();for(const document of partyMetricDocuments){if(document.status!=="posted")continue;for(const line of (document.lines??[]) as Array<Record<string,unknown>>){const productId=String(line.productId??"");if(!productId)continue;if(document.kind==="purchase")purchasedProducts.add(productId);if(document.kind==="sale")soldByProduct.set(productId,(soldByProduct.get(productId)??0)+Number(line.quantity??0))}}
    const latestPurchaseMap=new Map(legacyCosts.map(cost=>[String(cost._id),{cost:Number(cost.cost),at:String(cost.at??"")} ] as const));
    const cleanProducts = clean(products).map(product => { const item=product as Record<string,unknown>,productId=String(item.id??""),derived=[...(openingByProduct.get(productId)??new Map<string,number>())].filter(([,quantity])=>Number(quantity)>0),stored=Number(item.openingStock),storedWarehouse=String(item.openingWarehouseId??""),storedValid=item.openingStock!==null&&item.openingStock!==undefined&&Number.isInteger(stored)&&stored>=0&&(stored===0||Boolean(storedWarehouse)),openingStock=storedValid?stored:derived.reduce((sum,[,quantity])=>sum+Number(quantity),0),openingWarehouseId=storedValid?(openingStock>0?storedWarehouse:null):(derived.length===1?derived[0][0]:null),latestPurchase=latestPurchaseMap.get(productId),storedLast=Number(item.lastPurchaseCost),legacyCost=Number(item.legacyOpeningCost),openingCost=Number(item.openingUnitCost),manualCost=Number(item.pieceCost),lastPurchaseCost=latestPurchase?.cost??(Number.isFinite(storedLast)&&storedLast>0?storedLast:null)??(openingStock>0&&Number.isFinite(openingCost)&&openingCost>0?openingCost:null)??(Number.isFinite(legacyCost)&&legacyCost>0?legacyCost:null); return { ...product, wholesalePrice:item.wholesalePrice??null, expiryDate:item.expiryDate??null, note:item.note??null, categoryId:item.categoryId??null, openingStock, openingWarehouseId, openingUnitCost:Number.isFinite(openingCost)&&openingCost>0?openingCost:(openingStock>0&&!latestPurchase&&Number.isFinite(manualCost)&&manualCost>0?manualCost:null), openingMultipleWarehouses:!storedValid&&derived.length>1, soldQuantity:soldByProduct.get(productId)??0, hasPostedPurchase:purchasedProducts.has(productId), lastPurchaseCost, lastPurchaseAt:latestPurchase?.at||item.lastPurchaseAt??null }; });'''
if old not in text:
    raise SystemExit("missing cleanProducts bootstrap block")
text = text.replace(old, new, 1)
p.write_text(text)

# Reports: historical profit can fall back to native/imported opening cost without touching persisted sale snapshots.
replace_exact(
    "lib/reports.ts",
    'type Cost = { unit: number | null; source: "snapshot" | "historical-purchase" | "unknown" };',
    'type Cost = { unit: number | null; source: "snapshot" | "historical-purchase" | "historical-opening" | "legacy-opening" | "unknown" };'
)
new_sale_facts = '''async function saleFacts(db: Db, documents: Document[], f: ReportFilters, categoryScope: ProductScope = null) {
  const facts: ReportRow[] = [];
  const productIds = [...new Set(documents.flatMap(document => ((document.lines ?? []) as Document[]).map(line => String(line.productId ?? "")).filter(Boolean)))];
  const parentIds=[...new Set(documents.filter(document=>document.kind==="return"&&document.parentDocumentId).map(document=>String(document.parentDocumentId)))];
  const [identityRows,parentRows,purchaseRows,openingRows]=await Promise.all([
    db.collection("products").find({ id: { $in: productIds } }).project({ id: 1, name: 1, sku: 1, legacyOpeningCost: 1 }).toArray(),
    db.collection("documents").find({id:{$in:parentIds},kind:"sale"}).project({id:1,occurredAt:1}).toArray(),
    productIds.length?db.collection("documents").find({kind:"purchase",status:"posted","lines.productId":{$in:productIds}}).project({occurredAt:1,lines:1}).sort({occurredAt:1}).toArray():Promise.resolve([]),
    productIds.length?db.collection("documents").find({kind:"adjustment",status:"posted",number:{$regex:"^OPEN-"},"lines.productId":{$in:productIds}}).project({occurredAt:1,lines:1,openingStockAfter:1}).sort({occurredAt:1}).toArray():Promise.resolve([]),
  ]);
  const identities = new Map(identityRows.map(product => [String(product.id), product])),parentDates=new Map(parentRows.map(document=>[String(document.id),String(document.occurredAt)])),purchaseHistory=new Map<string,Array<{at:string;unit:number}>>(),openingHistory=new Map<string,Array<{at:string;unit:number|null;active:boolean}>>();
  for(const purchase of purchaseRows)for(const purchaseLine of (purchase.lines??[]) as Document[]){const key=String(purchaseLine.productId);if(!productIds.includes(key)||!Number.isFinite(Number(purchaseLine.unitPrice)))continue;const rows=purchaseHistory.get(key)??[];rows.push({at:String(purchase.occurredAt),unit:n(purchaseLine.unitPrice)});purchaseHistory.set(key,rows)}
  for(const opening of openingRows)for(const openingLine of (opening.lines??[]) as Document[]){const key=String(openingLine.productId);if(!productIds.includes(key))continue;const unit=Number(openingLine.unitPrice),rows=openingHistory.get(key)??[];rows.push({at:String(opening.occurredAt),unit:Number.isFinite(unit)&&unit>0?unit:null,active:opening.openingStockAfter===null||opening.openingStockAfter===undefined||n(opening.openingStockAfter)>0});openingHistory.set(key,rows)}
  for (const document of documents) for (const line of (document.lines ?? []) as Document[]) {
    if (!lineMatches(line, f, categoryScope)) continue;
    const sign = document.kind === "return" ? -1 : 1;
    const costDate=document.kind==="return"&&document.parentDocumentId?parentDates.get(String(document.parentDocumentId))??String(document.occurredAt):String(document.occurredAt),productId=String(line.productId);
    const historicalPurchase=[...(purchaseHistory.get(productId)??[])].reverse().find(row=>row.at<=costDate),historicalOpening=[...(openingHistory.get(productId)??[])].reverse().find(row=>row.at<=costDate),identity=identities.get(productId),legacyCost=identity?.legacyOpeningCost!==null&&identity?.legacyOpeningCost!==undefined&&Number.isFinite(Number(identity.legacyOpeningCost))&&Number(identity.legacyOpeningCost)>0?Number(identity.legacyOpeningCost):null;
    const cost:Cost=line.costAtSale!==null&&line.costAtSale!==undefined&&Number.isFinite(Number(line.costAtSale))?{unit:n(line.costAtSale),source:"snapshot"}:historicalPurchase?{unit:historicalPurchase.unit,source:"historical-purchase"}:historicalOpening?.active&&historicalOpening.unit!==null?{unit:historicalOpening.unit,source:"historical-opening"}:legacyCost!==null?{unit:legacyCost,source:"legacy-opening"}:{unit:null,source:"unknown"};
    const revenue = sign * n(line.lineTotal), quantity = sign * n(line.quantity), costKnown = cost.unit !== null, cogs = sign * n(line.quantity) * (cost.unit ?? 0), profit = revenue - cogs;
    const productName = String(identity?.name ?? line.description ?? "").trim() || "منتج غير متاح";
    const sku = String(identity?.sku ?? line.sku ?? "").trim() || "—";
    facts.push({ id: `${document.id}-${line.id}`, documentId: String(document.id), parentDocumentId: String(document.parentDocumentId ?? ""), number: displayDocumentNumber(document), occurredAt: String(document.occurredAt), party: String(document.partyName ?? "بيع مباشر"), partyId: String(document.partyId ?? ""), paymentMethod: String(document.paymentMethod ?? ""), productId, product: productName, sku, quantity, unitPrice: n(line.unitPrice), revenue, cost: cogs, profit, margin: revenue ? profit / revenue * 100 : 0, costKnown, costSource: cost.source, unknownRevenue: costKnown ? 0 : Math.abs(revenue) });
  }
  return facts;
}

'''
replace_between("lib/reports.ts", 'async function saleFacts(db: Db, documents: Document[], f: ReportFilters, categoryScope: ProductScope = null) {', 'function profitSummary', new_sale_facts)
replace_exact("lib/reports.ts", '    const cost = Number.isFinite(product.lastPurchaseCost) ? n(product.lastPurchaseCost) : Number.isFinite(product.pieceCost) ? n(product.pieceCost) : 0;', '    const cost = inventoryUnitCost({ lastPurchaseCost: Number.isFinite(product.lastPurchaseCost) ? n(product.lastPurchaseCost) : null, openingUnitCost: Number.isFinite(product.openingUnitCost) ? n(product.openingUnitCost) : null, legacyOpeningCost: Number.isFinite(product.legacyOpeningCost) ? n(product.legacyOpeningCost) : null, pieceCost: Number.isFinite(product.pieceCost) ? n(product.pieceCost) : null });')
replace_exact("lib/reports.ts", 'db.collection("products").find().project({stocks:1,lastPurchaseCost:1,pieceCost:1}).toArray(),', 'db.collection("products").find().project({stocks:1,lastPurchaseCost:1,openingUnitCost:1,legacyOpeningCost:1,pieceCost:1}).toArray(),')
replace_exact("lib/reports.ts", 'inventoryUnitCost({lastPurchaseCost:Number.isFinite(product.lastPurchaseCost)?n(product.lastPurchaseCost):null,pieceCost:Number.isFinite(product.pieceCost)?n(product.pieceCost):null})', 'inventoryUnitCost({lastPurchaseCost:Number.isFinite(product.lastPurchaseCost)?n(product.lastPurchaseCost):null,openingUnitCost:Number.isFinite(product.openingUnitCost)?n(product.openingUnitCost):null,legacyOpeningCost:Number.isFinite(product.legacyOpeningCost)?n(product.legacyOpeningCost):null,pieceCost:Number.isFinite(product.pieceCost)?n(product.pieceCost):null})')

# Product/purchase UI: show the editable catalog cost in product management and preload the editable opening state.
replace_exact("app/conta-app.tsx", '    unitPrice: String(p.pieceCost ?? 0),', '    unitPrice: String(p.pieceCost ?? p.lastPurchaseCost ?? 0),')
replace_exact("app/conta-app.tsx", 'mode === "purchase" ? tr("آخر شراء") : tr("السعر")', 'mode === "purchase" ? tr("سعر الشراء") : tr("السعر")')
replace_exact("app/conta-app.tsx", 'number(mode === "purchase" ? product.lastPurchaseCost ?? product.pieceCost ?? 0 : sellingPrice(product, priceMode))', 'number(mode === "purchase" ? product.pieceCost ?? product.lastPurchaseCost ?? 0 : sellingPrice(product, priceMode))')
replace_exact("app/conta-app.tsx", '{key:"cost",type:"money" as const,get:(product:Product)=>product.lastPurchaseCost}', '{key:"cost",type:"money" as const,get:(product:Product)=>product.pieceCost}')
replace_exact("app/conta-app.tsx", 'sortHeader("cost", tr("سعر آخر شراء"))', 'sortHeader("cost", tr("سعر الشراء"))')
replace_exact("app/conta-app.tsx", 'product.lastPurchaseCost == null ? "—" : number(product.lastPurchaseCost)', 'product.pieceCost == null ? "—" : number(product.pieceCost)')
replace_exact("app/conta-app.tsx", '    [openingStock, setOpeningStock] = useState(""), [openingWarehouseId, setOpeningWarehouseId] = useState(warehouses.find(warehouse => warehouse.isSalesDefault)?.id ?? ""),', '    [openingStock, setOpeningStock] = useState(String(product?.openingStock ?? "")), [openingWarehouseId, setOpeningWarehouseId] = useState(product?.openingWarehouseId ?? warehouses.find(warehouse => warehouse.isSalesDefault)?.id ?? ""),')
replace_exact("app/conta-app.tsx", 'const sensitive = product && (name.trim() !== product.name || (cost === "" ? null : val(cost)) !== product.pieceCost);', 'const sensitive = product && (name.trim() !== product.name || (cost === "" ? null : val(cost)) !== product.pieceCost || (openingStock === "" ? 0 : val(openingStock)) !== Number(product.openingStock ?? 0) || (val(openingStock) > 0 ? openingWarehouseId : "") !== (Number(product.openingStock ?? 0) > 0 ? product.openingWarehouseId ?? "" : ""));')
replace_exact("app/conta-app.tsx", '<label>{product ? tr("إضافة رصيد افتتاحي") : tr("رصيد البداية")}<Num value={openingStock}', '<label>{tr("رصيد البداية")}<Num value={openingStock}')
replace_exact("app/conta-app.tsx", '        {val(openingStock) > 0 && <label>{tr("مخزن رصيد البداية")}<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} floating preferUp resultsMaxHeight={126} /></label>}\n      </FramedSection>', '        {val(openingStock) > 0 && <label>{tr("مخزن رصيد البداية")}<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} floating preferUp resultsMaxHeight={126} /></label>}\n        {product?.openingMultipleWarehouses&&<small>{tr("product.openingMultiWarehouseNotice")}</small>}\n        {product&&Number(product.soldQuantity??0)>0&&<small>{tr("product.openingSoldNotice",{quantity:number(product.soldQuantity??0)})}</small>}\n        {product?.hasPostedPurchase&&<small>{tr("product.openingPurchaseNotice")}</small>}\n      </FramedSection>')

# i18n messages for the new explanatory copy and server conflict.
p = Path("app/i18n/messages.ts")
text = p.read_text(); marker = 'export const frMessages'
idx = text.find(marker)
if idx < 0: raise SystemExit("frMessages marker not found")
ar, fr = text[:idx], text[idx:]
ar_anchor = '  "products.purchasePrice": "سعر الشراء",\n'
if ar_anchor not in ar: raise SystemExit("Arabic i18n anchor missing")
ar += '' if False else ''
ar = ar.replace(ar_anchor, ar_anchor + '  "product.openingSoldNotice": "تم بيع {quantity} من هذا المنتج. تعديل رصيد البداية يغيّر المخزون الحالي فقط ولا يغيّر فواتير البيع أو أرباحها السابقة.",\n  "product.openingPurchaseNotice": "توجد فاتورة شراء معتمدة لهذا المنتج؛ تكلفة البيع الحالية تعتمد آخر فاتورة شراء، أما سعر الشراء هنا فهو قيمة يدوية للمنتج.",\n  "product.openingMultiWarehouseNotice": "رصيد البداية القديم موزع على أكثر من مخزن. اختر مخزنًا لتجميع رصيد البداية عند الحفظ؛ لن تتغير الحركات التاريخية.",\n  "لا يمكن تعديل رصيد البداية بهذه الكمية أو نقل مخزنه لأن جزءًا من الرصيد تم التصرف فيه. فواتير البيع والحركات السابقة لا تتغير من شاشة المنتج.": "لا يمكن تعديل رصيد البداية بهذه الكمية أو نقل مخزنه لأن جزءًا من الرصيد تم التصرف فيه. فواتير البيع والحركات السابقة لا تتغير من شاشة المنتج.",\n', 1)
fr_anchor_pos = fr.find('  "products.purchasePrice":')
if fr_anchor_pos < 0: raise SystemExit("French i18n anchor missing")
fr_line_end = fr.find('\n', fr_anchor_pos) + 1
fr = fr[:fr_line_end] + '  "product.openingSoldNotice": "{quantity} unité(s) de ce produit ont été vendues. Modifier le stock initial ajuste seulement le stock actuel et ne modifie ni les factures de vente ni leurs bénéfices passés.",\n  "product.openingPurchaseNotice": "Une facture d’achat validée existe pour ce produit : le coût de vente actuel vient du dernier achat, tandis que le prix d’achat ici reste une valeur manuelle du produit.",\n  "product.openingMultiWarehouseNotice": "L’ancien stock initial est réparti sur plusieurs dépôts. Choisissez le dépôt où consolider le stock initial lors de l’enregistrement ; l’historique ne sera pas modifié.",\n  "لا يمكن تعديل رصيد البداية بهذه الكمية أو نقل مخزنه لأن جزءًا من الرصيد تم التصرف فيه. فواتير البيع والحركات السابقة لا تتغير من شاشة المنتج.": "Impossible de modifier ou déplacer le stock initial ainsi, car une partie a déjà été utilisée. Les factures de vente et les mouvements historiques ne sont pas modifiés depuis la fiche produit.",\n' + fr[fr_line_end:]
p.write_text(ar + fr)

# Replace the old additive-opening regression with target/replacement semantics.
p = Path("tests/transactions.test.mjs")
text = p.read_text()
start = text.find('test("editing product may add audited opening stock but zero adds nothing"')
if start < 0: raise SystemExit("old opening edit test not found")
end = text.find('\ntest(', start + 5)
if end < 0: raise SystemExit("opening edit test end not found")
replacement = '''test("editing product opening stock replaces the prior opening target",async()=>{
  await command({type:"product.update",id:"p1",name:"Tea",pieceCost:50,openingStock:4,openingWarehouseId:"wh-b"});
  let product=await db.collection("products").findOne({id:"p1"});assert.deepEqual([product.stocks["wh-b"],product.openingStock,product.openingWarehouseId],[4,4,"wh-b"]);
  await command({type:"product.update",id:"p1",name:"Tea",pieceCost:50,openingStock:2,openingWarehouseId:"wh-b"});
  product=await db.collection("products").findOne({id:"p1"});assert.deepEqual([product.stocks["wh-b"],product.openingStock],[2,2]);
  await command({type:"product.update",id:"p1",name:"Tea",pieceCost:50,openingStock:0,openingWarehouseId:""});
  product=await db.collection("products").findOne({id:"p1"});assert.deepEqual([product.stocks["wh-b"],product.openingStock,product.openingWarehouseId],[0,0,null]);
  assert.deepEqual((await db.collection("stockMovements").find({productId:"p1",type:"opening"}).sort({occurredAt:1}).toArray()).map(m=>m.quantityDelta),[4,-2,-2]);
});
'''
text = text[:start] + replacement + text[end+1:]
p.write_text(text)

# Focused cross-layer regression suite.
Path("tests/opening-stock-regression.test.mjs").write_text('''import assert from "node:assert/strict";
import fs from "node:fs";
import test, { after, before, beforeEach } from "node:test";
import { sqliteHarness } from "./sqlite-harness.mjs";
import { execute } from "../app/api/command/route.ts";
import { buildReport } from "../lib/reports.ts";

let harness, db;
before(async()=>{harness=await sqliteHarness();db=harness.db});
after(async()=>{await harness.close()});
beforeEach(async()=>{await harness.reset();await db.collection("warehouses").insertMany([{_id:"wh-main",name:"Main",isSalesDefault:true},{_id:"wh-b",name:"B"}]);await db.collection("parties").insertOne({id:"supplier",name:"Supplier",partyType:"supplier",receivable:0,payable:0,net:0});await db.collection("paymentAccounts").insertOne({id:"cash-id",code:"cash",name:"Cash",isActive:true,balance:10000})});
const command=body=>db.transaction(session=>execute(db,session,body));
const createOpened=(quantity=10,cost=100,warehouseId="wh-main")=>command({type:"product.create",name:"Opened",pieceCost:cost,piecePrice:200,openingStock:quantity,openingWarehouseId:warehouseId});

test("opening quantity and warehouse are editable targets rather than additive stock",async()=>{const id=await createOpened();await command({type:"product.update",id,name:"Opened",pieceCost:100,piecePrice:200,openingStock:12,openingWarehouseId:"wh-b"});const product=await db.collection("products").findOne({id});assert.deepEqual([product.stocks["wh-main"],product.stocks["wh-b"],product.openingStock,product.openingWarehouseId],[0,12,12,"wh-b"]);assert.deepEqual((await db.collection("stockMovements").find({productId:id,type:"opening"}).toArray()).map(m=>m.quantityDelta).sort((a,b)=>a-b),[-10,10,12]);});

test("sold quantity is never rewritten by a product opening-stock edit",async()=>{const id=await createOpened();const saleId=await command({type:"sale.post",warehouseId:"wh-main",paymentMethod:"cash-id",lines:[{productId:id,quantity:3,piecePrice:200}]});const before=await db.collection("documents").findOne({id:saleId});await command({type:"product.update",id,name:"Opened",pieceCost:100,piecePrice:200,openingStock:8,openingWarehouseId:"wh-main"});const product=await db.collection("products").findOne({id}),after=await db.collection("documents").findOne({id:saleId});assert.equal(product.stocks["wh-main"],5);assert.deepEqual(after.lines,before.lines);assert.deepEqual([after.lines[0].costAtSale,after.lines[0].grossProfit],[100,300]);await assert.rejects(command({type:"product.update",id,name:"Opened",pieceCost:100,piecePrice:200,openingStock:2,openingWarehouseId:"wh-main"}),/فواتير البيع والحركات السابقة/);assert.equal((await db.collection("products").findOne({id})).stocks["wh-main"],5);});

test("editing opening cost changes future sale cost only when no posted purchase exists",async()=>{const id=await createOpened();await command({type:"product.update",id,name:"Opened",pieceCost:120,piecePrice:200,openingStock:10,openingWarehouseId:"wh-main"});let product=await db.collection("products").findOne({id});assert.deepEqual([product.pieceCost,product.openingUnitCost,product.lastPurchaseCost,product.costBasisSource],[120,120,120,"opening"]);const saleId=await command({type:"sale.post",warehouseId:"wh-main",paymentMethod:"cash-id",lines:[{productId:id,quantity:1,piecePrice:200}]});assert.deepEqual((await db.collection("documents").findOne({id:saleId})).lines.map(l=>[l.costAtSale,l.grossProfit]),[[120,80]]);});

test("latest posted purchase remains authoritative while manual product cost stays editable",async()=>{const id=await createOpened();await command({type:"product.update",id,name:"Opened",pieceCost:120,piecePrice:200,openingStock:10,openingWarehouseId:"wh-main"});await command({type:"sale.post",warehouseId:"wh-main",paymentMethod:"cash-id",lines:[{productId:id,quantity:1,piecePrice:200}]});const purchaseId=await command({type:"purchase.post",warehouseId:"wh-main",partyId:"supplier",paymentMethod:"note",lines:[{productId:id,quantity:2,unitPrice:150}]});await command({type:"product.update",id,name:"Opened",pieceCost:90,piecePrice:200,openingStock:10,openingWarehouseId:"wh-main"});let product=await db.collection("products").findOne({id});assert.deepEqual([product.pieceCost,product.openingUnitCost,product.lastPurchaseCost,product.costBasisSource],[90,120,150,"purchase"]);const secondSale=await command({type:"sale.post",warehouseId:"wh-main",paymentMethod:"cash-id",lines:[{productId:id,quantity:1,piecePrice:200}]});assert.equal((await db.collection("documents").findOne({id:secondSale})).lines[0].costAtSale,150);await command({type:"purchase.void",documentId:purchaseId});product=await db.collection("products").findOne({id});assert.deepEqual([product.lastPurchaseCost,product.costBasisSource],[120,"opening"]);});

test("profit report resolves opening cost for unsnapshotted history and keeps sale snapshots stable",async()=>{const id=await createOpened();const opening=await db.collection("documents").findOne({number:{$regex:"^OPEN-"},"lines.productId":id});await db.collection("documents").insertOne({id:"legacy-sale",number:"1",kind:"sale",status:"posted",occurredAt:new Date(new Date(opening.occurredAt).getTime()+1000).toISOString(),total:400,paidTotal:0,dueTotal:0,lines:[{id:"l",productId:id,description:"Opened",quantity:2,unitPrice:200,lineTotal:400}]});const report=await buildReport(db,{type:"profit",allTime:true,page:1,pageSize:100,groupBy:"invoice"});const row=report.rows.find(r=>r.documentId==="legacy-sale");assert.deepEqual([row.cost,row.profit,row.costKnown,row.costSource],[200,200,true,"historical-opening"]);});

test("product editor is wired to persisted opening state and manual purchase price",()=>{const ui=fs.readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),bootstrap=fs.readFileSync(new URL("../app/api/bootstrap/route.ts",import.meta.url),"utf8");assert.match(ui,/useState\(String\(product\?\.openingStock \?\? ""\)\)/);assert.match(ui,/product\?\.openingWarehouseId/);assert.doesNotMatch(ui,/product \? tr\("إضافة رصيد افتتاحي"\)/);assert.match(ui,/get:\(product:Product\)=>product\.pieceCost/);assert.match(ui,/product\.pieceCost \?\? product\.lastPurchaseCost \?\? 0/);assert.match(ui,/product\.openingSoldNotice/);assert.match(bootstrap,/openingMovements/);assert.match(bootstrap,/soldQuantity/);assert.match(bootstrap,/hasPostedPurchase/);});
''')
