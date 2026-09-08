from pathlib import Path

path = Path('app/conta-app.tsx')
text = path.read_text(encoding='utf-8')

old = '''function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false, floating = false, variant = "normal", ariaLabel, triggerRef }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean; floating?: boolean; variant?: "normal" | "compact" | "pos-customer"; ariaLabel?: string; triggerRef?: Ref<HTMLButtonElement>;
}) {'''
new = '''function SearchableSelect({ value, onChange, options, placeholder, searchPlaceholder, disabled = false, allowEmpty = false, floating = false, variant = "normal", ariaLabel, triggerRef, onOpenChange }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  placeholder: string; searchPlaceholder: string; disabled?: boolean; allowEmpty?: boolean; floating?: boolean; variant?: "normal" | "compact" | "pos-customer"; ariaLabel?: string; triggerRef?: Ref<HTMLButtonElement>; onOpenChange?: (open: boolean) => void;
}) {'''
assert old in text, 'SearchableSelect signature not found'
text = text.replace(old, new, 1)

old = '''  const closeSelect = useCallback((restoreFocus = false) => { setOpen(false); setQuery(""); setHighlightedIndex(null); setFloatingStyle({}); if (restoreFocus) window.requestAnimationFrame(() => ownTriggerRef.current?.focus()); }, []);
  const openSelect = () => { position(); setHighlightedIndex(null); setOpen(true); };'''
new = '''  const closeSelect = useCallback((restoreFocus = false) => { setOpen(false); setQuery(""); setHighlightedIndex(null); setFloatingStyle({}); onOpenChange?.(false); if (restoreFocus) window.requestAnimationFrame(() => ownTriggerRef.current?.focus()); }, [onOpenChange]);
  const openSelect = () => { position(); setHighlightedIndex(null); setOpen(true); onOpenChange?.(true); };'''
assert old in text, 'SearchableSelect open/close block not found'
text = text.replace(old, new, 1)

old = '''  const [selected, setSelected] = useState<string | null>(null), listId = useId();
  const term = query.trim().toLocaleLowerCase();
  const results = useMemo(() => term ? data.products.filter(product => !product.isArchived).map((product, index) => {'''
new = '''  const [selected, setSelected] = useState<string | null>(null), [categoryId, setCategoryId] = useState(""), [categoryOpen, setCategoryOpen] = useState(false), listId = useId();
  const term = query.trim().toLocaleLowerCase();
  const categoryFiltering = mode === "sale" || mode === "purchase";
  const categoryOptions = useMemo(() => data.categories.map(category => ({ value: category.id, label: category.name, search: category.name })), [data.categories]);
  const results = useMemo(() => term ? data.products.filter(product => !product.isArchived && (!categoryFiltering || !categoryId || product.categoryId === categoryId)).map((product, index) => {'''
assert old in text, 'ProductSearchPicker state/results block not found'
text = text.replace(old, new, 1)

old = '''  }).filter(item => item.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 30).map(item => item.product) : [], [data.products, term]);'''
new = '''  }).filter(item => item.matches).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 30).map(item => item.product) : [], [data.products, term, categoryFiltering, categoryId]);'''
assert old in text, 'ProductSearchPicker memo deps not found'
text = text.replace(old, new, 1)

old = '''  return <div className="product-picker product-search-grid">
    <label className="search compact-search"><Search /><input ref={inputRef} role="combobox" aria-label={tr("بحث المنتج")} aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls={listId} aria-activedescendant={selected ? `product-result-${selected}` : undefined} disabled={stockScope === "selected-warehouse" && !warehouseId} value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} onKeyDown={onSearchKeyDown} placeholder={stockScope === "selected-warehouse" && !warehouseId ? tr("اختر المخزن أولًا") : tr("ابحث بالاسم أو الكود أو الباركود")} /></label>
    {(!collapseResultsWhenIdle || term) && (results.length ? <div id={listId} className="erp-table-wrap picker-results" role="listbox">'''
new = '''  return <div className="product-picker product-search-grid">
    <div style={{display:"grid",gridTemplateColumns:categoryFiltering?"minmax(0,1fr) minmax(170px,0.42fr)":"minmax(0,1fr)",gap:8,alignItems:"start"}}>
      <label className="search compact-search"><Search /><input ref={inputRef} role="combobox" aria-label={tr("بحث المنتج")} aria-autocomplete="list" aria-expanded={!categoryOpen && results.length > 0} aria-controls={listId} aria-activedescendant={selected ? `product-result-${selected}` : undefined} disabled={stockScope === "selected-warehouse" && !warehouseId} value={query} onChange={event => { setQuery(event.target.value); setSelected(null); }} onKeyDown={onSearchKeyDown} placeholder={stockScope === "selected-warehouse" && !warehouseId ? tr("اختر المخزن أولًا") : tr("ابحث بالاسم أو الكود أو الباركود")} /></label>
      {categoryFiltering&&<SearchableSelect value={categoryId} onChange={value=>{setCategoryId(value);setCategoryOpen(false);setSelected(null)}} options={categoryOptions} placeholder={tr("الفئات")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty floating variant="compact" ariaLabel={tr("الفئة")} onOpenChange={open=>{setCategoryOpen(open);if(!open)setCategoryId("")}}/>}
    </div>
    {!categoryOpen && (!collapseResultsWhenIdle || term) && (results.length ? <div id={listId} className="erp-table-wrap picker-results" role="listbox">'''
assert old in text, 'ProductSearchPicker render block not found'
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('patched app/conta-app.tsx')
