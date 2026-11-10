"""Validate native provenance and report evidence selections without a win-rate."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics

from run import entity_names


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def check(path):
    here=Path(__file__).resolve().parent
    fixture=json.loads((here.parent/'fixture.json').read_text())
    protocol=json.loads((here/'protocol.json').read_text())
    dependencies=json.loads((here/'dependencies.json').read_text())
    observed=json.loads(path.read_text())
    launch=json.loads(path.with_name('launch.json').read_text())
    assert observed['fixtureSha256']==sha(here.parent/'fixture.json')==protocol['fixtureSha256']
    assert observed['protocolSha256']==launch['protocolSha256']==sha(here/'protocol.json')
    assert observed['sourceCommit']==protocol['sourceCommit']==dependencies['source']['commit']
    assert launch['exitCode']==0 and launch['sourceUnchanged']
    assert launch['sourceInventory']==dependencies['sourceInventory']
    assert launch['runnerSha256']==sha(here/'run.py')
    assert launch['launcherSha256']==sha(here/'launch.py')
    assert launch['dependenciesSha256']==sha(here/'dependencies.json')
    assert launch['runtimeLogSha256']==sha(path.with_name('runtime.log'))
    assert launch['modelManifest']==dependencies['model']
    assert launch['sourceArchive']==dependencies['source']
    assert observed['networkProbe']=={'address':'192.0.2.1:443','errno':1,'bytesSent':0}
    assert observed['llmCalls']==0 and observed['embedding']==protocol['embedding']
    expected_packages={x['name'].lower().replace('_','-'):x['version'] for x in dependencies['packages']}
    actual_packages={k.lower().replace('_','-'):v for k,v in observed['packages'].items()}
    assert actual_packages==expected_packages
    assert len(observed['loadedSourceModules'])>=100
    for module in observed['loadedSourceModules'].values():
        assert dependencies['sourceInventory'][module['file']]==module['sha256']
    assert len(observed['cases'])==len(fixture['cases'])==14
    summaries=[]
    for case,actual in zip(fixture['cases'],observed['cases']):
        assert actual['id']==case['id'] and actual['query']==case['query']
        expected_names=entity_names(case)
        rows={r['key']:r for r in case['rows']}
        allowed={k for k,r in rows.items() if not r.get('sourceSuffix')}
        mapping=actual['mapping']
        assert set(mapping)==set(rows)==set(actual['sources'])
        assert len({r['id'] for r in mapping.values()})==len(rows)
        for key,row in rows.items():
            source=actual['sources'][key]
            assert source['id']==mapping[key]['id']
            assert source['text']==row['text']
            assert sorted(source['tags'])==sorted(row.get('tags',[]))
            assert sorted(source['entities'])==sorted(expected_names[key])
            assert source['metadata']['fixture_key']==key
            assert source['metadata']['fixture_type']==row.get('type','context')
            assert json.loads(source['metadata']['original_links'])==case['links']
        arms={}
        for arm,trials in actual['trials'].items():
            assert arm in ('control','treatment') and len(trials)==7
            selections=[]
            for trial in trials:
                assert set(trial['keys'])<=allowed
                assert len(trial['keys'])==len(set(trial['keys']))
                results=trial['result']['results']
                assert len(results)==len(trial['keys'])
                for key,result in zip(trial['keys'],results):
                    assert result['id']==mapping[key]['id'] and result['text']==rows[key]['text']
                assert trial['sourceBytes']==sum(len(r['text'].encode('utf-8')) for r in results)
                assert math.isfinite(trial['elapsedMs']) and trial['elapsedMs']>=0
                assert trial['tokenFiltering']['max_tokens']==case.get('tokenBudget',1024)
                assert trial['tokenFiltering']['tokens_used']<=trial['tokenFiltering']['max_tokens']
                assert trial['retrievalCounts']['temporal_count']==0
                if arm=='control':assert trial['retrievalCounts']['graph_count']==0
                selections.append(trial['keys'])
            assert all(s==selections[0] for s in selections)
            selected=set(selections[0]);oracle=case['oracle']
            required=oracle.get('requiredAnswerKeys',[])
            joined='\n'.join(rows[k]['text'] for k in selections[0])
            arms[arm]={
                'keys':selections[0],
                'answerEvidencePresent':all(k in selected for k in required) and oracle.get('answerText','') in joined if required else None,
                'evidencePrecision':len(selected & set(oracle.get('relevantKeys',[])))/len(selected) if selected else None,
                'medianMs':statistics.median(t['elapsedMs'] for t in trials),
                'sourceBytes':trials[0]['sourceBytes'],
                'nativeTokensUsed':trials[0]['tokenFiltering']['tokens_used'],
                'graphCounts':[t['retrievalCounts']['graph_count'] for t in trials],
            }
        assert set(arms)=={'control','treatment'}
        summaries.append({'id':case['id'],'arms':arms})
    assert [x['mutation'] for x in observed['lifecycle']]==protocol['lifecycle']
    for row in observed['lifecycle']:
        assert row['historicalClientSnapshotUnchanged']
        anchor=row['mapping']['anchor']['id']
        original=row['sourcesBefore']['anchor']['text']
        if row['mutation']=='delete-anchor':
            assert row['currentAnchor'] is None
            assert anchor not in [r['id'] for r in row['after']['result']['results']]
        elif row['mutation']=='correct-anchor':
            assert row['currentAnchor']['id']==anchor
            assert row['currentAnchor']['text']!=original
        else:
            assert row['currentAnchor']['id']==anchor and row['currentAnchor']['entities']==[]
        current_by_id={source['id']:source['text'] for source in row['sourcesBefore'].values()}
        if row['currentAnchor'] is None:
            current_by_id.pop(anchor)
        else:
            current_by_id[anchor]=row['currentAnchor']['text']
        for result in row['after']['result']['results']:
            assert result['text']==current_by_id[result['id']]
    lite_file=here.parent/'candidate-release-observed.json'
    assert sha(lite_file)=='06078198dd0903c9d666b3cf5872f42372617d58289ea5f808327a48828324f2'
    lite=json.loads(lite_file.read_text())
    lite_cases={case['id']:case for case in lite['cases']}
    for case,summary in zip(fixture['cases'],summaries):
        other=lite_cases[case['id']]
        identity={value['id']:key for key,value in other['state']['rows'].items()}
        for row in case['rows']:
            assert other['state']['rows'][row['key']]['text']==row['text']
        modes={}
        for mode,value in other['modes'].items():
            body=value['firstMeasuredResponse']['body']
            keys=[identity[x['memoryId']] for x in body.get('items',[])]
            required=case['oracle'].get('requiredAnswerKeys',[])
            modes[mode]={'keys':keys,'retrievalStatus':body['retrievalStatus'],
                         'answerPolicy':body['answerPolicy'],
                         'answerEvidencePresent':all(k in keys for k in required) and case['oracle'].get('answerText','') in (body.get('context') or '') if required else None}
        summary['existingLiteCapture']=modes
    return {
        'classification':'Actual same-input native Hindsight recall; association encoding and resource semantics differ',
        'casesValidated':14,'lifecycleControlsValidated':3,'sourceFilesVerified':len(dependencies['sourceInventory']),
        'loadedSourceModulesVerified':len(observed['loadedSourceModules']),
        'observedSha256':sha(path),'liteCaptureSha256':sha(lite_file),
        'cases':summaries,
        'boundaries':protocol['boundaries']+[
            'A real local embedding model ran; zero LLM and external inference calls.',
            'Native LOW retrieves up to100 per arm; Lite used keyword topK1.',
            'All in-bank matched rows cleared the native semantic floor; graph-on did not add selected evidence.',
            'The earlier Lite capture used a profile whose network containment was not established by a live denial probe.',
        ],
    }


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('observed',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=check(args.observed.resolve())
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k in ['casesValidated','lifecycleControlsValidated','sourceFilesVerified','loadedSourceModulesVerified']}))
