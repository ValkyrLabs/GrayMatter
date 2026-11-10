"""Score captured native projections with the unchanged frozen consumer and judge."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import time


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def evaluate(capture, frozen):
    fixture = json.loads((frozen / 'fixture.json').read_text())
    assert hashlib.sha256((frozen / 'fixture.json').read_bytes()).hexdigest() == 'c6fca3e6a0b0c73e327eaab788f3a55d1418a626743695121dcb9eed512488ea'
    consumer = module('frozen_dispatch_consumer', frozen / 'consumer.py')
    judge = module('frozen_dispatch_judge', frozen / 'judge.py')
    tasks = {case['id']: case for case in fixture['cases'] if case['family'] == 'query-free'}
    result = []
    for observed in capture['observations']:
        case = tasks[observed['case']]
        assert observed['query'] == case['query']
        assert observed['shipmentId'] == case['shipmentId']
        if not observed['succeeded']:
            result.append({'case': case['id'], 'nativeCompleted': False,
                           'failureClass': observed['failureClass'], 'failure': observed['failure']})
            continue
        ids = capture['plantedIdentityMapForIndependentJudgeOnly'][case['id']]
        anchor = observed['discovery']
        assert anchor == observed['currentDiscovery']
        assert anchor['id'] == ids['anchor']
        assert anchor['contentDataId'] == ids['detail']
        assert anchor['fileName'] == case['rows'][0]['text']
        assert len(observed['targetEvidence']) == 1
        receipt = observed['receipt']
        assert receipt['answerPolicy'] == 'ALLOW_WITH_CAVEAT'
        assert len(receipt['items']) == 1
        assert receipt['items'][0]['entityId'] == ids['detail']
        proof = receipt['items'][0]['graphPathCitations'][0]
        assert proof['edges'][0]['canonicalPath'] == 'ContentMediaLink.contentData.ContentData'
        target = observed['targetEvidence'][0]
        text = target['snippet']
        # This is validation of actual captured projection, never an input replacement.
        literal_target_preserved = case['rows'][1]['text'] in text
        assert receipt['query'] == case['query']
        notes = receipt['policy']['policyNotes']
        assert 'graph_evidence_claim_scope=typed_path_and_endpoint_projection_only' in notes
        assert 'generated_graph_proof_items=1' in notes
        for arm, sources in [
            ('target_only', [{'id': 'detail', 'text': text}]),
            ('source_plus_target', [{'id': 'anchor', 'text': anchor['fileName']},
                                    {'id': 'detail', 'text': text}])]:
            started = time.perf_counter_ns()
            output = consumer.execute(case['shipmentId'], sources)
            elapsed = time.perf_counter_ns() - started
            result.append({'case': case['id'], 'arm': arm, 'nativeCompleted': True,
                           'sources': sources, 'nativeSourceIds': ids,
                           'output': output, 'judge': judge.score(case, output, [s['id'] for s in sources]),
                           'evidenceUtf8Bytes': sum(len(s['text'].encode()) for s in sources),
                           'literalTargetInputPreservedInSnippet': literal_target_preserved,
                           'nativePipelineNanos': observed['elapsedNanos'],
                           'offlineConsumerNanos': elapsed,
                           'receiptRef': receipt['receiptId'],
                           'scope': 'Internal service source discovery plus exact typed target; client union, not a merged Cloud receipt'})
    return {'schemaVersion': 'cloud-dispatch-query-free-results/v1', 'results': result,
            'limits': ['Two selected query-free cases, one native trial each; no general capability ranking.',
                       'Discovery uses ACL-filtered generated backend service in an authenticated tenant scope; CORE-only HTTP discovery remains unavailable to this ordinary tenant actor.',
                       'Typed path authorizes endpoint projection only. Multi-source packet assembly is an explicit external deterministic consumer.',
                       'Fixture records and relationships were seeded by the test using real audited persistence and ACL enrollment; no source extraction model.',
                       'Native pipeline time includes query, plan, path, current receipt GET and source recheck; offline consumer timing is separate.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--frozen', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(args.capture.read_text()), args.frozen)
    with args.out.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps([{'case': r['case'], 'arm': r.get('arm'), 'status': r.get('output', {}).get('status'),
                       'correct': r.get('judge', {}).get('correct')} for r in result['results']], indent=2))
