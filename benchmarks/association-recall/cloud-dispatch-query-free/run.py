"""Run the native diagnostic only in an explicitly supplied isolated canonical reactor."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--reactor', required=True, type=Path, help='Private copy of current canonical ValkyrAI checkout')
parser.add_argument('--maven-repo', required=True, type=Path, help='Existing pinned local Maven repository; offline only')
args = parser.parse_args()
reactor = args.reactor.resolve()
if not str(reactor).startswith('/private/tmp/'):
    raise SystemExit('Refusing to modify a non-temporary reactor; create an isolated copy first')
if not (reactor / 'vaix').is_file() or not args.maven_repo.is_dir():
    raise SystemExit('Existing canonical reactor and private Maven cache are required')
work = Path(tempfile.mkdtemp(prefix='gm-cloud-dispatch-result-', dir='/private/tmp'))
source = HERE / 'CloudDispatchQueryFreeJpaTest.java'
target = reactor / 'valkyrai/src/test/java/com/valkyrlabs/valkyrai/graymatter/memory' / source.name
if target.exists() and target.read_bytes() != source.read_bytes():
    raise SystemExit('Existing test differs; use a fresh isolated reactor')
shutil.copy2(source, target)
command = ['/usr/bin/sandbox-exec', '-f', str(HERE / 'loopback-only.sb'), './vaix', 'mvn', '-o',
           '-Dmaven.repo.local=' + str(args.maven_repo.resolve()), '-pl', 'valkyrai',
           '-Dskip.codegen=true', '-Dforce.codegen=false', '-Dtest=CloudDispatchQueryFreeJpaTest',
           '-Dgraymatter.dispatch.fixture=' + str(HERE.parent / 'dispatch-task/fixture.json'),
           '-Dgraymatter.dispatch.capture=' + str(work / 'native-capture.json'),
           'test-compile', 'surefire:test@default-test']
(work / 'command.txt').write_text('\n'.join(command) + '\n')
print(work, flush=True)
with (work / 'canonical.log').open('x') as output:
    result = subprocess.run(command, cwd=reactor, stdout=output, stderr=subprocess.STDOUT, check=False)
print('Canonical exit:', result.returncode)
print('Capture:', work / 'native-capture.json')
raise SystemExit(result.returncode)
