"""Evaluate native captures with the frozen common consumer and SQLite judge."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import time
from consumer import execute
from judge import score
from launch import verify_freeze

HERE=Path(__file__).resolve().parent


def evaluate(paths):
    verify_freeze()
    fixture=json.loads((HERE/'fixture.json').read_text())
    result={'classification':'Native retrieval followed by the same local closed-schema dispatch workflow; not an LLM or Valkyr workflow',
            'freezeSha256':hashlib.sha256((HERE/'freeze.json').read_bytes()).hexdigest(),'products':{}}
    for path in paths:
        capture=json.loads(path.read_text());product=capture['product'];assert product not in result['products']
        assert [c['id'] for c in capture['cases']]==[c['id'] for c in fixture['cases']]
        results=[]
        for case,observed in zip(fixture['cases'],capture['cases']):
            known={r['key']:r for r in case['rows']}
            assert len(observed['trials'])==7
            arms={}
            for arm in ['control','treatment']:
                measured=[]
                for trial in observed['trials']:
                    raw=trial[arm];sources=raw['sources'];assert len({s['id'] for s in sources})==len(sources)
                    for source in sources:
                        assert source['id'] in known and source['text']==known[source['id']]['text']
                        assert not known[source['id']].get('sourceSuffix'), 'out-of-scope source disclosed'
                    start=time.perf_counter_ns();out=execute(case['shipmentId'],sources,raw['permitted'])
                    consumer_ms=(time.perf_counter_ns()-start)/1e6
                    judged=score(case,out,[s['id'] for s in sources])
                    measured.append({'output':out,'judge':judged,'sourceIds':[s['id'] for s in sources],
                                     'evidenceUtf8Bytes':sum(len(s['text'].encode()) for s in sources),
                                     'retrievalMs':raw['elapsedMs'],'consumerMs':consumer_ms,
                                     'retrievalPlusConsumerMs':raw['elapsedMs']+consumer_ms})
                assert all(t['output']==measured[0]['output'] for t in measured), 'non-reproduced task output'
                arms[arm]={'trials':measured,'correct':all(t['judge']['correct'] for t in measured),
                           'unsupportedAction':any(t['judge']['unsupportedAction'] for t in measured),
                           'medianRetrievalMs':statistics.median(t['retrievalMs'] for t in measured),
                           'medianConsumerMs':statistics.median(t['consumerMs'] for t in measured)}
            results.append({'id':case['id'],'family':case['family'],'arms':arms})
        summary={arm:{'assignedTasks':len(results),'correctTasks':sum(c['arms'][arm]['correct'] for c in results),
                      'unsupportedActions':sum(c['arms'][arm]['unsupportedAction'] for c in results),
                      'readyTasks':sum(c['arms'][arm]['trials'][0]['output']['status']=='ready' for c in results),
                      'statusByTask':{c['id']:c['arms'][arm]['trials'][0]['output']['status'] for c in results}}
                 for arm in ['control','treatment']}
        result['products'][product]={'captureSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'summary':summary,'cases':results}
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('captures',nargs='+',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();result=evaluate(args.captures)
    with args.output.open('x') as stream:stream.write(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v['summary'] for k,v in result['products'].items()},indent=2))
