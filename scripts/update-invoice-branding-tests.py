from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one target")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "tests/official-documents.test.mjs",
    '{storeName:"الكرنه",storePhone:"",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800}',
    '{storeName:"الكرنه",storeLogoDataUrl:"",storePhone:"",storeAddress:"",registrationNumber:"",taxNumber:"",footerNote:"",nameFont:"tahoma",nameFontSize:24,nameFontWeight:800}',
)

replace_once(
    "tests/settings-payment-safety.test.mjs",
    '{ storeName: "متجر", storePhone: "", storeAddress: "", registrationNumber: "", taxNumber: "", footerNote: "", nameFont: "tahoma", nameFontSize: 24, nameFontWeight: 800 }',
    '{ storeName: "متجر", storeLogoDataUrl: "", storePhone: "", storeAddress: "", registrationNumber: "", taxNumber: "", footerNote: "", nameFont: "tahoma", nameFontSize: 24, nameFontWeight: 800 }',
)
