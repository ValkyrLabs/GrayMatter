"""Fresh private native runs, with pinned inputs and no inference/network credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_freeze():
    freeze=json.loads((HERE/'freeze.json').read_text())
    amendment = json.loads((HERE/'launcher-amendment.json').read_text()) if (HERE/'launcher-amendment.json').exists() else None
    for name,digest in freeze['files'].items():
        expected = amendment['newLauncherSha256'] if amendment and name == 'launch.py' else digest
        assert sha(HERE/name)==expected, name
    for name,digest in freeze['upstreamArtifactFiles'].items():assert sha(HERE.parent/name)==digest, name
    return freeze


def launch(product,setup,output,java=None,jar=None):
    freeze=verify_freeze()
    if product=='lite':
        command=[sys.executable,'-u','-B',str(HERE/'native_lite.py'),'--jar',str(jar),'--java',java,'--output-dir',str(output)]
        env={'PATH':'/usr/bin:/bin'}
        logfile=output.with_suffix('.log')
        assert not output.exists() and not logfile.exists()
        started=time.time()
        with logfile.open('x') as log:
            result=subprocess.run(command,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
        inventory={};policy=None
    else:
        output.mkdir(exist_ok=False)
        profile=output/'offline.sb'
        profile.write_text('(version 1)\n(allow default)\n(deny network*)\n(allow network* (local unix-socket (path-prefix "'+str(output)+'/")) (remote unix-socket (path-prefix "'+str(output)+'/")))\n')
        env={'PATH':'/usr/bin:/bin','HOME':str(output),'TMPDIR':str(output),'PYTHONDONTWRITEBYTECODE':'1',
             'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MKL_NUM_THREADS':'1'}
        pins=json.loads((HERE.parent/product/'dependencies.json').read_text())
        if product=='graphiti':
            source=setup/('graphiti-'+pins['graphiti']['commit'])
            inventory={relative:sha(source/relative) for relative in pins['graphiti']['sourceFiles']}
            assert inventory==pins['graphiti']['sourceFiles']
            env.update({'PYTHONPATH':str(source),'GRAPHITI_TELEMETRY_ENABLED':'false','DISPATCH_OUTPUT':str(output),
                        'DYLD_LIBRARY_PATH':str(setup/'native-libs/libomp/23.1.5/lib')+':/opt/homebrew/opt/expat/lib'})
            args=[]
        else:
            prior=json.loads((HERE.parent/'hindsight/protocol.json').read_text())
            source=setup/('hindsight-'+prior['sourceCommit'])/'hindsight-api-slim'
            inventory={str(p.relative_to(source)):sha(p) for p in sorted((source/'hindsight_api').rglob('*.py'))}
            assert inventory==pins['sourceInventory']
            pg=setup/'embedded/postgresql-18.1.0-aarch64-apple-darwin'
            for name,digest in pins['postgresFiles'].items():assert sha(pg/name)==digest,name
            for name,digest in pins['hostLibraryHashes'].items():assert sha(name)==digest,name
            for entry in json.loads((setup/'model-manifest.json').read_text())['files']:
                assert sha(setup/'model'/entry['file'])==entry['sha256']
            env.update({'DYLD_LIBRARY_PATH':'/opt/homebrew/opt/expat/lib','PYTHONPATH':str(source),
                'HF_HOME':str(output/'hf-cache'),'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1',
                'HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false',
                'HINDSIGHT_API_LLM_PROVIDER':'none','HINDSIGHT_API_RERANKER_PROVIDER':'rrf',
                'HINDSIGHT_API_EMBEDDINGS_PROVIDER':'onnx',
                'HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_ID':prior['embedding']['model'],
                'HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_PATH':str(setup/'model/onnx/model.onnx'),
                'HINDSIGHT_API_EMBEDDINGS_ONNX_TOKENIZER_NAME_OR_PATH':str(setup/'model'),
                'HINDSIGHT_API_EMBEDDINGS_ONNX_POOLING':'cls',
                'HINDSIGHT_API_EMBEDDINGS_ONNX_QUERY_PREFIX':prior['embedding']['queryPrefix'],
                'HINDSIGHT_API_EMBEDDINGS_ONNX_PASSAGE_PREFIX':''})
            args=['--setup',str(setup),'--output-dir',str(output)]
        command=['/usr/bin/sandbox-exec','-f',str(profile),str(setup/'venv/bin/python'),'-u','-B',str(HERE/f'native_{product}.py'),*args]
        started=time.time();logfile=output/'runtime.log'
        with logfile.open('x') as log:
            result=subprocess.run(command,cwd=output,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240)
        policy=sha(profile)
        assert all(sha(source/name)==digest for name,digest in inventory.items())
    verify_freeze()
    record={'product':product,'exitCode':result.returncode,'command':command,'durationSeconds':time.time()-started,
            'startedEpochSeconds':started,'freezeSha256':sha(HERE/'freeze.json'),'policySha256':policy,
            'logSha256':sha(logfile),'sourceFilesVerified':len(inventory),'launcherSha256':sha(__file__)}
    if output.exists():(output/'launch.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record))
    return result.returncode


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('product',choices=['graphiti','hindsight','lite'])
    parser.add_argument('--setup',type=Path);parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--java');parser.add_argument('--jar',type=Path)
    args=parser.parse_args()
    raise SystemExit(launch(args.product,args.setup.resolve() if args.setup else None,args.output_dir.resolve(),args.java,args.jar))
