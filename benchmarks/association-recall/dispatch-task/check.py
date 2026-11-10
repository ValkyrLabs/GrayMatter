"""Verify exact native identities, pinned source provenance and replayed task results."""
import hashlib
import json
from pathlib import Path
import re
from score import evaluate
from launch import verify_freeze
from corpus import fixture

HERE=Path(__file__).resolve().parent


def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def normalize(p):return re.sub(r'[-_.]+','-',p).lower()


def verify_capture(product,capture):
    original={c['id']:c for c in fixture()['cases']}
    assert capture['llmCalls']==0
    for case in capture['cases']:
        assigned=original[case['id']]
        if product=='Lite':reads=case['state']['rows'];field='text';idfield='id'
        elif product=='Graphiti':reads=case['sourceReads'];field='summary';idfield='uuid'
        else:reads=case['sourceReads'];field='text';idfield='id'
        assert set(reads)=={r['key'] for r in assigned['rows']}
        for source in assigned['rows']:assert reads[source['key']][field]==source['text']
        for trial in case['trials']:
            for arm in ['control','treatment']:
                row=trial[arm];assert row['elapsedMs']>0
                for item in row['sources']:
                    assert reads[item['id']][idfield]==item['nativeId']
                    assert reads[item['id']][field]==item['text']
                if product=='Lite':
                    assert row['permitted']==(row['native']['answerPolicy']=='ALLOW_ANSWER')
                    assert [s['nativeId'] for s in row['sources']]==[i['memoryId'] for i in row['native']['items']]
    if product=='Lite':
        assert capture['jarSha256']==json.loads((HERE/'protocol.json').read_text())['native']['Lite']['jarSha256']
        assert capture['networkProfileSha256']==sha(HERE.parent/'loopback.sb')
        return
    assert capture['networkProbeErrno']==1
    pins=json.loads((HERE.parent/product.lower()/'dependencies.json').read_text())
    actual={normalize(k):v for k,v in capture['packages'].items()}
    expected={normalize(k):v['version'] for k,v in pins['dependencies'].items()} if product=='Graphiti' else {normalize(x['name']):x['version'] for x in pins['packages']}
    assert all(actual.get(k)==v for k,v in expected.items()), 'package version mismatch'
    sourcepins=pins['graphiti']['sourceFiles'] if product=='Graphiti' else pins['sourceInventory']
    marker='/graphiti_core/' if product=='Graphiti' else '/hindsight_api/'
    found=0
    for path,digest in capture['loadedSources'].items():
        if marker not in path:continue
        relative=marker[1:]+path.split(marker,1)[1]
        assert sourcepins[relative]==digest,relative
        found+=1
    assert found>100


def main():
    verify_freeze()
    assert json.loads((HERE/'fixture.json').read_text())==fixture()
    captures=[]
    for name in ['lite','graphiti','hindsight']:
        path=HERE/'observations'/f'{name}-observed.json'
        captured=json.loads(path.read_text());verify_capture(captured['product'],captured);captures.append(path)
        launch=json.loads((HERE/'observations'/f'{name}-launch.json').read_text())
        assert launch['exitCode']==0
        assert launch['logSha256']==sha(HERE/'observations'/f'{name}-runtime.log')
        assert launch['freezeSha256']==sha(HERE/'freeze.json')
    actual=evaluate(captures)
    recorded=json.loads((HERE/'observations/scores.json').read_text())
    # Consumer timing is newly measured; all decisions, packets, citations and judges must be exact.
    for product,result in actual['products'].items():
        old=recorded['products'][product]
        assert result['captureSha256']==old['captureSha256']
        assert result['summary']==old['summary']
        for c,o in zip(result['cases'],old['cases']):
            for arm in ['control','treatment']:
                for t,u in zip(c['arms'][arm]['trials'],o['arms'][arm]['trials']):
                    for key in ['output','judge','sourceIds','evidenceUtf8Bytes','retrievalMs']:
                        assert t[key]==u[key],(product,c['id'],arm,key)
    print(json.dumps({'products':3,'assignedTasksPerArm':12,'nativeTrialsPerArmPerTask':7,'allRecordedDecisionsReproduced':True}))


if __name__=='__main__':main()
