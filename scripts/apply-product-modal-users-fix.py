from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")

# Sidebar: named users no longer duplicate their username next to logout.
# Local/direct access keeps a locale-aware label through the existing dictionary.
replace_once(
    "app/conta-app.tsx",
    '<strong>{data.principal.name}</strong>',
    '{data.principal.principalType==="local"&&<strong>{tr("دخول مباشر")}</strong>}',
)

# User saves must have at least one permission for every non-owner account,
# and successful create/edit returns the form to a clean new-user state.
old_save = '''  const save=async()=>{setSaving(true);setError("");setSuccess("");try{const isEditing=!!editing;const response=await fetch(isEditing?`/api/settings/users/${editing.id}`:"/api/settings/users",{method:isEditing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password,...(isEditing?{isActive:active}:{}),permissions})});const result=await readApiResponse(response) as {user?:ManagedUser};const selectedId=editing?.id??result.user?.id;if(!selectedId)throw new Error(tr("تم الحفظ لكن تعذر تحديد المستخدم"));const refreshed=await load(selectedId);if(!refreshed)throw new Error(tr("تم الحفظ، لكن تعذر تحديث قائمة المستخدمين"));setSuccess(isEditing?tr("تم حفظ تعديلات المستخدم"):tr("تم إنشاء المستخدم بنجاح"))}catch(reason){setError(reason instanceof Error?translateApiError(locale,reason.message):tr("تعذر الحفظ"))}finally{setSaving(false)}};'''
new_save = '''  const save=async()=>{if(!editing?.owner&&permissions.length===0){setError(tr("يجب اختيار صلاحية واحدة على الأقل"));return}setSaving(true);setError("");setSuccess("");try{const isEditing=!!editing;const response=await fetch(isEditing?`/api/settings/users/${editing.id}`:"/api/settings/users",{method:isEditing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,password,...(isEditing?{isActive:active}:{}),permissions})});await readApiResponse(response);const refreshed=await load();if(!refreshed)throw new Error(tr("تم الحفظ، لكن تعذر تحديث قائمة المستخدمين"));const savedMessage=isEditing?tr("تم حفظ تعديلات المستخدم"):tr("تم إنشاء المستخدم بنجاح");select(null);setSuccess(savedMessage)}catch(reason){setError(reason instanceof Error?translateApiError(locale,reason.message):tr("تعذر الحفظ"))}finally{setSaving(false)}};'''
replace_once("app/conta-app.tsx", old_save, new_save)

old_disabled = 'disabled={saving||!username.trim()||(!editing&&password.length<4)||(!!password&&password.length<4)}'
new_disabled = 'disabled={saving||!username.trim()||(!editing&&password.length<4)||(!!password&&password.length<4)||(!editing?.owner&&permissions.length===0)}'
replace_once("app/conta-app.tsx", old_disabled, new_disabled)

# Product form category / opening-warehouse lists use the existing portal-aware floating select.
old_category = '<SearchableSelect value={categoryId} onChange={setCategoryId} options={categories.map(category => ({ value: category.id, label: category.name }))} placeholder={tr("بدون فئة")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty />'
new_category = '<SearchableSelect value={categoryId} onChange={setCategoryId} options={categories.map(category => ({ value: category.id, label: category.name }))} placeholder={tr("بدون فئة")} searchPlaceholder={tr("ابحث عن فئة")} allowEmpty floating />'
replace_once("app/conta-app.tsx", old_category, new_category)

old_warehouse = '<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} />'
new_warehouse = '<SearchableSelect value={openingWarehouseId} onChange={setOpeningWarehouseId} placeholder={tr("اختر المخزن")} searchPlaceholder={tr("ابحث عن مخزن")} options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} floating />'
replace_once("app/conta-app.tsx", old_warehouse, new_warehouse)

# Add the new validation message to both dictionaries next to the existing permission guidance.
replace_once(
    "app/i18n/messages.ts",
    '  "اختر الصلاحيات الفعلية المطلوبة": "اختر الصلاحيات الفعلية المطلوبة",',
    '  "اختر الصلاحيات الفعلية المطلوبة": "اختر الصلاحيات الفعلية المطلوبة",\n  "يجب اختيار صلاحية واحدة على الأقل": "يجب اختيار صلاحية واحدة على الأقل",',
)
replace_once(
    "app/i18n/messages.ts",
    '  "اختر الصلاحيات الفعلية المطلوبة": "Choisissez les autorisations réelles requises",',
    '  "اختر الصلاحيات الفعلية المطلوبة": "Choisissez les autorisations réelles requises",\n  "يجب اختيار صلاحية واحدة على الأقل": "Sélectionnez au moins une autorisation",',
)

# Only the product modal owns vertical scrolling. The page/overlay stays fixed, while
# floating dropdown results keep their own bounded internal list scrolling.
css = Path("app/globals.css")
css_text = css.read_text(encoding="utf-8")
marker = "/* Product modal scroll ownership and floating option lists. */"
if marker in css_text:
    raise SystemExit("globals.css: product modal fix already present")
css_text += '''\n\n/* Product modal scroll ownership and floating option lists. */\nhtml:has(.modal-overlay),body:has(.modal-overlay){overflow:hidden}\n.modal-overlay:has(.product-modal){padding:6px;overflow:hidden}\n.modal-card.product-modal{max-height:calc(100vh - 12px);overscroll-behavior:contain}\n.combobox-popover-floating .combobox-results{max-height:min(260px,calc(100vh - 110px));overflow-y:auto;overscroll-behavior:contain}\n'''
css.write_text(css_text, encoding="utf-8")

# Self-clean so the branch contains only the real application changes.
Path("scripts/apply-product-modal-users-fix.py").unlink(missing_ok=True)
Path(".github/workflows/apply-product-modal-users-fix.yml").unlink(missing_ok=True)
