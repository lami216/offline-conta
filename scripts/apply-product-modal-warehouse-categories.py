from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected snippet not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# ProductCategory carries createdAt in persisted records; expose it for deterministic newest-first UI ordering.
replace_once(
    "app/domain.ts",
    '''export interface ProductCategory {\n  id: string;\n  name: string;\n}''',
    '''export interface ProductCategory {\n  id: string;\n  name: string;\n  createdAt?: string;\n}''',
)

# Let the shared searchable select optionally prefer opening upward and limit only its result list height.
replace_once(
    "app/conta-app.tsx",
    '''function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false, floating = false, variant = "normal", ariaLabel, triggerRef, onOpenChange }: {\n  value: string; onChange: (value: string) => void; options: SelectOption[];\n  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean; floating?: boolean; variant?: "normal" | "compact" | "pos-customer"; ariaLabel?: string; triggerRef?: Ref<HTMLButtonElement>; onOpenChange?: (open: boolean) => void;\n}) {''',
    '''function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false, floating = false, variant = "normal", ariaLabel, triggerRef, onOpenChange, preferUp = false, resultsMaxHeight }: {\n  value: string; onChange: (value: string) => void; options: SelectOption[];\n  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean; floating?: boolean; variant?: "normal" | "compact" | "pos-customer"; ariaLabel?: string; triggerRef?: Ref<HTMLButtonElement>; onOpenChange?: (open: boolean) => void; preferUp?: boolean; resultsMaxHeight?: number;\n}) {''',
)
replace_once(
    "app/conta-app.tsx",
    '''    const rect = root.current.getBoundingClientRect(), margin = 8, posCustomer = variant === "pos-customer", desiredHeight = Math.min(variant === "normal" ? 330 : 235, window.innerHeight - margin * 2);\n    const below = window.innerHeight - rect.bottom - margin, above = rect.top - margin, opensUp = below < 220 && above > below;''',
    '''    const rect = root.current.getBoundingClientRect(), margin = 8, posCustomer = variant === "pos-customer", desiredHeight = Math.min(resultsMaxHeight ? resultsMaxHeight + 62 : variant === "normal" ? 330 : 235, window.innerHeight - margin * 2);\n    const below = window.innerHeight - rect.bottom - margin, above = rect.top - margin, opensUp = preferUp ? above >= Math.min(desiredHeight, 120) : below < 220 && above > below;''',
)
replace_once(
    "app/conta-app.tsx",
    '''  }, [floating, variant]);''',
    '''  }, [floating, variant, preferUp, resultsMaxHeight]);''',
)
replace_once(
    "app/conta-app.tsx",
    '''    <div id={listId} className="combobox-results" role="listbox" aria-labelledby={searchId}>''',
    '''    <div id={listId} className="combobox-results" role="listbox" aria-labelledby={searchId} style={resultsMaxHeight ? { maxHeight: resultsMaxHeight, overflowY: "auto", overscrollBehavior: "contain" } : undefined}>''',
)

# Hide the decorative Chromium scrollbar in the product modal while retaining scroll behavior if a short viewport ever needs it.
replace_once(
    "app/conta-app.tsx",
    '''    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : tr("إضافة منتج")}><div className="modal-card product-modal"><ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} categories={data.categories} close={() => setFormOpen(false)} /></div></div>}''',
    '''    {formOpen && <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={editing ? `تعديل ${editing.name}` : tr("إضافة منتج")}><style>{`.product-modal{scrollbar-width:none;-ms-overflow-style:none}.product-modal::-webkit-scrollbar{display:none}`}</style><div className="modal-card product-modal"><ProductForm run={run} product={editing} warehouses={activeWarehouses(data.warehouses)} categories={data.categories} close={() => setFormOpen(false)} /></div></div>}''',
)

# Warehouse opening-stock picker: open above the trigger when possible, show roughly three rows, then scroll internally.
replace_once(
    "app/conta-app.tsx",
    '''{val(openingStock) > 0 && <label>{tr("مخزن رصيد البداية")}<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} floating /></label>}''',
    '''{val(openingStock) > 0 && <label>{tr("مخزن رصيد البداية")}<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} floating preferUp resultsMaxHeight={126} /></label>}''',
)

# Category dialog: deterministic newest-first order and a compact 4-column grid (3 columns for longer names).
replace_once(
    "app/product-category-dialog.tsx",
    '''.product-category-grid{display:flex;flex-wrap:wrap;align-items:flex-start;gap:7px;max-height:190px;overflow:auto;padding:2px}\n.product-category-card{position:relative;display:grid;place-items:center;min-width:92px;max-width:190px;min-height:34px;padding:6px 31px;border:1px solid var(--line);border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(20,49,47,.04);transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}''',
    '''.product-category-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:start;gap:7px;max-height:190px;overflow:auto;padding:2px}\n.product-category-grid.wide-names{grid-template-columns:repeat(3,minmax(0,1fr))}\n.product-category-card{position:relative;display:grid;place-items:center;width:100%;min-width:0;max-width:none;min-height:34px;padding:6px 31px;border:1px solid var(--line);border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(20,49,47,.04);transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}''',
)
replace_once(
    "app/product-category-dialog.tsx",
    '''.product-category-edit-card{display:grid;grid-template-columns:minmax(110px,1fr) auto auto;align-items:center;gap:4px;min-width:190px;min-height:34px;padding:3px;border:1px solid #a9c9c5;border-radius:10px;background:#fbfdfd;box-shadow:0 3px 10px rgba(20,49,47,.08)}''',
    '''.product-category-edit-card{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:4px;width:100%;min-width:0;min-height:34px;padding:3px;border:1px solid #a9c9c5;border-radius:10px;background:#fbfdfd;box-shadow:0 3px 10px rgba(20,49,47,.08)}''',
)
replace_once(
    "app/product-category-dialog.tsx",
    '''@media(max-width:520px){.product-category-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.product-category-card{width:100%;min-width:0;max-width:none}.product-category-edit-card{min-width:0}}''',
    '''@media(max-width:520px){.product-category-grid,.product-category-grid.wide-names{grid-template-columns:repeat(2,minmax(0,1fr))}.product-category-card{width:100%;min-width:0;max-width:none}.product-category-edit-card{min-width:0}}''',
)
replace_once(
    "app/product-category-dialog.tsx",
    '''  const [editingName, setEditingName] = useState("");\n\n  const submit = async (event: FormEvent) => {''',
    '''  const [editingName, setEditingName] = useState("");\n  const sortedCategories = [...categories].sort((a, b) => {\n    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NaN, bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;\n    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;\n    return categories.indexOf(b) - categories.indexOf(a);\n  });\n  const hasWideCategoryNames = sortedCategories.some(category => category.name.trim().length > 14);\n\n  const submit = async (event: FormEvent) => {''',
)
replace_once(
    "app/product-category-dialog.tsx",
    '''    <div className="product-category-list"><strong>{tr("الفئات الحالية")}</strong>{categories.length ? <div className="product-category-grid">{categories.map(category => editingId === category.id ?''',
    '''    <div className="product-category-list"><strong>{tr("الفئات الحالية")}</strong>{sortedCategories.length ? <div className={`product-category-grid${hasWideCategoryNames ? " wide-names" : ""}`}>{sortedCategories.map(category => editingId === category.id ?''',
)

print("Scoped product modal, warehouse picker, and category layout patch applied.")
