#!/usr/bin/env python3
"""Build only the hosted OpenAI submission package from canonical sources."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import struct
import tempfile
import zipfile
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'openai-app' / 'hosted-submission'
PLUGIN_NAME = 'app-6a590a1720808191b3909ed57132a25d'
ENDPOINT = 'https://api-0.valkyrlabs.com/graymatter/mcp'
SKILLS = ('graymatter-onboarding', 'graymatter-context', 'graymatter-memory')
TOOLS = {'memory_search', 'memory_get', 'memory_save', 'memory_update',
         'memory_forget', 'context_compile', 'procedure_search', 'retrieval_receipt_get'}
FILES = {'.codex-plugin/plugin.json': SOURCE / '.codex-plugin' / 'plugin.json',
         '.mcp.json': SOURCE / '.mcp.json',
         'assets/graymatter-logo.png': ROOT / 'assets' / 'graymatter-logo.png'}
for skill in SKILLS:
    for name in ('SKILL.md', 'agents/openai.yaml'):
        FILES[f'skills/{skill}/{name}'] = ROOT / 'skills' / skill / name

def require(condition, message):
    if not condition:
        raise ValueError(message)

def https(value, label):
    parsed = urlparse(value)
    require(parsed.scheme == 'https' and bool(parsed.netloc) and not parsed.username
            and not parsed.password and len(value) <= 1024, f'{label} must be public HTTPS without credentials')

def validate(manifest, mcp, files):
    require(not {'apps', 'hooks'} & manifest.keys(), 'App references and hooks cannot enter the hosted package')
    require(manifest['name'] == PLUGIN_NAME, 'Match the verified existing plugin package name')
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?', manifest['version']), 'Use a semantic version')
    require(manifest['skills'] == './skills/' and manifest['mcpServers'] == './.mcp.json', 'Use the hosted component paths')
    interface = manifest['interface']
    for field, limit in [('displayName', 30), ('shortDescription', 30), ('developerName', 80)]:
        require(isinstance(interface[field], str) and 0 < len(interface[field]) <= limit
                and '\n' not in interface[field], f'{field} exceeds its listing limit')
    require(interface['developerName'] == 'Valkyr Labs Inc', 'Match the verified business identity')
    require(0 < len(interface['longDescription']) <= 4000, 'Long description exceeds its limit')
    require(interface['category'] == 'Productivity', 'Preserve the saved category')
    require('screenshots' not in interface, 'This MCP surface has no custom UI')
    require(len(interface.get('capabilities', [])) <= 20, 'Too many capabilities')
    for capability in interface.get('capabilities', []):
        require(isinstance(capability, str) and 0 < len(capability) <= 120 and '\n' not in capability, 'Invalid capability')
    for field in ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']:
        https(interface[field], field)
    prompts = interface['defaultPrompt']
    require(len(prompts) <= 3 and len(set(prompts)) == len(prompts), 'Use up to three unique starter prompts')
    require(all(isinstance(p, str) and 0 < len(p) <= 128 and '\n' not in p and '@' not in p for p in prompts), 'Invalid starter prompt')
    servers = mcp.get('mcpServers', {})
    require(set(servers) == {'graymatter'} and servers['graymatter'] == {'url': ENDPOINT}, 'Use exactly the existing production HTTPS MCP endpoint')
    review = manifest['extensions']['com.openai']['review']
    require('test_credentials' not in review and 'reviewer_instructions' not in review, 'Reviewer access stays in the secure portal')
    require(review['commerce'] is False, 'Preserve the existing no-commerce setting')
    https(review['demo_recording_url'], 'Demo recording')
    cases = review['test_cases']
    require(len(cases['positive']) == 5 and len(cases['negative']) == 3, 'Keep exactly five positive and three negative cases')
    covered = set()
    for case in cases['positive']:
        require(set(case) == {'description', 'prompt', 'tools_triggered', 'expected_behavior'}, 'Unexpected positive-case fields')
        require(all(isinstance(v, str) and v.strip() for v in case.values()), 'Incomplete positive case')
        require(len(case['description']) <= 4000, 'Test description exceeds its limit')
        tokens = set(re.split(r'[\s,]+', case['tools_triggered'])) - {'or', ''}
        require(tokens <= TOOLS, 'Review case references an unsubmitted tool')
        covered |= tokens
    require(covered == TOOLS, 'Review cases must cover exactly the eight public tools')
    for case in cases['negative']:
        require(set(case) == {'description', 'prompt'} and all(isinstance(v, str) and v.strip() for v in case.values()), 'Incomplete negative case')
    expected = {'.codex-plugin/plugin.json', '.mcp.json', 'assets/graymatter-logo.png'} | {
        f'skills/{skill}/{name}' for skill in SKILLS for name in ('SKILL.md', 'agents/openai.yaml')}
    require(set(files) == expected, 'Only the two manifests, logo, and three skills may be packaged')
    for field in ['logo', 'composerIcon']:
        require(interface[field] == './assets/graymatter-logo.png', 'Use the existing canonical square logo')
    for name, content in files.items():
        require(not name.startswith('/') and '..' not in Path(name).parts, 'Unsafe archive path')
        if name.endswith('.png'):
            require(content.startswith(b'\x89PNG\r\n\x1a\n') and len(content) <= 5 * 1024 * 1024, 'Invalid logo PNG')
            width, height = struct.unpack('>II', content[16:24])
            require(width == height and 48 <= width <= 4096, 'Logo must be square and meet current ZIP image limits')
        else:
            text = content.decode('utf-8')
            require(not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|VALKYR_AUTH_TOKEN=|Bearer [A-Za-z0-9._~+/=-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', text), 'Secret-shaped data cannot enter the package')
    for skill in SKILLS:
        text = files[f'skills/{skill}/SKILL.md'].decode('utf-8')
        require(text.startswith('---\n'), 'Skill needs YAML front matter')
        front, body = text[4:].split('\n---\n', 1)
        require(f'name: {skill}' in front and 'description:' in front and body.strip(), 'Invalid skill identity or body')
        agent = files[f'skills/{skill}/agents/openai.yaml'].decode('utf-8')
        require('interface:' in agent and 'display_name:' in agent and 'short_description:' in agent, 'Skill interface metadata is incomplete')

def load():
    files = {}
    for name, source in FILES.items():
        require(source.is_file() and not source.is_symlink() and source.resolve().is_relative_to(ROOT), 'Package source must be a canonical regular file: ' + name)
        files[name] = source.read_bytes()
    manifest = json.loads(files['.codex-plugin/plugin.json'])
    mcp = json.loads(files['.mcp.json'])
    validate(manifest, mcp, files)
    return manifest, files

def build(output):
    manifest, files = load()
    output = Path(output).resolve()
    require(output.suffix == '.zip' and output not in [p.resolve() for p in FILES.values()], 'Output must be a separate ZIP')
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.graymatter-openai-', suffix='.zip', dir=output.parent)
    os.close(handle)
    try:
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(files):
                entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, files[name], compresslevel=9)
        with zipfile.ZipFile(temporary) as archive:
            require(archive.testzip() is None and set(archive.namelist()) == set(files), 'Archive verification failed')
            for name, content in files.items():
                require(archive.read(name) == content, 'Archive bytes differ from canonical source')
        os.replace(temporary, output)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()
    return {'output': str(output), 'bytes': output.stat().st_size,
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'entries': sorted(files),
            'version': manifest['version'], 'skills': list(SKILLS), 'toolsCovered': sorted(TOOLS),
            'productionDeployed': False, 'portalUploaded': False, 'submitted': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest, files = load()
    if args.check:
        print(json.dumps({'validated': True, 'entries': sorted(files), 'version': manifest['version']}, indent=2))
        return
    output = args.output or ROOT / 'dist' / 'openai-submission' / f'graymatter-{manifest["version"]}-openai.zip'
    print(json.dumps(build(output), indent=2))

if __name__ == '__main__':
    main()
