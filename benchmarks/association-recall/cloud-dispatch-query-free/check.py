"""Verify captured provenance and reproduce the frozen-consumer outcomes offline."""
import copy
import hashlib
import json
from pathlib import Path
import score

HERE = Path(__file__).resolve().parent
FROZEN = HERE.parent / 'dispatch-task'


def main():
    manifest = json.loads((HERE / 'manifest.json').read_text())
    for name, digest in manifest['files'].items():
        assert hashlib.sha256((HERE / name).read_bytes()).hexdigest() == digest, name
    qualification = json.loads((HERE / 'qualification.json').read_text())
    for name, digest in qualification['frozenReferences'].items():
        assert hashlib.sha256((FROZEN / name).read_bytes()).hexdigest() == digest, name
    capture = json.loads((HERE / 'native-capture.json').read_text())
    saved = json.loads((HERE / 'results.json').read_text())
    rerun = score.evaluate(capture, FROZEN)
    for expected, actual in zip(saved['results'], rerun['results']):
        expected.pop('offlineConsumerNanos')
        actual.pop('offlineConsumerNanos')
        assert expected == actual
    assert len(rerun['results']) == 4
    assert all(row['output']['status'] == 'insufficient' for row in rerun['results'])
    assert all(not row['judge']['unsupportedAction'] for row in rerun['results'])
    assert all(not row['literalTargetInputPreservedInSnippet'] for row in rerun['results'])
    for field in ('entityId', 'query', 'scope'):
        changed = copy.deepcopy(capture)
        receipt = changed['observations'][0]['receipt']
        if field == 'entityId':
            receipt['items'][0]['entityId'] = '00000000-0000-0000-0000-000000000000'
        elif field == 'query':
            receipt['query'] = 'different query'
        else:
            receipt['policy']['policyNotes'] = []
        try:
            score.evaluate(changed, FROZEN)
        except AssertionError:
            pass
        else:
            raise AssertionError('tampered ' + field + ' accepted')
    print('4/4 captured decisions reproduced; 3/3 receipt-consistency tamper controls rejected')


if __name__ == '__main__':
    main()
