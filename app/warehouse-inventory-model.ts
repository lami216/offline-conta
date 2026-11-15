import { inventoryValueAcrossWarehouses, type Product } from "./domain";

export type WarehouseInventorySummary = { count: number; pieces: number; value: number };

export function inventoryProductQuantity(product: Pick<Product, "stocks">, warehouseIds: string[]) {
  return warehouseIds.reduce((sum, id) => sum + Number(product.stocks[id] ?? 0), 0);
}

/** The grid, cards and output share the same current-stock filter.
 * Dates constrain the separate period movement columns only. */
export function buildWarehouseInventory({ products, warehouseIds, categoryId = "", query = "" }: {
  products: Product[]; warehouseIds: string[]; categoryId?: string; query?: string;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const summary: WarehouseInventorySummary = { count: 0, pieces: 0, value: 0 };
  const selected = products.filter(product => {
    if (categoryId && product.categoryId !== categoryId) return false;
    if (needle && !`${product.name} ${product.sku} ${product.barcode}`.toLocaleLowerCase().includes(needle)) return false;
    const quantity = inventoryProductQuantity(product, warehouseIds);
    if (!(quantity > 0)) return false;
    summary.count += 1;
    summary.pieces += quantity;
    summary.value += inventoryValueAcrossWarehouses(product, warehouseIds);
    return true;
  });
  return { products: selected, summary };
}

export function inventoryQuantityLabel(summary: WarehouseInventorySummary, labels: { pieces: string; format: (value: number) => string }) {
  return `${labels.format(summary.pieces)} ${labels.pieces}`;
}
