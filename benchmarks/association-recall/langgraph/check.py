#!/usr/bin/env python3
"""Validate actual SDK results independently, then juxtapose the same-input Lite capture."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
PROTOCOL_HASH = 'ed56d37780998b21f3e33751c5f7b2ea760021f031459736fa15950a5197258e'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tokens(text):
    return Counter(re.findall('[a-z0-9]+', text.lower()))


def cosine(left, right):
    left, right = tokens(left), tokens(right)
    scale = math.sqrt(sum(n * n for n in left.values()) * sum(n * n for n in right.values()))
    return sum(n * right[word] for word, n in left.items()) / scale if scale else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('observation', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    assert sha(HERE / 'protocol.json') == PROTOCOL_HASH
    protocol = json.loads((HERE / 'protocol.json').read_text())
    fixture_path = HERE / protocol['fixture']
    lite_path = HERE / protocol['liteObservation']
    assert sha(fixture_path) == protocol['fixtureSha256']
    assert sha(lite_path) == protocol['liteObservationSha256']
    fixture = json.loads(fixture_path.read_text())
    lite = json.loads(lite_path.read_text())
    observed = json.loads(args.observation.read_text())
    assert observed['protocolSha256'] == PROTOCOL_HASH
    assert observed['driverSha256'] == sha(HERE / 'run.cjs')
    assert observed['sdk']['version'] == '1.2.2'
    assert observed['fixtureSha256'] == protocol['fixtureSha256']
    assert observed['sdk']['packageLockSha256'] == sha(HERE / protocol['sdk']['lock'])
    modules = HERE / '../../store-context-probe/node_modules'
    for name, digest in observed['sdk']['loadedRuntimeFiles'].items():
        assert sha(modules / name) == digest, name
    assert '@langchain/langgraph-checkpoint/dist/store/memory.cjs' in observed['sdk']['loadedRuntimeFiles']
    assert len(observed['cases']) == len(fixture['cases']) == 14
    rows = []
    for scenario, result, lite_case in zip(fixture['cases'], observed['cases'], lite['cases']):
        assert scenario['id'] == result['id'] == lite_case['id']
        by_key = {row['key']: row for row in scenario['rows']}
        channel = 'association-recall:' + scenario['id']
        assert result['query'] == scenario['query']
        assert result['filter'] == {'sourceChannel': channel, 'type': 'context'}
        eligible = [row for row in scenario['rows'] if not row.get('sourceSuffix') and row.get('type', 'context') == 'context']
        ranked = sorted(eligible, key=lambda row: -cosine(scenario['query'], row['text']))
        top_k = fixture['retrieval']['topK']
        expected = {'nativeTopK': [row['key'] for row in ranked[:top_k]],
                    'nativeWide': [row['key'] for row in ranked[:top_k + 8]]}
        seeds = [row for row in ranked[:top_k] if cosine(scenario['query'], row['text']) > 0][:8]
        expected_hop = [row['key'] for row in seeds]
        # Independent declarative graph oracle; the driver must fetch these via SDK APIs.
        for seed in seeds:
            for edge in scenario['links']:
                if edge['from'] != seed['key']:
                    continue
                target = by_key[edge['to']]
                if not target.get('sourceSuffix') and target.get('type', 'context') == 'context':
                    if target['key'] not in expected_hop:
                        expected_hop.append(target['key'])
        expected['applicationOneHop'] = expected_hop
        table = {'case': scenario['id']}
        for arm, expected_keys in expected.items():
            run = result['arms'][arm]
            first = run['first']
            assert first['keys'] == expected_keys, (scenario['id'], arm, first['keys'], expected_keys)
            assert len(run['trials']) == 7
            for item in first['items']:
                original = by_key[item['key']]
                assert item['value'] == {
                    'text': original['text'], 'tags': original.get('tags', []),
                    'type': original.get('type', 'context'), 'sourceChannel': channel
                }
                if arm != 'applicationOneHop':
                    assert abs(item['score'] - cosine(scenario['query'], original['text'])) < 1e-12
            bodies = '\n\n'.join(by_key[key]['text'] for key in expected_keys)
            byte_count = len(bodies.encode())
            assert first['returnedBodyUtf8Bytes'] == byte_count
            for trial in run['trials']:
                assert trial['keys'] == expected_keys
                assert trial['returnedBodyUtf8Bytes'] == byte_count
                assert math.isfinite(trial['elapsedMs']) and trial['elapsedMs'] >= 0
            required = scenario['oracle'].get('requiredAnswerKeys')
            present = all(key in expected_keys for key in required) and scenario['oracle']['answerText'] in bodies if required else None
            assert first['requiredEvidencePresent'] == present
            table[arm] = {'keys': expected_keys, 'requiredEvidencePresent': present,
                          'returnedBodyUtf8Bytes': byte_count, 'medianMs': run['medianMs'],
                          'nativeAnswerPolicy': None}
        hop = result['arms']['applicationOneHop']['first']['trace']
        assert not hop['truncated']
        assert [value['fromId'] for value in hop['edgeReads']] == [row['key'] for row in seeds]
        assert [value['value']['toId'] for entry in hop['edgeReads'] for value in entry['items']] == [
            edge['to'] for seed in seeds for edge in scenario['links'] if edge['from'] == seed['key']]
        expected_edges = [(index, edge) for seed in seeds for index, edge in enumerate(scenario['links'])
                          if edge['from'] == seed['key']]
        assert len(hop['targetReads']) == len(expected_edges)
        for target_read, (index, edge) in zip(hop['targetReads'], expected_edges):
            target = by_key[edge['to']]
            assert target_read['edgeKey'] == 'edge-' + str(index)
            assert target_read['target']['key'] == edge['to']
            assert target_read['target']['value']['text'] == target['text']
            assert target_read['target']['value']['sourceChannel'] == channel + (
                ':' + target['sourceSuffix'] if target.get('sourceSuffix') else '')
        for mode in ('disabled', 'expanded'):
            run = lite_case['modes'][mode]
            request = run['request']
            assert request['query'] == scenario['query']
            assert request['source'] == channel
            assert request['topK'] == top_k
            assert request['tokenBudget'] == scenario.get('tokenBudget', fixture['retrieval']['tokenBudget'])
            first = run['trials'][0]
            table['lite' + mode.title()] = {key: first[key] for key in (
                'sourceKeys', 'retrievalStatus', 'answerPolicy', 'answerEvidenceComplete',
                'contextUtf8Bytes', 'tokenEstimate')}
        rows.append(table)
    keyed = {row['case']: row for row in rows}
    assert keyed['query-free-detail']['applicationOneHop']['requiredEvidencePresent']
    assert keyed['query-free-detail']['liteExpanded']['answerEvidenceComplete'] is False
    assert keyed['incoming-edge']['applicationOneHop']['keys'] == ['anchor']
    assert keyed['two-hops']['applicationOneHop']['keys'] == ['anchor', 'middle']
    assert keyed['reciprocal-cycle']['applicationOneHop']['keys'] == ['anchor', 'answer']
    assert keyed['filter-boundary']['applicationOneHop']['keys'] == ['anchor']
    assert keyed['neutral-conflict']['applicationOneHop']['keys'] == keyed['supersedes-conflict']['applicationOneHop']['keys']
    mutations = {row['kind']: row for row in observed['lifecycle']}
    assert set(mutations) == set(protocol['lifecycle']['mutations'])
    original = fixture['cases'][0]['rows'][0]['text']
    for kind, row in mutations.items():
        assert row['detachedGetSnapshot']['value']['text'] == original
        assert row['receipt'] is None
        if kind == 'correct-anchor':
            assert row['currentSource']['value']['text'] == 'This source was corrected and retired.'
            assert row['liveGetObjectAfter']['value']['text'] == row['currentSource']['value']['text']
        elif kind == 'delete-anchor':
            assert row['currentSource'] is None
            assert row['currentEdge'] is not None
            assert row['liveGetObjectAfter']['value']['text'] == original
        else:
            assert row['currentEdge'] is None
            assert [item['key'] for item in row['currentApplication']['items']] == ['anchor']
    summary = {'version': protocol['version'], 'protocolSha256': PROTOCOL_HASH,
               'observationSha256': sha(args.observation), 'checkerSha256': sha(Path(__file__)),
               'liteObservationSha256': sha(lite_path), 'casesValidated': 14, 'lifecycleValidated': 3,
               'loadedSdkFilesValidated': len(observed['sdk']['loadedRuntimeFiles']),
               'rows': rows, 'interpretation': protocol['interpretation']}
    if args.output:
        with args.output.open('x') as output:
            json.dump(summary, output, indent=2)
            output.write('\n')
    print(json.dumps({key: summary[key] for key in ('casesValidated', 'lifecycleValidated', 'loadedSdkFilesValidated', 'observationSha256')}))


if __name__ == '__main__':
    main()
