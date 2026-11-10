"""Run a private Hindsight installation with all IP networking denied."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def launch(setup, output, calibration=False):
    here = Path(__file__).resolve().parent
    protocol = json.loads((here/'protocol.json').read_text())
    output.mkdir(exist_ok=False)
    source = setup/('hindsight-'+protocol['sourceCommit'])/'hindsight-api-slim'
    inventory = {str(p.relative_to(source)): sha(p) for p in sorted((source/'hindsight_api').rglob('*.py'))}
    dependencies = json.loads((here/'dependencies.json').read_text())
    assert inventory == dependencies['sourceInventory'], 'Pinned source mismatch'
    pg = setup/'embedded/postgresql-18.1.0-aarch64-apple-darwin'
    for name, digest in dependencies['postgresFiles'].items():
        assert sha(pg/name) == digest, ('PostgreSQL file mismatch', name)
    for name, digest in dependencies['hostLibraryHashes'].items():
        assert sha(name) == digest, ('Host library changed; explicit requalification needed', name)
    profile = output/'offline.sb'
    profile.write_text('(version 1)\n(allow default)\n(deny network*)\n'
                       '(allow network* (local unix-socket (path-prefix "'+str(output)+'/")) '
                       '(remote unix-socket (path-prefix "'+str(output)+'/")))\n')
    env = {
        'PATH':'/usr/bin:/bin', 'DYLD_LIBRARY_PATH':'/opt/homebrew/opt/expat/lib',
        'PYTHONPATH':str(source), 'PYTHONDONTWRITEBYTECODE':'1',
        'HF_HOME':str(output/'hf-cache'), 'HF_HUB_OFFLINE':'1', 'TRANSFORMERS_OFFLINE':'1',
        'HF_HUB_DISABLE_TELEMETRY':'1', 'TOKENIZERS_PARALLELISM':'false',
        'OMP_NUM_THREADS':'1', 'OPENBLAS_NUM_THREADS':'1', 'MKL_NUM_THREADS':'1',
        'HINDSIGHT_API_LLM_PROVIDER':'none', 'HINDSIGHT_API_RERANKER_PROVIDER':'rrf',
        'HINDSIGHT_API_EMBEDDINGS_PROVIDER':'onnx',
        'HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_ID':protocol['embedding']['model'],
        'HINDSIGHT_API_EMBEDDINGS_ONNX_MODEL_PATH':str(setup/'model/onnx/model.onnx'),
        'HINDSIGHT_API_EMBEDDINGS_ONNX_TOKENIZER_NAME_OR_PATH':str(setup/'model'),
        'HINDSIGHT_API_EMBEDDINGS_ONNX_POOLING':'cls',
        'HINDSIGHT_API_EMBEDDINGS_ONNX_QUERY_PREFIX':protocol['embedding']['queryPrefix'],
        'HINDSIGHT_API_EMBEDDINGS_ONNX_PASSAGE_PREFIX':'',
    }
    for item in json.loads((setup/'model-manifest.json').read_text())['files']:
        assert sha(setup/'model'/item['file']) == item['sha256']
    runner = here/('calibrate.py' if calibration else 'run.py')
    command = ['/usr/bin/sandbox-exec','-f',str(profile),str(setup/'venv/bin/python'),
               '-u','-B',str(runner),'--setup',str(setup),'--output-dir',str(output)]
    started = time.time()
    with (output/'runtime.log').open('w') as log:
        result = subprocess.run(command, cwd=output, env=env, stdout=log,
                                stderr=subprocess.STDOUT, timeout=240)
    assert inventory == {str(p.relative_to(source)): sha(p) for p in sorted((source/'hindsight_api').rglob('*.py'))}
    record = {
        'command':command, 'environment':env, 'exitCode':result.returncode,
        'startedEpochSeconds':started, 'durationSeconds':time.time()-started,
        'policySha256':sha(profile), 'runnerSha256':sha(runner), 'calibration':calibration,
        'launcherSha256':sha(__file__), 'protocolSha256':sha(here/'protocol.json'),
        'runtimeLogSha256':sha(output/'runtime.log'),
        'sourceInventory':inventory, 'sourceUnchanged':True,
        'modelManifest':json.loads((setup/'model-manifest.json').read_text()),
        'sourceArchive':json.loads((setup/'provenance.json').read_text()),
        'embeddedArchives':json.loads((setup/'embedded-archives.json').read_text()),
        'dependenciesSha256':sha(here/'dependencies.json'),
    }
    (output/'launch.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({'exitCode':result.returncode,'output':str(output),'durationSeconds':record['durationSeconds']}))
    return result.returncode


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--setup',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--calibration',action='store_true')
    args = parser.parse_args()
    raise SystemExit(launch(args.setup.resolve(),args.output_dir.resolve(),args.calibration))
