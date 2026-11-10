"""Acquire pinned public artifacts into a disposable directory; no host install."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--artifact-cache',type=Path,
                        help='Optional earlier isolated setup. Every reused artifact is hash checked.')
    args=parser.parse_args()
    if sys.version_info[:2] != (3,12):
        raise SystemExit('Use CPython3.12 for the pinned macOS arm64 wheels')
    here=Path(__file__).resolve().parent
    dependencies=json.loads((here/'dependencies.json').read_text())
    root=args.output_dir.resolve();root.mkdir(exist_ok=False)
    cache=args.artifact_cache.resolve() if args.artifact_cache else None
    reused=[]

    def acquire(url,digest,target,cached=None):
        target.parent.mkdir(parents=True,exist_ok=True)
        if cached and cached.is_file() and sha(cached)==digest:
            shutil.copyfile(cached,target);reused.append(str(cached))
        else:
            with urllib.request.urlopen(url,timeout=180) as source, target.open('wb') as out:
                shutil.copyfileobj(source,out)
        assert sha(target)==digest, target
        return target

    source=dependencies['source']
    archive=acquire(source['url'],source['sha256'],root/'source.tar.gz',cache/'source.tar.gz' if cache else None)
    with tarfile.open(archive) as tar:
        prefix='hindsight-'+source['commit']+'/hindsight-api-slim/'
        tar.extractall(root,members=[m for m in tar.getmembers() if m.name.startswith(prefix)],filter='data')
    (root/'provenance.json').write_text(json.dumps(source,indent=2)+'\n')

    def wheel(item):
        name=item['url'].split('/')[-1]
        return acquire(item['url'],item['sha256'],root/'wheels'/name,cache/'wheels'/name if cache else None)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        list(executor.map(wheel,dependencies['packages']))
    shutil.copyfile(here/'requirements.lock',root/'requirements.lock')
    env=dict(os.environ)
    env['DYLD_LIBRARY_PATH']=dependencies['hostPrerequisites']['libexpat']
    subprocess.run([sys.executable,'-m','venv',str(root/'venv')],env=env,check=True)
    subprocess.run([str(root/'venv/bin/python'),'-m','pip','install','--no-index','--no-deps',
                    '--require-hashes','--find-links',str(root/'wheels'),'-r',str(root/'requirements.lock')],
                   env=env,check=True,stdout=subprocess.DEVNULL)

    def model(item):
        return acquire(item['url'],item['sha256'],root/'model'/item['file'],cache/'model'/item['file'] if cache else None)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(model,dependencies['model']['files']))
    (root/'model-manifest.json').write_text(json.dumps(dependencies['model'],indent=2)+'\n')

    pg0=next(x for x in dependencies['packages'] if x['name'].lower()=='pg0-embedded')
    with zipfile.ZipFile(root/'wheels'/pg0['url'].split('/')[-1]) as zipped:
        binary=zipped.read('pg0/bin/pg0')
    for item in dependencies['embeddedArchives']:
        data=binary[item['offset']:item['offset']+item['length']]
        assert hashlib.sha256(data).hexdigest()==item['sha256']
        target=root/item['file'];target.write_bytes(data)
        with tarfile.open(target) as tar:tar.extractall(root/'embedded',filter='data')
    pg=root/'embedded/postgresql-18.1.0-aarch64-apple-darwin'
    vector=root/'embedded/pgvector-aarch64-apple-darwin-pg18'
    for sub in ['lib','share/extension']:
        for file in (vector/sub).glob('*'):
            if file.is_file():shutil.copy2(file,pg/sub/file.name)
    for file in (pg/'bin').iterdir():
        if file.is_file():file.chmod(file.stat().st_mode|0o111)
    for name,digest in dependencies['postgresFiles'].items():assert sha(pg/name)==digest
    (root/'embedded-archives.json').write_text(json.dumps(dependencies['embeddedArchives'],indent=2)+'\n')
    (root/'preparation.json').write_text(json.dumps({'dependenciesSha256':sha(here/'dependencies.json'),
        'reusedHashVerifiedArtifacts':reused,'runtimeStarted':False,'hostInstall':False},indent=2)+'\n')
    print(root)


if __name__=='__main__':
    main()
