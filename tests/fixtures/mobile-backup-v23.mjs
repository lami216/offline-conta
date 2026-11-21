// Synthetic data follows approved-runtime@1efa3058, Android versionCode23.
// No customer data, activation, live passwords or device settings are included.
export const mobileBackupV23Expected = {
  productId: 'mobile23:product:1', secondProductId: 'mobile23:product:2',
  customerId: 'mobile23:party:1', supplierId: 'mobile23:party:2',
  accountId: 'mobile23:account:1', bankId: 'mobile23:account:2',
  saleId: 'mobile23:record:117', voidedSaleId: 'mobile23:record:113',
  cash: 982, bank: 215, customerReceivable: 120, supplierPayable: 190,
  sales: 72, cost: 35, profit: 37, purchases: 60, expenses: 20,
  inventory: 160, firstMainStock: 10, firstOtherStock: 4, secondMainStock: 4,
};

export function mobileBackupV23() {
  const line = (product, qty, price, extra = {}) => ({ product, name: product === 1 ? 'سلعة تجريبية' : 'رصيد تجريبي', qty, price, ...extra });
  const record = (id, kind, total, extra = {}) => ({ id, kind, date: `2026-11-${String(id - 100).padStart(2, '0')}`, time: '10:15', total, paid: 0, due: 0, lines: [], title: `سند تجريبي ${id}`, revision: 0, ...extra });
  const originalPurchase = record(101, 'purchase', 30, { paid: 30, account: 1, party: 2, warehouse: 'الرئيسي', number: '1', sequence: 1, lines: [line(1, 3, 10)] });
  const records = [
    record(101, 'purchase', 40, { paid: 40, account: 1, party: 2, warehouse: 'الرئيسي', number: '1', sequence: 1, revision: 1, revisions: [originalPurchase], createdAt: '2026-11-01T10:15:00.000Z', updatedAt: '2026-11-02T11:00:00.000Z', lines: [line(1, 4, 10, { costAtSale: 9 })] }),
    record(102, 'sale', 60, { due: 60, party: 1, warehouse: 'الرئيسي', number: '1', sequence: 1, profit: 30, lines: [line(1, 3, 20, { costAtSale: 10 })] }),
    record(103, 'receive', 30, { paid: 30, account: 1, party: 1, note: 'استلام عميل\nTexte littéral' }),
    record(104, 'pay', 10, { paid: 10, account: 1, party: 1, note: 'إرجاع للعميل' }),
    record(105, 'expense', 20, { paid: 20, account: 1, number: '1', sequence: 1, title: 'نقل تجريبي', note: 'مصروف محفوظ' }),
    record(106, 'deposit', 50, { paid: 50, account: 1 }),
    record(107, 'withdraw', 15, { paid: 15, account: 1, note: 'سحب محفوظ' }),
    record(108, 'transfer', 25, { paid: 25, account: 1, to: 2, note: 'تحويل بين حسابين' }),
    record(109, 'stocktransfer', 20, { from: 'الرئيسي', toWarehouse: 'الفرعي', lines: [line(1, 2, 10, { delta: 0 })] }),
    record(110, 'adjustment', 10, { warehouse: 'الرئيسي', newQty: 8, note: 'جرد تجريبي', lines: [line(1, 1, 10, { delta: -1, actualQuantity: 8 })] }),
    record(111, 'offset', 20, { party: 1, otherParty: 2, note: 'تقاص تاريخي غير نقدي' }),
    record(112, 'adjustment', 0, { warehouse: 'الرئيسي', number: 'OPEN-2', openingStock: true, newQty: 5, title: 'رصيد بداية', lines: [line(2, 5, 5, { delta: 5 })] }),
    record(113, 'sale', 20, { paid: 20, account: 1, party: 1, warehouse: 'الرئيسي', number: '2', sequence: 2, profit: 10, voided: true, lines: [line(1, 1, 20, { costAtSale: 10 })] }),
    record(114, 'purchase', 20, { due: 20, party: 2, warehouse: 'الرئيسي', number: '2', sequence: 2, lines: [line(1, 2, 10, { costAtSale: 10 })] }),
    record(115, 'receive', 10, { paid: 10, account: 2, party: 2 }),
    record(116, 'pay', 20, { paid: 20, account: 2, party: 2 }),
    record(117, 'sale', 12, { paid: 12, account: 1, warehouse: 'الرئيسي', number: '3', sequence: 3, profit: 7, lines: [line(2, 1, 12, { costAtSale: 5 })] }),
  ];
  const stockEvents = [
    { productId: '1', documentId: 'legacy-1', warehouseId: 'الرئيسي', quantityDelta: 10, type: 'legacy-opening' },
    { productId: '1', documentId: 'legacy-1', warehouseId: 'الفرعي', quantityDelta: 2, type: 'legacy-opening' },
  ];
  let stockEventSequence = 0;
  const stockEvent = (r, l, warehouseId, quantityDelta, type, revision) => stockEvents.push({ productId: String(l.product), documentId: String(r.id), documentRevision: revision, warehouseId, quantityDelta, type, at: `${r.date}T10:15:00.000Z` });
  for (const r of records) {
    // stock-domain.recordStockEvents allocates once per invocation: every line
    // and both transfer legs share it. Edit undo and re-post are two invocations.
    const originalRevision = r.id === 101 ? ++stockEventSequence : null;
    const undoRevision = r.id === 101 ? ++stockEventSequence : null;
    const revision = ++stockEventSequence, voidRevision = r.voided ? ++stockEventSequence : null;
    for (const l of r.lines) {
    if (r.kind === 'sale' || r.kind === 'purchase') {
      const sign = r.kind === 'sale' ? -1 : 1;
      if (r.id === 101) { stockEvent(r, { ...l, qty: 3 }, r.warehouse, 3, 'purchase', originalRevision); stockEvent(r, { ...l, qty: 3 }, r.warehouse, -3, 'purchase-edit', undoRevision); }
      stockEvent(r, l, r.warehouse, sign * l.qty, r.id === 101 ? 'purchase-edit' : r.kind, revision);
      if (r.voided) stockEvent(r, l, r.warehouse, -sign * l.qty, `${r.kind}-void`, voidRevision);
    } else if (r.kind === 'adjustment') stockEvent(r, l, l.warehouse || r.warehouse, l.delta, r.openingStock ? 'opening' : 'adjustment', revision);
    else if (r.kind === 'stocktransfer') { stockEvent(r, l, r.from, -l.qty, 'transfer-out', revision); stockEvent(r, l, r.toWarehouse, l.qty, 'transfer-in', revision); }
    }
  }
  const publicUser = { id: 'synthetic-mobile-owner', name: 'مالك تجريبي', username: 'synthetic', role: 'owner', active: true, capabilities: [] };
  return {
    format: 'alkarna-web-backup', schemaVersion: 1, createdAt: '2026-11-21T10:30:00.000Z',
    state: {
      featureSchema: 2, originId: 'synthetic-mobile23-shop', branding: 'محل تجريبي Mobile',
      brandInfo: { phone: '', address: '', footer: 'بيانات وهمية فقط' },
      currency: { code: 'MRU', availableCodes: ['MRU'] }, categories: [{ id: 1, name: 'عام' }],
      warehouses: ['الرئيسي', 'الفرعي'], warehouse: 'الرئيسي', salesWarehouse: 'الرئيسي',
      warehouseMeta: { الرئيسي: { archived: false }, الفرعي: { archived: false } },
      accounts: [{ id: 1, name: 'نقدي تجريبي', balance: 982, openingBalance: 1000, active: true }, { id: 2, name: 'بنك تجريبي', balance: 215, openingBalance: 200, active: true }],
      parties: [{ id: 1, name: 'عميل تجريبي', phone: '', type: 'customer', balance: 120 }, { id: 2, name: 'مورد تجريبي', phone: '', type: 'supplier', balance: 190 }],
      products: [
        { id: 1, name: 'سلعة تجريبية', sku: '001', price: 20, wholesale: 18, cost: 10, openingCost: 10, categoryId: 1, stocks: { الرئيسي: 10, الفرعي: 4 }, qty: 10 },
        { id: 2, name: 'رصيد تجريبي', sku: '002', price: 12, wholesale: 11, cost: 5, openingCost: 5, openingTotal: 5, openingWarehouse: 'الرئيسي', categoryId: 1, stocks: { الرئيسي: 4, الفرعي: 0 }, qty: 4 },
      ],
      records: records.reverse(), stockEvents, stockEventSequence, sequences: { sale: 3, purchase: 2, expense: 1 },
      opening: { accounts: { 1: 1000, 2: 200 }, parties: { 1: 100, 2: 200 }, stocks: { 1: { الرئيسي: 10, الفرعي: 2 }, 2: { الرئيسي: 0, الفرعي: 0 } } },
      users: [publicUser], auditEvents: [],
    },
    users: [{ ...publicUser, password: { algorithm: 'PBKDF2-SHA256', iterations: 210000, salt: '00'.repeat(16), hash: '11'.repeat(32) }, createdAt: '2026-11-01T00:00:00.000Z' }],
  };
}
