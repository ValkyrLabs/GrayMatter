"""Score only the endpoint text returned by the native hydration operation."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time

FROZEN_HASHES = {
    'fixture.json': 'c6fca3e6a0b0c73e327eaab788f3a55d1418a626743695121dcb9eed512488ea',
    'consumer.py': '60e03185e168adcec6e505fc84c6a664939fc3599641369067e666cfa99d605f',
    'judge.py': '5671dcda710f7ec970252849dfe7be1cf49f57baf6e0f89814a46ab6f69bdf30',
}
CASES = {'query-free-1', 'query-free-2'}
ARMS = {'hydrated_target_only': ['detail'], 'hydrated_endpoints': ['anchor', 'detail']}
CLAIM = 'graph_evidence_claim_scope=typed_path_and_endpoint_projection_only'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def page_parts(response, receipt, source_ids, status):
    returned_receipt = response['retrievalReceipt']
    for key in ('id', 'receiptId', 'ownerId', 'tenantId', 'query', 'bindingHash', 'answerPolicy'):
        assert returned_receipt[key] == receipt[key], key
    page = response['contextPage']
    assert page['status'] == status and page['taskIntent'] == receipt['query']
    assert page['ownerId'] == receipt['ownerId'] and page['tenantId'] == receipt['tenantId']
    assert re.match(r'typed_path_endpoints/v1=[0-9a-f]{64};', page['policy'])
    assert len(page['items']) == len(page['hydrationPointers']) == 2
    items = {item['sourceId']: item for item in page['items']}
    pointers = {pointer['targetId']: pointer for pointer in page['hydrationPointers']}
    assert set(items) == set(pointers) == set(source_ids)
    assert len({item['itemRef'] for item in items.values()}) == 2
    assert len({pointer['pointerRef'] for pointer in pointers.values()}) == 2
    for source_id, item in items.items():
        pointer = pointers[source_id]
        assert item['sourceType'] == pointer['targetType'] == 'generated_domain_record'
        assert item['retained'] is True
        assert re.fullmatch(r'graph-projection:[0-9a-f]{64}', pointer['sourceVersion'])
        assert isinstance(item['summary'], str) and item['summary']
        if status == 'hydrated':
            assert pointer['status'] == 'hydrated' and item['hydrated'] is True
            assert pointer['summary'] == item['summary']
    return page, items, pointers


def evaluate(capture, frozen):
    for name, expected in FROZEN_HASHES.items():
        assert hashlib.sha256((frozen / name).read_bytes()).hexdigest() == expected, name
    consumer = load('frozen_consumer', frozen / 'consumer.py')
    judge = load('frozen_judge', frozen / 'judge.py')
    tasks = {case['id']: case for case in json.loads((frozen / 'fixture.json').read_text())['cases']}
    assert capture['schemaVersion'] == 'cloud-dispatch-typed-endpoints/v1'
    observations = capture['observations']
    assert len(observations) == len(CASES) and {row['case'] for row in observations} == CASES
    results = []
    for observation in observations:
        task = tasks[observation['case']]
        assert observation['query'] == task['query'] and observation['shipmentId'] == task['shipmentId']
        assert observation['succeeded'] is True
        receipt = observation['receipt']
        assert receipt['query'] == task['query'] and receipt['ownerId'] == capture['actorId']
        assert receipt['tenantId'] == 'org_' + capture['tenantId'].replace('-', '')
        assert receipt['answerPolicy'] == 'ALLOW_WITH_CAVEAT'
        notes = receipt['policy']['policyNotes']
        assert [note for note in notes if note.startswith('graph_evidence_claim_scope=')] == [CLAIM]
        assert 'generated_graph_proof_items=1' in notes
        discovery = observation['discovery']
        assert discovery == observation['currentDiscovery']
        source_ids = {'contentmedialink:' + discovery['id']: 'anchor',
                      'contentdata:' + discovery['contentDataId']: 'detail'}
        assert len(receipt['items']) == 1
        receipt_item = receipt['items'][0]
        assert receipt_item['entityType'].lower() == 'contentdata'
        assert receipt_item['entityId'] == discovery['contentDataId']
        before_page, before_items, before_pointers = page_parts(observation['compiledPage'], receipt, source_ids, 'compiled')
        page, items, pointers = page_parts(observation['hydratedPage'], receipt, source_ids, 'hydrated')
        assert page['pageRef'] == before_page['pageRef']
        assert pointers['contentdata:' + discovery['contentDataId']]['sourceVersion'] == 'graph-projection:' + receipt_item['textHash']
        actual_sources = {}
        for source_id, key in source_ids.items():
            item, pointer = items[source_id], pointers[source_id]
            for field in ('itemRef', 'sourceHash'):
                assert item[field] == before_items[source_id][field]
            for field in ('pointerRef', 'sourceVersion'):
                assert pointer[field] == before_pointers[source_id][field]
            actual_sources[key] = {'id': key, 'text': item['summary']}
        for arm, keys in ARMS.items():
            sources = [actual_sources[key] for key in keys]
            started = time.perf_counter_ns()
            output = consumer.execute(task['shipmentId'], sources)
            elapsed = time.perf_counter_ns() - started
            results.append({'case': task['id'], 'arm': arm, 'sources': sources,
                            'sourceIds': {key: ident for ident, key in source_ids.items()},
                            'output': output, 'judge': judge.score(task, output, keys),
                            'evidenceUtf8Bytes': sum(len(s['text'].encode()) for s in sources),
                            'offlineConsumerNanos': elapsed, 'nativePipelineNanos': observation['elapsedNanos'],
                            'pageRef': page['pageRef'], 'receiptRef': receipt['receiptId']})
    assert len(results) == 4 and {(row['case'], row['arm']) for row in results} == {
        (case, arm) for case in CASES for arm in ARMS}
    return {'schemaVersion': 'cloud-dispatch-hydrated-results/v1', 'results': results}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', required=True, type=Path)
    parser.add_argument('--frozen', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.capture.read_text()), args.frozen)
    with args.out.open('x') as output:
        output.write(json.dumps(result, indent=2) + '\n')
