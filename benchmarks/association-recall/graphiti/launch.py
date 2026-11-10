"""Launch the native probe with an empty environment and scratch-only Unix IPC."""
import argparse, hashlib, json, os, subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--python', required=True, type=Path)
parser.add_argument('--source-dir', required=True, type=Path)
parser.add_argument('--lib-dir', required=True, type=Path)
parser.add_argument('--expat-dir', required=True, type=Path)
parser.add_argument('--output-dir', required=True, type=Path)
args = parser.parse_args()
base = Path(__file__).resolve().parent
root = args.output_dir.resolve()
root.mkdir(parents=True, exist_ok=False)
assert '"' not in str(root) and '\\' not in str(root)
pins = json.loads((base/'dependencies.json').read_text())
source = args.source_dir.resolve()
for relative, expected in pins['graphiti']['sourceFiles'].items():
    assert hashlib.sha256((source/relative).read_bytes()).hexdigest() == expected, relative
profile = '(version 1)\n(allow default)\n(deny network*)\n(allow network* (local unix-socket (path-prefix "' + str(root) + '/")) (remote unix-socket (path-prefix "' + str(root) + '/")))\n'
(root/'offline.sb').write_text(profile)
command = ['/usr/bin/sandbox-exec','-f',str(root/'offline.sb'),'/usr/bin/env',
    'DYLD_LIBRARY_PATH='+str(args.lib_dir.resolve())+':'+str(args.expat_dir.resolve()),
    str(args.python.resolve()),'-B',str(base/'run.py')]
environment = {'PATH':str(args.python.parent.resolve())+':/usr/bin:/bin','HOME':str(root),'TMPDIR':str(root),
    'PYTHONPATH':str(source),'GRAPHITI_TELEMETRY_ENABLED':'false','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1',
    'GM_GRAPHITI_RUN_ROOT':str(root),'GM_GRAPHITI_FIXTURE':str(base.parent/'fixture.json')}
# Resolving a venv's Python symlink loses the venv identity; retain the supplied executable path.
command[-3] = str(args.python.absolute())
with (root/'runtime.log').open('x') as log:
    completed = subprocess.run(command,cwd=root,env=environment,stdout=log,stderr=subprocess.STDOUT,timeout=120)
manifest = {'exitCode':completed.returncode,'sourceCommit':pins['graphiti']['commit'],
    'protocolSha256':hashlib.sha256((base/'protocol.json').read_bytes()).hexdigest(),
    'runnerSha256':hashlib.sha256((base/'run.py').read_bytes()).hexdigest(),
    'launcherSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'profile':profile,'profileSha256':hashlib.sha256(profile.encode()).hexdigest(),
    'logSha256':hashlib.sha256((root/'runtime.log').read_bytes()).hexdigest(),
    'sourceFilesVerified':len(pins['graphiti']['sourceFiles']),
    'networkBoundary':'All IP networking denied; only Unix sockets under this fresh scratch directory allowed.'}
(root/'launch.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'exitCode':completed.returncode,'output':str(root)}))
raise SystemExit(completed.returncode)
