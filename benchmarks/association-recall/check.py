#!/usr/bin/env python3
"""Check frozen evidence expectations and summarize matched Lite recall observations."""
import argparse
import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN_FIXTURE_SHA256 = 'c88f1c7ab95d897c7f00b3f284cb586338c39d364de226ec671a04f4038cf985'


def evaluate(case, observed, mode):
    evidence = observed['modes'][mode]
    response = evidence['firstMeasuredResponse']
    body = response['body'] or {}
    ids = {row['id']: key for key, row in observed['state']['rows'].items()}
    keys = [ids[item['memoryId']] for item in body.get('items', [])]
    context = body.get('context') or ''
    oracle = case['oracle']
    relevant = set(oracle['relevantKeys'])
    required = set(oracle.get('requiredAnswerKeys', []))
    absent = not context and not keys and not body.get('contextPageRef')
    abstained = absent and body.get('answerPolicy') != 'ALLOW_ANSWER'
    answer = required <= set(keys) and oracle.get('answerText', '') in context if required else None
    result = {'case': case['id'], 'mode': mode, 'httpStatus': response['status'],
              'status': body.get('retrievalStatus'), 'keys': keys,
              'answerEvidenceComplete': answer,
              'requiredAbstentionMet': abstained if oracle.get('requiresAbstention') else None,
              'precision': len(set(keys) & relevant) / len(set(keys)) if keys else None,
              'forbiddenKeys': sorted(set(keys) & set(oracle.get('forbiddenKeys', []))),
              'medianMs': evidence['medianMs'], 'p95NearestRankMs': evidence['p95NearestRankMs'],
              'tokenEstimate': body.get('tokenEstimate'), 'contextUtf8Bytes': len(context.encode())}
    for trial in evidence['trials']:
        assert trial['sourceKeys'] == keys
        assert trial['retrievalStatus'] == body.get('retrievalStatus')
        assert trial['answerEvidenceComplete'] == answer
        assert trial['contextUtf8Bytes'] <= trial['budget']
        if trial['tokenEstimate'] is not None:
            assert trial['tokenEstimate'] == trial['contextUtf8Bytes']
        if trial['answerPolicy'] != 'ALLOW_ANSWER':
            assert trial['abstained']
    return result


def check(path, fixture, candidate):
    data = json.loads(path.read_bytes())
    assert data['fixtureSha256'] == FROZEN_FIXTURE_SHA256
    assert data['runtime'] == fixture['runtime']
    assert len(data['cases']) == len(fixture['cases'])
    results = []
    for case, observation in zip(fixture['cases'], data['cases']):
        assert case['id'] == observation['id']
        by_mode = {}
        for mode in ['disabled', 'expanded']:
            value = evaluate(case, observation, mode)
            assert len(observation['modes'][mode]['trials']) == fixture['timing']['measuredRepetitions']
            results.append(value)
            by_mode[mode] = value
        if candidate:
            expanded = by_mode['expanded']
            assert expanded['httpStatus'] == 200, expanded
            assert sorted(expanded['keys']) == sorted(case['oracle']['expectedExpandedKeys']), expanded
            assert expanded['status'] == case['oracle']['expectedExpandedStatus'], expanded
            assert not expanded['forbiddenKeys'], expanded
            body = observation['modes']['expanded']['firstMeasuredResponse']['body']
            assert body.get('associationPolicyVersion') == 'graymatter-association-recall/v1', case['id']
            assert body.get('associationTruncated') is False, case['id']
            sources = {row['id']: row for row in observation['state']['rows'].values()}
            edges = {edge['associationRef']: edge for edge in observation['state']['edges']}
            for trace in body.get('associationRefs', []):
                assert set(trace) == {'associationRef', 'anchorId', 'memoryId',
                                      'associationHash', 'anchorSourceHash', 'sourceHash'}, trace
                edge = edges[trace['associationRef']]
                assert trace['anchorId'] == edge['fromId']
                assert trace['memoryId'] == edge['toId']
                assert trace['anchorSourceHash'] == sources[trace['anchorId']]['sourceHash']
                assert trace['sourceHash'] == sources[trace['memoryId']]['sourceHash']
                assert re.fullmatch('[0-9a-f]{64}', trace['associationHash'])
            ordinary = observation['modes']['disabled']['firstMeasuredResponse']['body']
            assert not ordinary.get('associationPolicyVersion')
            assert not ordinary.get('associationRefs')
        else:
            assert by_mode['disabled']['httpStatus'] == 200
            if by_mode['expanded']['httpStatus'] == 200:
                assert by_mode['disabled']['keys'] == by_mode['expanded']['keys']
                assert by_mode['disabled']['status'] == by_mode['expanded']['status']
    lifecycle = []
    for scenario in data['lifecycle']:
        mutation = scenario['mutation']
        after = scenario['after']['expanded']
        row = {'mutation': mutation, 'anchorRead': scenario['anchorReadAfter']['status'],
               'edgeRead': scenario['edgeReadAfter']['status']}
        if after['available']:
            row.update({'receiptStatus': after['inspect']['body'].get('retrievalStatus'),
                        'hydrateAnswer': after['hydrateAnswer']['status'],
                        'recompressStatus': (after['recompress']['body'] or {}).get('retrievalStatus'),
                        'refreshStatus': (after['refresh']['body'] or {}).get('retrievalStatus')})
            if candidate:
                assert row['receiptStatus'] == 'STALE_CONTEXT', row
                assert not after['inspect']['body'].get('associationRefs'), row
                assert row['hydrateAnswer'] == 409, row
                body = after['recompress']['body'] or {}
                assert body.get('answerPolicy') != 'ALLOW_ANSWER' and not body.get('items') and not body.get('context'), row
        lifecycle.append(row)
    return {'file': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'jarSha256': data['jarSha256'], 'cases': results, 'lifecycle': lifecycle}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path, nargs='?')
    args = parser.parse_args()
    raw = (HERE / 'fixture.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == FROZEN_FIXTURE_SHA256
    fixture = json.loads(raw)
    baseline = check(args.baseline, fixture, False)
    assert baseline['jarSha256'] == fixture['baselineJarSha256']
    result = {'fixtureSha256': FROZEN_FIXTURE_SHA256, 'baseline': baseline}
    if args.candidate:
        candidate = check(args.candidate, fixture, True)
        assert candidate['jarSha256'] != baseline['jarSha256']
        for old, new in zip(baseline['cases'], candidate['cases']):
            if old['mode'] == 'disabled':
                for field in ['keys', 'status', 'answerEvidenceComplete', 'requiredAbstentionMet']:
                    assert old[field] == new[field], (old['case'], field, old[field], new[field])
        result['candidate'] = candidate
    print(json.dumps(result, indent=2, ensure_ascii=False))
