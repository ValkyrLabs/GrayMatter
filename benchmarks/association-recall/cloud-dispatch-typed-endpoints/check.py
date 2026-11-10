"""Replay the exact task outputs and reject contradictory captured provenance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from score import evaluate

ROOT = Path(__file__).resolve().parent
FROZEN = ROOT.parent / 'dispatch-task'


def without_timing(result):
    return [{key: value for key, value in row.items() if key != 'offlineConsumerNanos'}
            for row in result['results']]


def reject(capture):
    try:
        evaluate(capture, FROZEN)
    except AssertionError:
        return
    raise AssertionError('Contradictory provenance reached the frozen consumer')


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    assert hashlib.sha256((ROOT.parent / 'cloud-dispatch-query-free/manifest.json').read_bytes()).hexdigest() == manifest['baselineSha256']
    for name, expected in manifest['files'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    capture = json.loads((ROOT / 'native-capture.json').read_text())
    result = evaluate(capture, FROZEN)
    assert without_timing(result) == without_timing(json.loads((ROOT / 'results.json').read_text()))
    for row in result['results']:
        paired = row['arm'] == 'hydrated_endpoints'
        assert row['judge']['correct'] is paired
        assert row['judge']['unsupportedAction'] is False
        assert row['output']['status'] == ('ready' if paired else 'insufficient')
    altered = deepcopy(capture)
    altered['observations'][0]['hydratedPage']['retrievalReceipt']['bindingHash'] = '0' * 64
    reject(altered)
    altered = deepcopy(capture)
    altered['observations'][0]['hydratedPage']['contextPage']['hydrationPointers'][0]['sourceVersion'] = 'graph-projection:' + '0' * 64
    reject(altered)
    altered = deepcopy(capture)
    altered['observations'][0]['hydratedPage']['contextPage']['items'][0]['summary'] = 'replaced projection'
    reject(altered)
    altered = deepcopy(capture)
    altered['observations'][1] = altered['observations'][0]
    reject(altered)
    print('4/4 frozen outcomes reproduced; 4/4 contradictory-capture controls rejected')


if __name__ == '__main__':
    main()
