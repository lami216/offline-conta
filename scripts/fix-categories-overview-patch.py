from pathlib import Path

p = Path('scripts/apply-categories-overview-report-i18n.py')
s = p.read_text(encoding='utf-8')

old = '''new_summary = ''' + "'''<div className=\"overview-summary-groups\">"
new = '''new_summary = ''' + "'''<div className=\"report-summary-area overview-summary-area overview-summary-groups\">"
if old not in s:
    raise SystemExit('overview summary replacement anchor not found')
s = s.replace(old, new, 1)

old = '''if ar_insert:\n    messages = messages[:ar_end] + '\\n' + ar_insert.rstrip('\\n') + messages[ar_end:]'''
new = '''if ar_insert:\n    before = messages[:ar_end].rstrip()\n    if not before.endswith(','):\n        before += ','\n    messages = before + '\\n' + ar_insert.rstrip('\\n') + messages[ar_end:]'''
if old not in s:
    raise SystemExit('Arabic insertion anchor not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('Adjusted summary compatibility class and Arabic message insertion comma.')
