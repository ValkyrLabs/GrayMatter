"""Reject source, identity, provenance and scope alterations in local capture copies."""
import copy
import json
from pathlib import Path
import tempfile
from check import verify_capture
from score import evaluate

HERE=Path(__file__).resolve().parent


def main():
    original=json.loads((HERE/'observations/graphiti-observed.json').read_text())
    controls=[]
    mutations={
        'source-body':lambda x:x['cases'][0]['trials'][0]['control']['sources'][0].update(text='invented'),
        'source-identity':lambda x:x['cases'][0]['trials'][0]['control']['sources'][0].update(nativeId='invented'),
        'package-version':lambda x:x['packages'].update(FalkorDB='0.0.0'),
        'loaded-upstream-source':lambda x:x['loadedSources'].update({next(k for k in x['loadedSources'] if '/graphiti_core/' in k):'0'*64}),
    }
    for name,mutate in mutations.items():
        altered=copy.deepcopy(original);mutate(altered)
        try:verify_capture('Graphiti',altered)
        except (AssertionError,KeyError):controls.append({'case':name,'rejected':True})
        else:raise AssertionError('Accepted '+name)
    altered=copy.deepcopy(original);case=next(c for c in altered['cases'] if c['id']=='excluded-scope-1')
    read=case['sourceReads']['detail']
    case['trials'][0]['control']['sources'].append({'id':'detail','nativeId':read['uuid'],'text':read['summary']})
    with tempfile.TemporaryDirectory(prefix='gm-dispatch-tamper-',dir='/private/tmp') as temporary:
        path=Path(temporary)/'altered.json';path.write_text(json.dumps(altered))
        try:evaluate([path])
        except AssertionError:controls.append({'case':'out-of-scope-source','rejected':True})
        else:raise AssertionError('Accepted out-of-scope source')
    print(json.dumps({'controls':controls,'allRejected':True},indent=2))


if __name__=='__main__':main()
