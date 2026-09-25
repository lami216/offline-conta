"use client";
import { formatDateTime, kindLabels, number, type BootstrapData, type DocumentKind } from "./domain";
import { tr } from "./i18n/messages";

export type OpeningStockBlocker = {
  documentId: string;
  documentNumber: string;
  kind: string;
  title: string;
  status: string;
  occurredAt: string;
  movementTypes: string[];
  warehouses: Array<{ warehouseId: string; warehouseName: string; quantityDelta: number }>;
};

export type OpeningStockBlockedPayload = {
  code: "OPENING_STOCK_BLOCKED";
  reason?: string;
  productId: string;
  productName: string;
  consumedOpening?: number;
  restoredOpening?: number;
  deficits: Array<{ warehouseId: string; required: number; available: number; missing: number }>;
  blockers: OpeningStockBlocker[];
};

export function asOpeningStockBlockedPayload(reason: unknown): OpeningStockBlockedPayload | null {
  const payload = (reason as { payload?: unknown } | null)?.payload as Partial<OpeningStockBlockedPayload> | undefined;
  if (!payload || payload.code !== "OPENING_STOCK_BLOCKED" || !payload.productId || !Array.isArray(payload.blockers) || !Array.isArray(payload.deficits)) return null;
  return payload as OpeningStockBlockedPayload;
}

export default function OpeningStockBlockers({
  payload,
  data,
  openSource,
  openMovements,
  close,
}: {
  payload: OpeningStockBlockedPayload;
  data: BootstrapData;
  openSource: (id: string) => void;
  openMovements: (productId: string) => void;
  close: () => void;
}) {
  const operationLabel = (blocker: OpeningStockBlocker) => {
    const kind = blocker.kind as DocumentKind;
    return kindLabels[kind] ? tr(kindLabels[kind]) : blocker.title || blocker.movementTypes.join(" / ") || tr("عملية غير معروفة");
  };
  const deficitSummary = payload.deficits.map(deficit => {
    const warehouse = data.warehouses.find(item => item.id === deficit.warehouseId)?.name ?? deficit.warehouseId;
    return `${warehouse}: ${tr("المتاح")} ${number(deficit.available)} / ${tr("المطلوب")} ${number(deficit.required)}`;
  }).join(" · ");
  const explanation = payload.reason === "active-corrections"
    ? tr("يوجد تصحيح رصيد بداية نشط لهذا المنتج. ألغِ التصحيحات من الأحدث إلى الأقدم ثم أعد محاولة حذف رصيد البداية الأصلي.")
    : payload.reason === "relocated"
      ? tr("جزء من رصيد البداية موجود الآن في مخزن آخر بسبب حركات لاحقة. افتح حركات المنتج ثم ألغِ أو عدّل الحركات التي نقلت الكمية حتى تعود إلى مصدرها.")
      : tr("تم التصرف في جزء من رصيد البداية. افتح حركات المنتج لمعرفة أين استُخدمت الكمية، ويمكنك الانتقال مباشرة إلى مصدر كل حركة لإلغائها أو تعديلها.");

  return <div className="modal-overlay opening-correction-blockers-overlay" role="dialog" aria-modal="true" aria-label={tr("تعذر تعديل رصيد البداية")}>
    <section className="modal-card opening-correction-blockers">
      <div className="modal-heading"><h3>{tr("تعذر تعديل رصيد البداية")}</h3><button type="button" className="icon" aria-label={tr("إغلاق")} onClick={close}>×</button></div>
      <div className="opening-correction-blocker-copy"><strong>{payload.productName || tr("المنتج")}</strong><p>{explanation}</p>{deficitSummary && <small>{deficitSummary}</small>}</div>
      <div className="erp-table-wrap opening-correction-blocker-table"><table className="erp-table">
        <thead><tr><th>{tr("التاريخ")}</th><th>{tr("العملية")}</th><th>{tr("المستند")}</th><th>{tr("المخزن")}</th><th>{tr("الأثر على المخزون")}</th><th>{tr("الحالة")}</th><th>{tr("إجراءات")}</th></tr></thead>
        <tbody>{payload.blockers.map(blocker => {
          const warehouseEffect = blocker.warehouses.map(effect => `${effect.warehouseName}: ${effect.quantityDelta > 0 ? "+" : ""}${number(effect.quantityDelta)}`).join("، ");
          return <tr key={blocker.documentId}><td>{blocker.occurredAt ? formatDateTime(blocker.occurredAt) : "—"}</td><td>{operationLabel(blocker)}</td><td dir="ltr">{blocker.documentNumber || "—"}</td><td>{blocker.warehouses.map(effect => effect.warehouseName).join("، ") || "—"}</td><td className="num-cell">{warehouseEffect || "—"}</td><td>{blocker.status === "voided" ? tr("ملغى") : blocker.status === "posted" ? tr("معتمد") : blocker.status || "—"}</td><td className="action-cell"><button type="button" className="soft" onClick={() => { close(); openSource(blocker.documentId); }}>{tr("الانتقال إلى المصدر")}</button></td></tr>;
        })}{!payload.blockers.length && <tr><td colSpan={7}>{tr("لم يتم العثور على مستند مانع محدد. افتح حركات المنتج لمراجعة السجل الكامل.")}</td></tr>}</tbody>
      </table></div>
      <div className="dialog-actions">
        <button type="button" className="soft" onClick={close}>{tr("إغلاق")}</button>
        <button type="button" className="primary" onClick={() => { close(); openMovements(payload.productId); }}>{tr("عرض حركات المنتج")}</button>
      </div>
    </section>
  </div>;
}
