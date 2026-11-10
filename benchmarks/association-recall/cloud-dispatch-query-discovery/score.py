"""Score the two native query-only PATH captures against the original task judge."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
contract = root / 'cloud-dispatch-typed-endpoints/score.py'
spec = importlib.util.spec_from_file_location('paired_score_contract', contract)
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)
frozen = root / 'dispatch-task'
for name, expected in score.FROZEN_HASHES.items():
    assert hashlib.sha256((frozen / name).read_bytes()).hexdigest() == expected
consumer = score.load('frozen_consumer', frozen / 'consumer.py')
judge = score.load('frozen_judge', frozen / 'judge.py')
tasks = {case['id']: case for case in json.loads((frozen / 'fixture.json').read_text())['cases']}
capture = json.loads(Path(sys.argv[1]).read_text())
assert capture['schemaVersion'] == 'cloud-dispatch-query-discovery/v1'
observations = capture['observations']
assert len(observations) == 2 and {row['case'] for row in observations} == score.CASES
results = []
for row in observations:
    case = tasks[row['case']]
    receipt = row['receipt']
    tool = row['toolResponse']
    path = row['discoveryPathCitation']
    assert row['succeeded'] is True and case['query'] == row['query'] == receipt['query']
    assert row['shipmentId'] == case['shipmentId']
    assert receipt['ownerId'] == capture['actorId']
    assert receipt['tenantId'] == 'org_' + capture['tenantId'].replace('-', '')
    assert tool['receiptRef'] == receipt['receiptId'] and tool['planRef'] == receipt['planRef']
    assert row['plan']['plan']['planId'] == receipt['planRef']
    assert 'graph_query_discovery=omegarag-query-path/v1' in tool['policyFlags']
    assert receipt['answerPolicy'] == 'ALLOW_WITH_CAVEAT' and score.CLAIM in receipt['policy']['policyNotes']
    assert len(receipt['items']) == len(tool['evidence']) == 1
    assert len(receipt['items'][0]['graphPathCitations']) == len(tool['evidence'][0]['graphPathCitations']) == 1
    for other in (receipt['items'][0]['graphPathCitations'][0], tool['evidence'][0]['graphPathCitations'][0]):
        for key in ('citationId','pathHash','exactPath','queryMode','hopCount'):
            assert path[key] == other[key], key
    assert path['queryMode'] == 'PATH' and path['hopCount'] == 1
    assert path['seed']['schemaName'] == 'ContentMediaLink' and path['target']['schemaName'] == 'ContentData'
    assert path['edges'][0]['canonicalPath'] == 'ContentMediaLink.contentData.ContentData'
    assert path['edges'][0]['direction'] == 'OUTBOUND'
    assert row['discovery'] == {'id':path['seed']['entityId'],'contentDataId':path['target']['entityId']}
    source_ids = {'contentmedialink:'+path['seed']['entityId']:'anchor','contentdata:'+path['target']['entityId']:'detail'}
    before, before_items, before_pointers = score.page_parts(row['compiledPage'],receipt,source_ids,'compiled')
    after, items, pointers = score.page_parts(row['hydratedPage'],receipt,source_ids,'hydrated')
    assert before['pageRef'] == after['pageRef']
    assert pointers['contentdata:'+path['target']['entityId']]['sourceVersion'] == 'graph-projection:'+receipt['items'][0]['textHash']
    sources = {}
    for source_id, role in source_ids.items():
        for key in ('pointerRef','sourceVersion'):
            assert pointers[source_id][key] == before_pointers[source_id][key]
        for key in ('itemRef','sourceHash'):
            assert items[source_id][key] == before_items[source_id][key]
        sources[role] = {'id':role,'text':items[source_id]['summary']}
    for arm, roles in score.ARMS.items():
        selected = [sources[role] for role in roles]
        output = consumer.execute(case['shipmentId'],selected)
        verified = judge.score(case,output,roles)
        assert verified['correct'] is (arm == 'hydrated_endpoints') and not verified['unsupportedAction']
        results.append({'case':case['id'],'arm':arm,'output':output,'judge':verified,
                        'pageRef':after['pageRef'],'receiptRef':receipt['receiptId'],
                        'evidenceUtf8Bytes':sum(len(item['text'].encode()) for item in selected)})
result = {'nativeCases':2,'correctPaired':2,'correctTargetOnly':0,'unsupportedActions':0,'results':results}
if len(sys.argv) == 3:
    with Path(sys.argv[2]).open('x') as output:
        output.write(json.dumps(result,indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key!='results'}))
