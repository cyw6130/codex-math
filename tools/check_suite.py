#!/usr/bin/env python3
"""Check portable skill layout, local references, and runtime copies."""
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[1]
errors=[]; names=[]
for p in sorted((ROOT/'skills').glob('*/SKILL.md')):
    text=p.read_text()
    match=re.match(r'---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n',text)
    if not match or match[1]!=p.parent.name:errors.append(f'Invalid skill header: {p.relative_to(ROOT)}')
    else:names.append(match[1])
for p in [ROOT/'README.md',*(ROOT/'skills').rglob('*.md')]:
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if '://' in target or target.startswith('#'):continue
        target=target.split('#')[0]
        if target and not (p.parent/target).exists():errors.append(f'Broken link: {p.relative_to(ROOT)} -> {target}')
for name in ['article_flow.py','native_audit.py']:
    if (ROOT/'runtime'/name).read_bytes()!=(ROOT/'skills/shared'/name).read_bytes():errors.append(f'Divergent runtime copy: {name}')
if len(names)!=len(set(names)):errors.append('Duplicate skill name')
for error in errors:print(error)
print(f'{len(names)} skills; {len(errors)} errors')
sys.exit(bool(errors))
