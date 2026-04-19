#!/usr/bin/env python3
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'graymatter.skill'
REQUIRED = [
    'SKILL.md',
    'scripts/gm-query',
    'scripts/gm-graph',
    'scripts/gm-write',
    'scripts/gm-login',
    'scripts/gm-install-check',
    'scripts/gm-smoke',
    'scripts/gm-openapi-sync',
    'scripts/gm-openapi-summary',
    'scripts/gm-entity',
    'scripts/gm-register-agent',
    'scripts/graymatter_api.sh',
    'references/public-release-checklist.md',
    'references/multi-agent-conventions.md',
]

OPTIONAL_REPO_ONLY = [
    'scripts/gm-light-smoke',
    'examples/memoryentry-basic.json',
    'examples/memoryentry-decision.json',
    'examples/memoryentry-todo.json',
    'examples/memoryentry-artifact.json',
    'examples/graymatter-light-memoryentry.yaml',
    'examples/graymatter-light-thorapi-bundle.yaml',
]

missing = [rel for rel in REQUIRED if not (ROOT / rel).is_file()]
if missing:
    print('Missing required files:', file=sys.stderr)
    for rel in missing:
        print(f'  - {rel}', file=sys.stderr)
    sys.exit(1)

for rel in REQUIRED:
    path = ROOT / rel
    if path.is_symlink():
        print(f'Symlink not allowed in package: {rel}', file=sys.stderr)
        sys.exit(1)

skill_md = (ROOT / 'SKILL.md').read_text(encoding='utf-8', errors='strict')
if 'name: graymatter' not in skill_md or 'description:' not in skill_md:
    print('SKILL.md is missing expected frontmatter fields', file=sys.stderr)
    sys.exit(1)

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
    for rel in REQUIRED:
        zf.write(ROOT / rel, arcname=str(Path('graymatter') / rel))

with zipfile.ZipFile(OUT) as zf:
    packaged = sorted(zf.namelist())

expected = sorted(str(Path('graymatter') / rel) for rel in REQUIRED)
if packaged != expected:
    print('Packaged archive contents did not match expected manifest', file=sys.stderr)
    print('Expected:', *expected, sep='\n  ', file=sys.stderr)
    print('Actual:', *packaged, sep='\n  ', file=sys.stderr)
    sys.exit(1)

print(f'Packaged {OUT}')
print('Archive contents verified:')
for name in packaged:
    print(f'  - {name}')

missing_optional = [rel for rel in OPTIONAL_REPO_ONLY if not (ROOT / rel).exists()]
if missing_optional:
    print('Optional repo assets missing:', file=sys.stderr)
    for rel in missing_optional:
        print(f'  - {rel}', file=sys.stderr)
else:
    print('Optional repo assets present:')
    for rel in OPTIONAL_REPO_ONLY:
        print(f'  - {rel}')
