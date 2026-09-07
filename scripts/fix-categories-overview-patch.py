from pathlib import Path

p = Path('scripts/apply-categories-overview-report-i18n.py')
s = p.read_text(encoding='utf-8')

old = '''new_summary = ''' + "'''<div className=\"overview-summary-groups\">"
new = '''new_summary = ''' + "'''<div className=\"report-summary-area overview-summary-area\"><div className=\"overview-summary-groups\">"
if old not in s:
    raise SystemExit('overview summary replacement anchor not found')
s = s.replace(old, new, 1)

old = '''className=\"financial-amount-summary\"/></b></span></span></div></section></div>'''\nreplace_once('app/conta-app.tsx', old_summary, new_summary)'''
new = '''className=\"financial-amount-summary\"/></b></span></span></div></section></div></div>'''\nreplace_once('app/conta-app.tsx', old_summary, new_summary)'''
if old not in s:
    raise SystemExit('overview summary closing anchor not found')
s = s.replace(old, new, 1)

old = '''if ar_insert:\n    messages = messages[:ar_end] + '\\n' + ar_insert.rstrip('\\n') + messages[ar_end:]'''
new = '''if ar_insert:\n    before = messages[:ar_end].rstrip()\n    if not before.endswith(','):\n        before += ','\n    messages = before + '\\n' + ar_insert.rstrip('\\n') + messages[ar_end:]'''
if old not in s:
    raise SystemExit('Arabic insertion anchor not found')
s = s.replace(old, new, 1)

old = '''fr_part = messages[fr_start:fr_end]\nfor key, value in translations.items():'''
new = '''fr_part = messages[fr_start:fr_end].rstrip()\nif not fr_part.endswith(','):\n    fr_part += ','\nfor key, value in translations.items():'''
if old not in s:
    raise SystemExit('French insertion anchor not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('Adjusted report wrapper plus Arabic/French message insertion commas.')
