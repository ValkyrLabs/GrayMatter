"""Independently validate native graph results without imposing Lite answer policy."""
import argparse, hashlib, json, math, statistics, uuid
from pathlib import Path
HERE = Path(__file__).resolve().parent
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()

def validate(observation):
    fixture_path = HERE.parent/'fixture.json'
    fixture = json.loads(fixture_path.read_text())
    pins = json.loads((HERE/'dependencies.json').read_text())
    protocol = json.loads((HERE/'protocol.json').read_text())
    observed = json.loads(observation.read_text())
    launch = json.loads((observation.parent/'launch.json').read_text())
    assert launch['exitCode'] == 0 and launch['sourceFilesVerified'] == 166
    assert launch['runnerSha256'] == sha(HERE/'run.py')
    assert launch['launcherSha256'] == sha(HERE/'launch.py')
    assert launch['protocolSha256'] == sha(HERE/'protocol.json')
    assert launch['logSha256'] == sha(observation.parent/'runtime.log')
    assert sha(fixture_path) == observed['fixtureSha256'] == protocol['fixtureSha256']
    assert observed['sourceCommit'] == pins['graphiti']['commit'] == protocol['sourceCommit']
    assert observed['externalNetworkDenied'] == {'errorType':'PermissionError','errno':1}
    assert observed['models'] == [] and observed['modelCalls'] == 0
    assert len(observed['cases']) == len(fixture['cases']) == 14
    for path, digest in observed['loadedSources'].items():
        if '/graphiti_core/' in path:
            relative = 'graphiti_core/' + path.split('/graphiti_core/',1)[1]
            assert pins['graphiti']['sourceFiles'][relative] == digest, relative
    actual_packages = {name.lower().replace('_','-'):version for name,version in observed['packages'].items()}
    for name, dep in pins['dependencies'].items():
        assert actual_packages[name] == dep['version'], name
    rows=[]
    for index,(case,result) in enumerate(zip(fixture['cases'],observed['cases'])):
        assert case['id'] == result['id'] and case['query'] == result['query']
        source={r['key']:r for r in case['rows']}; reads=result['sourceReads']; group=f'case_{index}'
        assert set(reads)==set(source)
        for key,node in reads.items():
            assert str(uuid.UUID(node['uuid']))==node['uuid']
            assert node['summary']==source[key]['text']
            assert node['group_id']==group+source[key].get('sourceSuffix','')
            assert node['attributes']['fixture_key']==key
            assert node['attributes']['fixture_type']==source[key].get('type','context')
            assert json.loads(node['attributes']['fixture_tags'])==source[key].get('tags',[])
        assert len(result['edgeReads'])==len(case['links'])
        for edge,link in zip(result['edgeReads'],case['links']):
            assert edge['source_node_uuid']==reads[link['from']]['uuid']
            assert edge['target_node_uuid']==reads[link['to']]['uuid']
            assert edge['name']==edge['fact']==link['relation'] and edge['group_id']==group
        assert len(result['trials'])==7
        first=result['trials'][0]
        for trial in result['trials']:
            assert len(trial['direct'])<=1 and len(trial['traversed'])<=8
            for arm in ['direct','traversed']:
                for rank,item in enumerate(trial[arm]):
                    assert item['uuid']==reads[item['key']]['uuid']
                    assert item['text']==source[item['key']]['text'] and item['groupId']==group
                    assert math.isclose(item['score'],1/(rank+1))
            seeds={n['key'] for n in trial['direct']}
            reachable={e['to'] for e in case['links'] if e['from'] in seeds and not source[e['to']].get('sourceSuffix')}
            assert {n['key'] for n in trial['traversed']}==reachable
            union={n['uuid']:n for n in trial['direct']}
            for n in trial['traversed']:union.setdefault(n['uuid'],n)
            assert list(union.values())==trial['combined']
            assert trial['bodyUtf8Bytes']==sum(len(n['text'].encode()) for n in trial['combined'])
            assert 0<=trial['directNs']<=trial['combinedNs']
            assert [trial[a] for a in ['direct','traversed','combined']]==[first[a] for a in ['direct','traversed','combined']]
        keys=[n['key'] for n in first['combined']]; required=case['oracle'].get('requiredAnswerKeys')
        bodies='\n\n'.join(n['text'] for n in first['combined'])
        rows.append({'case':case['id'],'nativeDirectKeys':[n['key'] for n in first['direct']],
            'nativeGraphKeys':keys,'requiredEvidencePresent':all(k in keys for k in required) and case['oracle']['answerText'] in bodies if required else None,
            'designatedIrrelevantOrOutOfScopeReturned':[k for k in case['oracle'].get('forbiddenKeys',[]) if k in keys],
            'bodyUtf8Bytes':first['bodyUtf8Bytes'],'medianDirectMs':statistics.median(t['directNs']/1e6 for t in result['trials']),
            'medianGraphMs':statistics.median(t['combinedNs']/1e6 for t in result['trials']),
            'nativeAnswerPolicy':'not exercised','nativeTokenBudget':None})
    life={x['mutation']:x for x in observed['lifecycle']}
    assert set(life)=={'correct-anchor','delete-anchor','delete-edge'}
    original=fixture['cases'][0]['rows'][0]['text']
    for name,item in life.items():
        assert item['heldClientSnapshot']==item['before']
        assert item['before']['direct'][0]['text']==original
        if name=='correct-anchor':assert item['currentAnchor']=='Corrected source: the former courier dispatch statement is withdrawn.'
        elif name=='delete-anchor':assert item['currentAnchor']=={'errorType':'NodeNotFoundError'}
        else:
            assert item['currentAnchor']==original
            assert [n['key'] for n in item['after']['combined']]==['anchor']
    lite_path=HERE.parent/'candidate-release-observed.json'
    assert sha(lite_path)=='06078198dd0903c9d666b3cf5872f42372617d58289ea5f808327a48828324f2'
    lite=json.loads(lite_path.read_text())
    for row,case,lc in zip(rows,fixture['cases'],lite['cases']):
        assert row['case']==lc['id']
        for mode in ['disabled','expanded']:
            request=lc['modes'][mode]['request']; first=lc['modes'][mode]['trials'][0]
            assert request['query']==case['query'] and request['topK']==1
            row['lite'+mode.title()]={k:first[k] for k in ['sourceKeys','retrievalStatus','answerPolicy','answerEvidenceComplete','contextUtf8Bytes','tokenEstimate']}
    return {'casesValidated':14,'lifecycleValidated':3,'observationSha256':sha(observation),
        'fixtureSha256':sha(fixture_path),'checkerSha256':sha(Path(__file__)),
        'liteObservationSha256':sha(lite_path),'rows':rows,
        'boundaries':protocol['interpretation'],'networkCaveat':'Graphiti has a live TEST-NET denial assertion. The earlier Lite capture used the older profile; its external-network denial was not established by a live probe.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('observation',type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args();result=validate(args.observation)
    if args.output:
        with args.output.open('x') as file:json.dump(result,file,indent=2);file.write('\n')
    print(json.dumps({k:result[k] for k in ['casesValidated','lifecycleValidated','observationSha256']}))
