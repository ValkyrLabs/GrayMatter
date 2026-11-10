"""Portable scorer for separately labeled body-mapping Cloud captures; frozen consumer and judge stay unchanged."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import statistics

FROZEN = {
    'fixture.json': 'c6fca3e6a0b0c73e327eaab788f3a55d1418a626743695121dcb9eed512488ea',
    'consumer.py': '60e03185e168adcec6e505fc84c6a664939fc3599641369067e666cfa99d605f',
    'judge.py': '5671dcda710f7ec970252849dfe7be1cf49f57baf6e0f89814a46ab6f69bdf30',
}
ARMS = ('source_only', 'typed_pair')
CLAIM = 'graph_evidence_claim_scope=typed_path_and_endpoint_projection_only'
DISCOVERY = 'graph_query_discovery=omegarag-query-body/v1'
PATH = 'ContentMediaLink.contentData.ContentData'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def expected_plan(query):
    return {'query': query, 'mode': 'BALANCED', 'recipe': 'ENTITY_NEIGHBORHOOD',
            'includeEvaluator': False, 'budgets': {'maxGraphHops': 1, 'maxLatencyMs': 1200, 'maxCandidates': 8}}


def expected_tool(query, plan_id, arm):
    result = {'query': query, 'planId': plan_id, 'objectTypes': ['ContentData'], 'maxResults': 1}
    if arm == 'source_only':
        result.update(queryMode='ENTITY', maxHops=0, maxNodes=1)
    else:
        result.update(queryMode='PATH', discoverPathFromQuery=True, graphPaths=[PATH], direction='INBOUND',
                      maxHops=1, maxNodes=2, maxEdges=1)
    return result


def source_bindings(case, setup):
    known = {row['key']: row for row in case['rows']}
    bindings = setup['bindings']
    assert set(bindings) == set(known)
    assert len({b['nativeId'] for b in bindings.values()}) == len(bindings)
    for key, binding in bindings.items():
        assert re.fullmatch(r'[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}', binding['nativeId'])
        assert binding['schemaName'] == ('ContentData' if key == 'anchor' else 'ContentMediaLink')
        assert binding['field'] == ('contentData' if key == 'anchor' else 'fileName')
        assert binding['excluded'] is bool(known[key].get('sourceSuffix'))
        assert binding['suppliedTags'] == known[key].get('tags', [])
        assert binding['nativeTagsStored'] is False
        assert binding['textSha256'] == hashlib.sha256(known[key]['text'].encode()).hexdigest()
    assert setup['mappingVersion'] == 'content-body-inbound/v1'
    assert setup['suppliedLinks'] == case['links']
    assert setup['linked'] is bool(case['links'])
    assert setup['freeLinkLabelsRetainedAsAuthority'] is False
    return bindings


def page_parts(response, receipt, expected_ids, status):
    copied = response['retrievalReceipt']
    for key in ('id', 'receiptId', 'ownerId', 'tenantId', 'query', 'bindingHash', 'answerPolicy'):
        assert copied[key] == receipt[key], key
    page = response['contextPage']
    assert page['status'] == status and page['taskIntent'] == receipt['query']
    assert page['ownerId'] == receipt['ownerId'] and page['tenantId'] == receipt['tenantId']
    assert re.match(r'typed_path_endpoints/v1=[0-9a-f]{64};', page['policy'])
    assert len(page['items']) == len(page['hydrationPointers']) == 2
    items = {item['sourceId']: item for item in page['items']}
    pointers = {pointer['targetId']: pointer for pointer in page['hydrationPointers']}
    assert set(items) == set(pointers) == set(expected_ids)
    assert len({item['itemRef'] for item in items.values()}) == 2
    assert len({pointer['pointerRef'] for pointer in pointers.values()}) == 2
    for ident, item in items.items():
        pointer = pointers[ident]
        assert item['sourceType'] == pointer['targetType'] == 'generated_domain_record'
        assert item['retained'] is True
        assert re.fullmatch(r'graph-projection:[0-9a-f]{64}', pointer['sourceVersion'])
        if status == 'hydrated':
            assert pointer['status'] == 'hydrated' and item['hydrated'] is True
            assert pointer['summary'] == item['summary']
    return page, items, pointers


def extract(case, setup, raw, arm, capture):
    """Return only directly observed current native text; never reconstruct facts or endpoint IDs."""
    status = raw['status']
    assert isinstance(raw['elapsedNanos'], int) and raw['elapsedNanos'] >= 0
    if setup['status'] != 'ready':
        assert status == 'setup_unavailable' and raw['attempted'] is False
        return [], False, False, status
    bindings = source_bindings(case, setup)
    assert raw['attempted'] is True
    assert raw['planRequest'] == expected_plan(case['query'])
    if raw.get('planHttpStatus') != 200:
        assert status in ('native_denied', 'native_rejected', 'runtime_error')
        return [], False, False, 'plan_not_admitted'
    plan = raw['planResponse']['plan']
    assert plan['ownerId'] == capture['actorId']
    assert plan['tenantId'] == 'org_' + capture['tenantId'].replace('-', '')
    if 'toolRequest' in raw:
        assert raw['toolRequest'] == expected_tool(case['query'], plan['planId'], arm)
    if status in ('native_rejected', 'runtime_error'):
        return [], False, False, status
    if raw.get('toolHttpStatus') != 200:
        assert status == 'native_denied' and raw['toolHttpStatus'] in (403, 404, 409)
        return [], False, True, status
    tool = raw['toolResponse']
    assert tool['planRef'] == plan['planId']
    assert DISCOVERY in tool['policyFlags']
    if raw.get('receiptHttpStatus') != 200:
        assert status == 'native_denied' and raw['receiptHttpStatus'] in (403, 404, 409)
        return [], False, True, 'current_receipt_denied'
    receipt = raw['receiptResponse']['receipt']
    assert receipt['ownerId'] == capture['actorId'] and receipt['tenantId'] == plan['tenantId']
    assert receipt['query'] == case['query'] and receipt['planRef'] == plan['planId']
    assert receipt['receiptId'] == tool['receiptRef']
    if any(str(note).startswith('omega_provider_failure=graph:')
           for note in receipt.get('policy', {}).get('policyNotes', [])):
        return [], False, False, 'graph_provider_unavailable'
    items = receipt.get('items') or []
    if not items:
        assert status == 'native_withheld'
        return [], False, True, 'empty_current_receipt'
    assert len(items) == 1
    selected = items[0]
    if arm == 'source_only':
        anchor = bindings['anchor']
        assert len(selected['graphPathCitations']) == 1
        entity = selected['graphPathCitations'][0]
        assert entity['queryMode'] == 'ENTITY' and entity['hopCount'] == 0 and entity['edges'] == []
        assert entity['seed']['entityId'] == entity['target']['entityId'] == anchor['nativeId']
        assert selected['entityType'].lower() == 'contentdata' and selected['entityId'] == anchor['nativeId']
        assert raw['readRequest'] == {'planId': plan['planId'], 'query': case['query'],
            'searchReceiptRef': receipt['receiptId'], 'sourceRef': selected['memoryId'], 'maxBytes': 4096, 'maxTokens': 1024}
        if raw.get('readHttpStatus') != 200:
            assert status == 'native_denied' and raw['readHttpStatus'] in (403, 404, 409)
            return [], False, False, 'source_read_unavailable'
        read = raw['readResponse']
        assert read['planRef'] == plan['planId'] and read['searchReceiptRef'] == receipt['receiptId']
        assert read['sourceRef'] == selected['memoryId'] and read['entityId'] == anchor['nativeId']
        assert read['entityType'] == 'ContentData'
        if read['status'] != 'OK' or read['truncated']:
            return [], False, True, 'source_read_truncated'
        text = read['structuredFields']['contentData']
        assert text == next(row['text'] for row in case['rows'] if row['key'] == 'anchor')
        permitted = receipt['answerPolicy'] == 'ALLOW_ANSWER'
        return [{'id': 'anchor', 'text': text}], permitted, True, 'current_source_read'
    # A path cannot be invented for an unlinked assignment or disclose an excluded endpoint.
    assert setup['linked'] and 'detail' in bindings and not bindings['detail']['excluded']
    assert selected['entityType'].lower() == 'contentmedialink' and selected['entityId'] == bindings['detail']['nativeId']
    typed = receipt['answerPolicy'] == 'ALLOW_WITH_CAVEAT' and CLAIM in receipt.get('policy', {}).get('policyNotes', [])
    if not typed:
        assert status == 'native_withheld'
        return [], False, True, 'typed_claim_withheld'
    assert len(selected['graphPathCitations']) == len(tool['evidence']) == 1
    path = selected['graphPathCitations'][0]
    assert path['queryMode'] == 'PATH' and path['hopCount'] == 1 and len(path['edges']) == 1
    assert path['seed']['entityId'] == bindings['anchor']['nativeId'] and path['seed']['schemaName'] == 'ContentData'
    assert path['target']['entityId'] == bindings['detail']['nativeId'] and path['target']['schemaName'] == 'ContentMediaLink'
    assert path['edges'][0]['canonicalPath'] == PATH and path['edges'][0]['direction'] == 'INBOUND'
    tool_path = tool['evidence'][0]['graphPathCitations'][0]
    for key in ('pathHash', 'citationId', 'exactPath'):
        assert path[key] == tool_path[key]
    assert raw['compileRequest'] == {'taskIntent': case['query'], 'retrievalReceipt': {'id': receipt['id']},
                                     'includeTypedPathEndpoints': True, 'tokenBudget': 1024}
    if raw.get('compileHttpStatus') != 200:
        assert status == 'native_denied' and raw['compileHttpStatus'] in (403, 404, 409)
        return [], False, True, 'typed_compile_denied'
    expected_ids = {'contentdata:' + bindings['anchor']['nativeId']: 'anchor',
                    'contentmedialink:' + bindings['detail']['nativeId']: 'detail'}
    before, before_items, before_ptr = page_parts(raw['compileResponse'], receipt, expected_ids, 'compiled')
    assert raw['hydrateRequest'] == {'contextPageRef': before['pageRef'], 'maxItems': 2, 'maxTokens': 1024}
    if raw.get('hydrateHttpStatus') != 200:
        assert status == 'native_denied' and raw['hydrateHttpStatus'] in (403, 404, 409)
        return [], False, True, 'typed_hydrate_denied'
    after, hydrated, pointers = page_parts(raw['hydrateResponse'], receipt, expected_ids, 'hydrated')
    assert before['pageRef'] == after['pageRef']
    sources = []
    for ident, key in expected_ids.items():
        for field in ('pointerRef', 'sourceVersion'):
            assert before_ptr[ident][field] == pointers[ident][field]
        for field in ('itemRef', 'sourceHash'):
            assert before_items[ident][field] == hydrated[ident][field]
        text = hydrated[ident]['summary']
        assert next(row['text'] for row in case['rows'] if row['key'] == key) in text
        sources.append({'id': key, 'text': text})
    assert pointers['contentmedialink:' + bindings['detail']['nativeId']]['sourceVersion'] == 'graph-projection:' + selected['textHash']
    return sources, True, True, 'current_typed_pair'


def evaluate(capture, protocol_path, frozen):
    protocol = json.loads(protocol_path.read_text())
    assert capture['schemaVersion'] == 'cloud-dispatch-body-capture/v1'
    assert capture['protocolSha256'] == digest(protocol_path)
    assert capture['mappingVersion'] == protocol['mapping']['version'] == 'content-body-inbound/v1'
    assert protocol['schemaVersion'] == 'cloud-dispatch-body-protocol/v1'
    for name, expected in FROZEN.items():
        assert digest(frozen / name) == expected
        assert protocol['frozenInputs'][name] == expected
    assert capture['fixtureSha256'] == FROZEN['fixture.json']
    identity = capture['requesterIdentity']
    assert identity['actorId'] == capture['actorId'] and identity['organizationId'] == capture['tenantId']
    assert identity['organizationRole'] == 'org_member' and identity['status'] == 'active' and identity['personalTenant'] is False
    assert set(identity['authorities']) == {'ROLE_EVERYONE', 'ROLE_FREE', 'ROLE_GRAYMATTER_USER'}
    fixture = json.loads((frozen / 'fixture.json').read_text())
    assert [row['id'] for row in capture['cases']] == [case['id'] for case in fixture['cases']]
    consumer = module('frozen_dispatch_consumer', frozen / 'consumer.py')
    judge = module('frozen_dispatch_judge', frozen / 'judge.py')
    results = []
    for case, observed in zip(fixture['cases'], capture['cases']):
        assert observed['query'] == case['query'] and observed['shipmentId'] == case['shipmentId']
        assert len(observed['warmups']) == 2 and len(observed['trials']) == 7
        assert observed['setup']['status'] in ('ready', 'capacity_rejected', 'setup_error')
        if observed['setup']['status'] == 'capacity_rejected':
            assert any(len(row['text']) > observed['setup']['bodyColumnCapacity' if row['key'] == 'anchor' else 'columnCapacity'] for row in case['rows'])
        arms = {arm: [] for arm in ARMS}
        for phase in ('warmups', 'trials'):
            for iteration, trial in enumerate(observed[phase]):
                assert set(trial) == {'iteration', *ARMS} and trial['iteration'] == iteration
                for arm in ARMS:
                    sources, permitted, available, boundary = extract(case, observed['setup'], trial[arm], arm, capture)
                    assert not any(next(row for row in case['rows'] if row['key'] == source['id']).get('sourceSuffix') for source in sources)
                    output = consumer.execute(case['shipmentId'], sources, permitted)
                    verdict = judge.score(case, output, [source['id'] for source in sources])
                    if phase == 'trials':
                        arms[arm].append({'output': output, 'judge': verdict, 'available': available,
                            'qualifiedCorrect': available and verdict['correct'], 'boundary': boundary,
                            'sourceIds': [source['id'] for source in sources],
                            'evidenceUtf8Bytes': sum(len(source['text'].encode()) for source in sources),
                            'nativePipelineNanos': trial[arm]['elapsedNanos']})
        results.append({'id': case['id'], 'family': case['family'], 'setupStatus': observed['setup']['status'], 'arms': arms})
    summary = {}
    for arm in ARMS:
        summary[arm] = {'assignedTasks': 12,
            'availableTasks': sum(all(t['available'] for t in row['arms'][arm]) for row in results),
            'correctTasks': sum(all(t['qualifiedCorrect'] for t in row['arms'][arm]) for row in results),
            'unsupportedActionTasks': sum(any(t['judge']['unsupportedAction'] for t in row['arms'][arm]) for row in results),
            'stableTaskOutputs': sum(all(t['output'] == row['arms'][arm][0]['output'] for t in row['arms'][arm]) for row in results),
            'medianPipelineMsByTask': {row['id']: statistics.median(t['nativePipelineNanos'] for t in row['arms'][arm]) / 1e6 for row in results}}
    return {'schemaVersion': 'cloud-dispatch-body-results/v1', 'captureSha256': hashlib.sha256(json.dumps(capture, sort_keys=True).encode()).hexdigest(),
            'summary': summary, 'cases': results,
            'limits': ['12 tasks; seven repetitions do not increase sample independence',
                       'No unavailable setup/runtime trial receives correct-abstention credit',
                       'Lossless text mapping; supplied detail tags/free link labels are capture-only metadata, not native authority',
                       'Direct tasks have no typed FK and no source-only fallback',
                       'Typed FK, projected text, ACL scope and work budgets differ from rival native mappings']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, default=Path(__file__).with_name('protocol.json'))
    parser.add_argument('--frozen', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(args.capture.read_text()), args.protocol, args.frozen)
    with args.out.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary'], indent=2))
