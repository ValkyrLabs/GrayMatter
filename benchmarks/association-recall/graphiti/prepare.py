"""Acquire hash-pinned public artifacts into a fresh private environment. No host installs."""
import argparse, hashlib, json, os, subprocess, sys, tarfile, urllib.request
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--output-dir',required=True,type=Path)
parser.add_argument('--expat-dir',required=True,type=Path)
args=parser.parse_args()
assert sys.version_info[:2]==(3,12), 'Use CPython3.12 for the pinned macOS wheels'
root=args.output_dir.resolve();root.mkdir(parents=True,exist_ok=False)
base=Path(__file__).resolve().parent
pins=json.loads((base/'dependencies.json').read_text())
env={'PATH':'/usr/bin:/bin','HOME':str(root),'DYLD_LIBRARY_PATH':str(args.expat_dir.resolve()),
     'PIP_CONFIG_FILE':'/dev/null','PIP_DISABLE_PIP_VERSION_CHECK':'1'}
def acquire(url,digest,destination,bottle=False):
    assert url.startswith(('https://files.pythonhosted.org/','https://codeload.github.com/','https://ghcr.io/'))
    request=urllib.request.Request(url,headers={'Authorization':'Bearer QQ=='} if bottle else {})
    payload=urllib.request.urlopen(request,timeout=60).read()
    assert hashlib.sha256(payload).hexdigest()==digest,str(destination)
    destination.write_bytes(payload)
source=root/'graphiti.tar.gz'
acquire(pins['graphiti']['archiveUrl'],pins['graphiti']['archiveSha256'],source)
with tarfile.open(source) as archive:archive.extractall(root,filter='data')
source_dir=root/('graphiti-'+pins['graphiti']['commit'])
for relative,digest in pins['graphiti']['sourceFiles'].items():
    assert hashlib.sha256((source_dir/relative).read_bytes()).hexdigest()==digest
bottle=root/'libomp.tar.gz'
acquire(pins['libomp']['url'],pins['libomp']['sha256'],bottle,True)
with tarfile.open(bottle) as archive:archive.extractall(root/'native-libs',filter='data')
wheelhouse=root/'wheels';wheelhouse.mkdir()
for name,artifact in pins['dependencies'].items():
    filename=artifact['url'].rsplit('/',1)[1]
    assert filename.endswith('.whl'),filename
    acquire(artifact['url'],artifact['sha256'],wheelhouse/filename)
subprocess.run([sys.executable,'-m','venv',str(root/'venv')],env=env,check=True)
subprocess.run([str(root/'venv/bin/python'),'-m','pip','install','--no-index','--no-deps','--require-hashes',
    '--find-links',str(wheelhouse),'-r',str(base/'requirements.lock')],env=env,check=True)
print(json.dumps({'python':str(root/'venv/bin/python'),'sourceDir':str(source_dir),
    'libDir':str(root/'native-libs/libomp'/pins['libompVersion']/'lib'),
    'sourceMode':'Exact official source through PYTHONPATH; no wheel rebuild or upstream edits.'}))
