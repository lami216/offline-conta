from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_nth(path: str, old: str, new: str, occurrence: int):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    positions = []
    start = 0
    while True:
        pos = text.find(old, start)
        if pos < 0:
            break
        positions.append(pos)
        start = pos + len(old)
    if len(positions) < occurrence:
        raise SystemExit(f"{path}: occurrence {occurrence} not found for {old[:140]!r}; found {len(positions)}")
    pos = positions[occurrence - 1]
    text = text[:pos] + new + text[pos + len(old):]
    p.write_text(text, encoding="utf-8")


APP = "app/conta-app.tsx"
CSS = "app/globals.css"
PRINTING = "app/printing.css"
CONFIRM = "app/app-confirm.tsx"

# Keep the tooltip generic, but mark each missing reason semantically for regression/debugging.
replace_once(
    APP,
    'function BlockedAction({reasons,children}:{reasons:MissingRequirement[];children:ReactNode}){const tooltipId=useId(),blocked=reasons.length>0;return <span className={`blocked-action${blocked?" is-blocked":""}`} tabIndex={blocked?0:undefined} aria-describedby={blocked?tooltipId:undefined}>{children}{blocked&&<span id={tooltipId} role="tooltip" className="blocked-action-tooltip"><b>{tr("ناقص:")}</b>{reasons.map(reason=><span key={reason.id}>• {reason.label}</span>)}</span>}</span>}',
    'function BlockedAction({reasons,children}:{reasons:MissingRequirement[];children:ReactNode}){const tooltipId=useId(),blocked=reasons.length>0;return <span className={`blocked-action${blocked?" is-blocked":""}`} tabIndex={blocked?0:undefined} aria-describedby={blocked?tooltipId:undefined}>{children}{blocked&&<span id={tooltipId} role="tooltip" className="blocked-action-tooltip"><b>{tr("ناقص:")}</b>{reasons.map(reason=><span key={reason.id} data-missing-requirement={reason.id}>• {reason.label}</span>)}</span>}</span>}'
)

# The compact payment selector can visually identify only itself as missing.
replace_once(
    APP,
    'function CompactPaymentSelector({ accounts: suppliedAccounts, value, onChange, selectRef }: { accounts: PaymentAccount[]; value: string; onChange: (id: string) => void; selectRef?: Ref<HTMLSelectElement> }) {\n  return <div className="compact-payment" aria-label={tr("طريقة الدفع")}><PaymentAccountSelect accounts={suppliedAccounts} activeOnly selectRef={selectRef} value={value} onChange={onChange} placeholder={tr("اختر وسيلة الدفع")} aria-label={tr("وسيلة الدفع")}/></div>;\n}',
    'function CompactPaymentSelector({ accounts: suppliedAccounts, value, onChange, selectRef, missing=false }: { accounts: PaymentAccount[]; value: string; onChange: (id: string) => void; selectRef?: Ref<HTMLSelectElement>; missing?:boolean }) {\n  return <div className="compact-payment" data-requirement-missing={missing?"true":undefined} aria-label={tr("طريقة الدفع")}><PaymentAccountSelect accounts={suppliedAccounts} activeOnly selectRef={selectRef} value={value} onChange={onChange} placeholder={tr("اختر وسيلة الدفع")} aria-label={tr("وسيلة الدفع")}/></div>;\n}'
)

payment_selector = '<CompactPaymentSelector selectRef={paymentRef} accounts={data.paymentAccounts} value={payment} onChange={setPayment} />'
replace_nth(APP, payment_selector, '<CompactPaymentSelector selectRef={paymentRef} accounts={data.paymentAccounts} value={payment} onChange={setPayment} missing={lines.length>0&&payment!=="note"&&!payment} />', 1)
# After the first replacement, the remaining plain occurrence is now the purchase selector.
replace_once(APP, payment_selector, '<CompactPaymentSelector selectRef={paymentRef} accounts={data.paymentAccounts} value={payment} onChange={setPayment} missing={lines.length>0&&payment!=="note"&&!payment} />')

replace_once(
    APP,
    '<div className="pos-customer-compact">{customerSelect}</div>',
    '<div className="pos-customer-compact" data-requirement-missing={lines.length>0&&payment==="note"&&!partyId?"true":undefined}>{customerSelect}</div>'
)
replace_once(
    APP,
    '<div className="purchase-supplier"><SearchableSelect triggerRef={supplierRef}',
    '<div className="purchase-supplier" data-requirement-missing={lines.length>0&&payment==="note"&&!partyId?"true":undefined}><SearchableSelect triggerRef={supplierRef}'
)
replace_once(
    APP,
    '<label>{tr("مخزن الاستلام")}<SearchableSelect triggerRef={warehouseRef}',
    '<label data-requirement-missing={lines.length>0&&!warehouseId?"true":undefined}>{tr("مخزن الاستلام")}<SearchableSelect triggerRef={warehouseRef}'
)

# Sales/purchases: no warning while the invoice is empty. Once a product exists, list only genuinely missing prerequisites.
replace_once(
    APP,
    '<BlockedAction reasons={[...(!lines.length?[{id:"products",label:tr("منتج واحد على الأقل")}]:[]),...(!wh?[{id:"warehouse",label:tr("المخزن")}]:[]),...(payment==="note"&&!partyId?[{id:"customer",label:tr("العميل")}]:[]),...(payment!=="note"&&!payment?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]}>',
    '<BlockedAction reasons={lines.length?[...(!wh?[{id:"warehouse",label:tr("المخزن")}]:[]),...(payment==="note"&&!partyId?[{id:"customer",label:tr("العميل")}]:[]),...(payment!=="note"&&!payment?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]:[]}>')
replace_once(
    APP,
    '<BlockedAction reasons={[...(!lines.length?[{id:"products",label:tr("منتج واحد على الأقل")}]:[]),...(!warehouseId?[{id:"warehouse",label:tr("مخزن الاستلام")}]:[]),...(payment==="note"&&!partyId?[{id:"supplier",label:tr("المورد")}]:[]),...(payment!=="note"&&!payment?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]}>',
    '<BlockedAction reasons={lines.length?[...(!warehouseId?[{id:"warehouse",label:tr("مخزن الاستلام")}]:[]),...(payment==="note"&&!partyId?[{id:"supplier",label:tr("المورد")}]:[]),...(payment!=="note"&&!payment?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]:[]}>')

# Expenses: warning starts only after a title exists; highlight amount/date/payment independently.
replace_once(
    APP,
    '<label>{tr("المبلغ")}<Num value={amount} onChange={setAmount}/></label>',
    '<label data-requirement-missing={title.trim()&&val(amount)<=0?"true":undefined}>{tr("المبلغ")}<Num value={amount} onChange={setAmount}/></label>'
)
replace_once(
    APP,
    '<label>{tr("تاريخ المصروف")}<input required dir="ltr" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>',
    '<label data-requirement-missing={title.trim()&&!date?"true":undefined}>{tr("تاريخ المصروف")}<input required dir="ltr" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>'
)
replace_once(
    APP,
    '<label>{tr("وسيلة الدفع")}<PaymentAccountSelect required accounts={accounts} value={paymentMethod} onChange={setPaymentMethod}/></label>',
    '<label data-requirement-missing={title.trim()&&!paymentMethod?"true":undefined}>{tr("وسيلة الدفع")}<PaymentAccountSelect required accounts={accounts} value={paymentMethod} onChange={setPaymentMethod}/></label>'
)
replace_once(
    APP,
    '<BlockedAction reasons={[...(!title.trim()?[{id:"title",label:tr("عنوان المصروف")}]:[]),...(val(amount)<=0?[{id:"amount",label:tr("مبلغ صحيح")}]:[]),...(!date?[{id:"date",label:tr("التاريخ")}]:[]),...(!paymentMethod?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]}>',
    '<BlockedAction reasons={title.trim()?[...(val(amount)<=0?[{id:"amount",label:tr("مبلغ صحيح")}]:[]),...(!date?[{id:"date",label:tr("التاريخ")}]:[]),...(!paymentMethod?[{id:"payment",label:tr("وسيلة الدفع")}]:[])]:[]}>'
)

# Below-cost confirmation is a warning, not a green/normal confirmation.
replace_once(
    APP,
    'if (validation.warnings.length && !await confirmAction({title:tr("تنبيه البيع بأقل من التكلفة"),message:belowCostConfirmation(locale, validation.warnings)})) return;',
    'if (validation.warnings.length && !await confirmAction({title:tr("تنبيه البيع بأقل من التكلفة"),message:belowCostConfirmation(locale, validation.warnings),tone:"warning"})) return;'
)

replace_once(
    CONFIRM,
    'export type AppConfirmOptions={title?:string;message:string;confirmLabel?:string;cancelLabel?:string;tone?:"normal"|"danger"};',
    'export type AppConfirmOptions={title?:string;message:string;confirmLabel?:string;cancelLabel?:string;tone?:"normal"|"warning"|"danger"};'
)
replace_once(
    CONFIRM,
    '<div ref={dialogRef} className="app-confirm-dialog" role="dialog"',
    '<div ref={dialogRef} className={`app-confirm-dialog${request.options.tone==="warning"?" warning":""}`} role="dialog"'
)
replace_once(
    CONFIRM,
    'className={request.options.tone==="danger"?"danger":"primary"}',
    'className={request.options.tone==="danger"?"danger":request.options.tone==="warning"?"warn":"primary"}'
)

old_highlight = '.checkout-layout:has(.blocked-action.is-blocked:hover) :is(.pos-payment-row,.purchase-payment-row,.product-search-grid),.expense-form:has(.blocked-action.is-blocked:hover) .expense-fields>label{border-radius:6px;background:#fffbeb;box-shadow:0 0 0 2px #f59e0b66}'
new_highlight = ':is(.checkout-layout,.expense-form):has(.blocked-action.is-blocked:hover) [data-requirement-missing="true"],:is(.checkout-layout,.expense-form):has(.blocked-action.is-blocked:focus-visible) [data-requirement-missing="true"]{border-radius:6px;background:#fffbeb;box-shadow:0 0 0 2px #f59e0b66}'
replace_once(CSS, old_highlight, new_highlight)
replace_once(
    CSS,
    '.app-confirm-dialog{background:var(--panel,#fff);color:var(--text,#172033);width:min(440px,calc(100vw - 32px));padding:24px;border-radius:18px;box-shadow:0 24px 70px #0005;white-space:pre-line}',
    '.app-confirm-dialog{background:var(--panel,#fff);color:var(--text,#172033);width:min(440px,calc(100vw - 32px));padding:24px;border-radius:18px;box-shadow:0 24px 70px #0005;white-space:pre-line}.app-confirm-dialog.warning{border:2px solid #f0b74c;background:#fffbeb}.app-confirm-dialog.warning h2{color:#8a5510}'
)

# A4 small card: use a top-anchored, slightly zoomed thumbnail. The large click preview remains untouched/full-size.
replace_once(
    PRINTING,
    '.print-profile-preview.profile-a4 .official-record-sheet{width:760px!important;min-height:1075px;padding:26px 30px!important;transform:translate(-50%,-50%) scale(.132)!important}',
    '.print-profile-preview.profile-a4 .official-record-sheet{width:760px!important;min-width:760px!important;max-width:none!important;min-height:1075px;padding:26px 30px!important;top:6px!important;left:50%!important;transform:translateX(-50%) scale(.165)!important;transform-origin:top center!important}'
)
replace_once(
    PRINTING,
    '@media(max-width:760px){.print-profile-preview{height:120px}.print-profile-preview.profile-a4 .official-record-sheet{transform:translate(-50%,-50%) scale(.105)!important}.print-profile-preview.profile-thermal80 .official-record-sheet{transform:translate(-50%,-50%) scale(.19)!important}.print-profile-preview.profile-thermal58 .official-record-sheet{transform:translate(-50%,-50%) scale(.205)!important}}',
    '@media(max-width:760px){.print-profile-preview{height:120px}.print-profile-preview.profile-a4 .official-record-sheet{top:4px!important;transform:translateX(-50%) scale(.135)!important}.print-profile-preview.profile-thermal80 .official-record-sheet{transform:translate(-50%,-50%) scale(.19)!important}.print-profile-preview.profile-thermal58 .official-record-sheet{transform:translate(-50%,-50%) scale(.205)!important}}'
)

# Update the A4 regression expectation to match the intentional thumbnail behavior.
replace_once(
    "tests/printing.test.mjs",
    'test("A4 thumbnail fills the preview card and invoice header supports logo plus phones",()=>{assert.match(css,/profile-a4[\\s\\S]*scale\\(\\.132\\)/);assert.match(app,/official-record-logo/);assert.match(app,/official-brand-phone/);assert.match(app,/storeLogoDataUrl/);assert.match(app,/أرقام الهواتف/)});',
    'test("A4 thumbnail is top-anchored and readable while invoice header supports logo plus phones",()=>{assert.match(css,/profile-a4[\\s\\S]*top:6px!important[\\s\\S]*scale\\(\\.165\\)/);assert.match(css,/profile-a4[\\s\\S]*transform-origin:top center!important/);assert.match(app,/official-record-logo/);assert.match(app,/official-brand-phone/);assert.match(app,/storeLogoDataUrl/);assert.match(app,/أرقام الهواتف/)});'
)

Path("tests/validation-guidance.test.mjs").write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport {readFileSync} from "node:fs";\nconst app=readFileSync(new URL("../app/conta-app.tsx",import.meta.url),"utf8"),css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8"),confirm=readFileSync(new URL("../app/app-confirm.tsx",import.meta.url),"utf8");\n\ntest("sale and purchase missing guidance waits for a product and never reports the empty invoice itself",()=>{\n  const gated=[...app.matchAll(/<BlockedAction reasons=\{lines\.length\?/g)];\n  assert.equal(gated.length,2);\n  assert.doesNotMatch(app,/BlockedAction reasons=\{\[\.\.\.\(!lines\.length\?\[\{id:\"products\"/);\n});\n\ntest("expense missing guidance waits for a title",()=>{\n  assert.match(app,/BlockedAction reasons=\{title\.trim\(\)\?/);\n  assert.doesNotMatch(app,/BlockedAction reasons=\{\[\.\.\.\(!title\.trim\(\)\?/);\n});\n\ntest("only the currently missing controls receive amber guidance",()=>{\n  assert.match(app,/data-requirement-missing=/);\n  assert.match(css,/\[data-requirement-missing=\"true\"\]/);\n  assert.doesNotMatch(css,/blocked-action\.is-blocked:hover\) :is\(\.pos-payment-row,\.purchase-payment-row,\.product-search-grid\)/);\n  assert.doesNotMatch(css,/blocked-action\.is-blocked:hover\) \.expense-fields>label/);\n});\n\ntest("below-cost confirmation uses warning tone instead of the green primary tone",()=>{\n  assert.match(app,/belowCostConfirmation\(locale, validation\.warnings\),tone:\"warning\"/);\n  assert.match(confirm,/tone\?:\"normal\"\|\"warning\"\|\"danger\"/);\n  assert.match(confirm,/tone===\"warning\"\?\"warn\":\"primary\"/);\n});\n''', encoding="utf-8")
