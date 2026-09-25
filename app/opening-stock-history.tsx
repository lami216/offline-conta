"use client";
import { useState } from "react";
import { displayDocumentNumber, formatDateTime, money, number, type BootstrapData, type DocumentRecord } from "./domain";
import { useAppConfirm } from "./app-confirm";
import { tr } from "./i18n/messages";
import { isOpeningStockCorrectionDocument, isOpeningStockDocument, optionalFiniteNumber } from "./stock-movement";
import OpeningStockBlockers, { asOpeningStockBlockedPayload, type OpeningStockBlockedPayload } from "./opening-stock-blockers";

type RunCommand = (body: Record<string, unknown>, message: string) => Promise<unknown>;
const correctionProductId = (document: DocumentRecord) => {
  const ids = [...new Set(document.lines.map(line => line.productId).filter((value): value is string => Boolean(value)))];
  return ids.length === 1 ? ids[0] : null;
};

function OpeningCorrectionEditor({ document, data, run, close }: { document: DocumentRecord; data: BootstrapData; run: RunCommand; close: () => void }) {
  const productId = correctionProductId(document);
  const product = data.products.find(item => item.id === productId);
  const currentWarehouseId = product?.openingWarehouseId ?? document.destinationWarehouseId ?? document.warehouseId ?? "";
  const initialOpening = optionalFiniteNumber(document.openingStockAfter) ?? optionalFiniteNumber(product?.openingStock) ?? 0;
  const initialCost = optionalFiniteNumber(document.openingCostAfter) ?? optionalFiniteNumber(product?.openingCost);
  const [openingStock, setOpeningStock] = useState(String(initialOpening));
  const [openingCost, setOpeningCost] = useState(initialCost == null ? "" : String(initialCost));
  const [warehouseId, setWarehouseId] = useState(currentWarehouseId);
  const quantityValue = Number(openingStock), costValue = openingCost === "" ? null : Number(openingCost);
  const invalid = !Number.isInteger(quantityValue) || quantityValue < 0 || (quantityValue > 0 && (!warehouseId || costValue == null || !Number.isFinite(costValue) || costValue <= 0));
  const warehouseOptions = data.warehouses.filter(warehouse => !warehouse.isArchived || warehouse.id === currentWarehouseId);

  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={tr("تعديل تصحيح رصيد البداية")}>
    <form className="modal-card account-dialog opening-correction-editor" onSubmit={async event => {
      event.preventDefault();
      if (invalid) return;
      await run({
        type: "opening-stock-correction.update",
        documentId: document.id,
        newOpeningStock: quantityValue,
        openingCost: quantityValue > 0 ? costValue : null,
        openingWarehouseId: warehouseId || null,
        relocateOpeningStock: Boolean(warehouseId && currentWarehouseId && warehouseId !== currentWarehouseId),
      }, tr("تم تعديل تصحيح رصيد البداية"));
      close();
    }}>
      <div className="modal-heading"><h3>{tr("تعديل تصحيح رصيد البداية")}</h3><button type="button" className="icon" aria-label={tr("إغلاق")} onClick={close}>×</button></div>
      <label>{tr("المنتج")}<input readOnly value={product?.name ?? document.lines[0]?.description ?? "—"} /></label>
      <label>{tr("رصيد البداية الحالي")}<input readOnly value={String(product?.openingStock ?? initialOpening)} /></label>
      <label>{tr("رصيد البداية الصحيح")}<input type="number" min="0" step="1" dir="ltr" required value={openingStock} onChange={event => setOpeningStock(event.target.value)} /></label>
      <label>{tr("opening.cost")}<input type="number" min="0" step="any" dir="ltr" disabled={quantityValue === 0} required={quantityValue > 0} value={openingCost} onChange={event => setOpeningCost(event.target.value)} /></label>
      <label>{tr("مخزن رصيد البداية")}<select required={quantityValue > 0} disabled={quantityValue === 0} value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">{tr("اختر المخزن")}</option>{warehouseOptions.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <div className="dialog-actions"><button type="button" className="soft" onClick={close}>{tr("إلغاء")}</button><button className="primary" disabled={invalid}>{tr("حفظ التعديل")}</button></div>
    </form>
  </div>;
}

export default function OpeningStockHistory({ data, docs, openDoc, openSource, openOpeningSource, openMovements, run, canEdit, canDelete }: { data: BootstrapData; docs: DocumentRecord[]; openDoc: (id: string) => void; openSource: (id: string) => void; openOpeningSource: (productId: string) => void; openMovements: (productId: string) => void; run: RunCommand; canEdit: boolean; canDelete: boolean }) {
  const confirmAction = useAppConfirm();
  const [editing, setEditing] = useState<DocumentRecord | null>(null);
  const [blocked, setBlocked] = useState<OpeningStockBlockedPayload | null>(null);
  const rows = docs.filter(isOpeningStockDocument).slice().sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const latestCorrectionByProduct = new Map<string, string>();
  for (const document of rows) {
    if (document.status !== "posted" || !isOpeningStockCorrectionDocument(document)) continue;
    const productId = correctionProductId(document);
    if (productId && !latestCorrectionByProduct.has(productId)) latestCorrectionByProduct.set(productId, document.id);
  }
  const remove = async (document: DocumentRecord) => {
    const approved = await confirmAction({ message: tr("هل تريد حذف آخر تصحيح لرصيد البداية؟ سيتم عكس أثره مع الاحتفاظ بسجل التدقيق."), confirmLabel: tr("حذف"), tone: "danger" });
    if (!approved) return;
    try {
      await run({ type: "opening-stock-correction.void", documentId: document.id }, tr("تم إلغاء تصحيح رصيد البداية"));
    } catch (reason) {
      const payload = asOpeningStockBlockedPayload(reason);
      if (payload) setBlocked(payload);
    }
  };

  return <section className="records recent-table opening-stock-history">
    <div className="heading"><h2>{tr("سجل التصحيحات")} — {tr("تصحيح رصيد البداية")}</h2></div>
    <div className="erp-table-wrap"><table className="erp-table" aria-label={`${tr("سجل التصحيحات")} — ${tr("تصحيح رصيد البداية")}`}>
      <thead><tr><th>{tr("رقم")}</th><th>{tr("التاريخ")}</th><th>{tr("المستند")}</th><th>{tr("المنتج")}</th><th>{tr("العملية")}</th><th>{tr("التغيير")}</th><th>{tr("رصيد البداية")}</th><th>{tr("opening.cost")}</th><th>{tr("المخزن")}</th><th>{tr("الحالة")}</th><th>{tr("إجراءات")}</th></tr></thead>
      <tbody>{rows.map((document, index) => {
        const correction = isOpeningStockCorrectionDocument(document);
        const movements = data.movements.filter(movement => movement.documentId === document.id);
        const movementDelta = movements.reduce((sum, movement) => sum + Number(movement.quantityDelta ?? 0), 0);
        const lineDelta = document.lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
        const delta = movements.length ? movementDelta : lineDelta;
        const initialAfter = document.lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity ?? 0)), 0);
        const productId = correctionProductId(document);
        const product = productId ? data.products.find(item => item.id === productId) : null;
        const explicitAfter = optionalFiniteNumber(document.openingStockAfter);
        const inferredCurrentAfter = correction && document.status === "posted" && productId && latestCorrectionByProduct.get(productId) === document.id ? optionalFiniteNumber(product?.openingStock) : null;
        const after = explicitAfter ?? inferredCurrentAfter ?? (correction ? null : initialAfter);
        const explicitBefore = correction ? optionalFiniteNumber(document.openingStockBefore) : 0;
        const before = explicitBefore ?? (correction && after !== null ? after - delta : null);
        const costBefore = optionalFiniteNumber(document.openingCostBefore);
        const costAfter = optionalFiniteNumber(document.openingCostAfter) ?? optionalFiniteNumber(product?.openingCost) ?? optionalFiniteNumber(document.lines[0]?.unitPrice);
        const stockBasis = before !== null && after !== null ? `${number(before)} → ${number(after)}` : "—";
        const cost = costAfter === null ? "—" : correction && costBefore !== null && costBefore !== costAfter ? `${money(costBefore)} → ${money(costAfter)}` : money(costAfter);
        const productNames = [...new Set(document.lines.map(line => data.products.find(product => product.id === line.productId)?.name ?? line.description.split(" — ")[0]).filter(Boolean))].join("، ") || "—";
        const from = document.warehouseName || movements[0]?.warehouseName || "—", to = document.destinationWarehouseName;
        const warehouse = to && to !== from ? `${from} → ${to}` : from;
        const manageable = Boolean(correction && document.status === "posted" && productId && latestCorrectionByProduct.get(productId) === document.id);
        const initialSource = Boolean(!correction && document.status === "posted" && productId);
        return <tr key={document.id} onClick={() => openDoc(document.id)}><td className="num-cell">{number(index + 1)}</td><td>{formatDateTime(document.occurredAt)}</td><td dir="ltr">{displayDocumentNumber(document)}</td><td className="name-cell">{productNames}</td><td>{correction ? tr("تصحيح رصيد البداية") : tr("رصيد بداية")}</td><td className="num-cell">{delta > 0 ? "+" : ""}{number(delta)}</td><td className="num-cell">{stockBasis}</td><td className="num-cell">{cost}</td><td>{warehouse}</td><td>{document.status === "voided" ? tr("ملغى") : tr("معتمد")}</td><td className="action-cell">{manageable && (canEdit || canDelete) ? <div className="party-row-actions lifecycle-row-actions">{canEdit && <button type="button" className="soft" onClick={event => { event.stopPropagation(); setEditing(document); }}>{tr("تعديل")}</button>}{canDelete && <button type="button" className="danger compact-delete" onClick={event => { event.stopPropagation(); void remove(document); }}>{tr("حذف")}</button>}</div> : initialSource && productId ? <button type="button" className="soft" onClick={event => { event.stopPropagation(); openOpeningSource(productId); }}>{tr("الانتقال إلى المصدر")}</button> : "—"}</td></tr>;
      })}{!rows.length && <tr><td colSpan={11}>{tr("لا توجد فواتير ضمن الفترة المحددة")}</td></tr>}</tbody>
    </table></div>
    {editing && <OpeningCorrectionEditor key={editing.id} document={editing} data={data} run={run} close={() => setEditing(null)} />}
    {blocked && <OpeningStockBlockers payload={blocked} data={data} openSource={openSource} openMovements={openMovements} close={() => setBlocked(null)} />}
  </section>;
}
