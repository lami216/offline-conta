import { isProductExpired, type Product } from "./domain";

export type SaleDraftLine = {
  productId: string;
  quantity: string;
  piecePrice: string;
};

export type PriceMode = "retail" | "wholesale";

export const initialSaleUiState = { priceMode: "retail" as PriceMode, scannerEnabled: false };

/** Clear only a successfully posted sale draft, never invoice history. */
export function clearPersistedSaleDraft(storage: Pick<Storage, "setItem">) {
  storage.setItem("conta:sale-lines", "[]");
  storage.setItem("conta:sale-payment", JSON.stringify(""));
  storage.setItem("conta:sale-party", JSON.stringify(""));
}

/** Selling tiers choose an editable default and never alter accounting cost. */
export function sellingPrice(product: Product, mode: PriceMode = "retail") {
  const retail = Number(product.piecePrice ?? 0);
  const wholesale = Number(product.wholesalePrice ?? 0);
  return mode === "wholesale" && wholesale > 0 ? wholesale : retail;
}

export function applyPriceMode<T extends SaleDraftLine>(lines: T[], products: Product[], mode: PriceMode): T[] {
  const byId = new Map(products.map(product => [product.id, product]));
  return lines.map(line => {
    const product = byId.get(line.productId);
    return product ? { ...line, piecePrice: String(sellingPrice(product, mode)) } : line;
  });
}

export function updateSaleDraftLine<T extends SaleDraftLine>(lines: T[], productId: string, patch: Partial<T>): T[] {
  return lines.map(line => line.productId === productId ? { ...line, ...patch } : line);
}

export function validateSaleDraft(lines: SaleDraftLine[], products: Product[], warehouseId?: string, businessDate?: string) {
  const errors: string[] = [];
  const invalidProductIds = new Set<string>();
  for (const line of lines) {
    const product = products.find(item => item.id === line.productId);
    if (!product) {
      errors.push("أحد المنتجات لم يعد متاحًا.");
      invalidProductIds.add(line.productId);
      continue;
    }
    if (isProductExpired(product, businessDate)) {
      errors.push(`${product.name}: انتهت صلاحية هذا المنتج ولا يمكن بيعه.`);
      invalidProductIds.add(product.id);
    }
    const quantity = Number(line.quantity), price = Number(line.piecePrice);
    const available = Number(product.stocks?.[warehouseId ?? ""] ?? 0);
    if (line.quantity.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`${product.name}: الكمية غير صالحة ويجب أن تكون أكبر من صفر.`);
      invalidProductIds.add(product.id);
    } else if (quantity > available) {
      errors.push(`الكمية المطلوبة لمنتج «${product.name}» هي ${quantity} والمتوفر ${available} فقط.`);
      invalidProductIds.add(product.id);
    }
    if (line.piecePrice.trim() === "" || !Number.isFinite(price) || price <= 0) {
      errors.push(`${product.name}: سعر البيع غير صالح ويجب أن يكون أكبر من صفر.`);
      invalidProductIds.add(product.id);
    } else if (product.lastPurchaseCost != null && price < product.lastPurchaseCost) {
      errors.push(`سعر بيع «${product.name}» أقل من تكلفة الشراء ${product.lastPurchaseCost}.`);
      invalidProductIds.add(product.id);
    }
  }
  return { errors, invalidProductIds };
}
