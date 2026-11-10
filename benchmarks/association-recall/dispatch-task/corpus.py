"""Twelve precommitted populations; the consumer never imports this generator."""
import hashlib
import json
from pathlib import Path
import uuid

NAMESPACE = uuid.UUID('1b35b655-489f-47e4-b8d8-a075f0f0a410')
FAMILIES = ('direct', 'linked-partial', 'query-free', 'distractor', 'conflict', 'excluded-scope')
WORDS = ('Cypress', 'Dunlin', 'Elm', 'Flax', 'Garnet', 'Heron', 'Jasmine', 'Linden', 'Marigold', 'Osprey', 'Poppy', 'Quartz')


def fixture():
    cases = []
    for index, family in enumerate(f for f in FAMILIES for _ in range(2)):
        case_id = f'{family}-{index % 2 + 1}'
        shipment = str(uuid.uuid5(NAMESPACE, case_id))
        raw = hashlib.sha256(('dispatch-task/v1/' + case_id).encode()).hexdigest()
        fact = {'schema': 'dispatch-fact/v1', 'shipmentId': shipment,
                'pickupCode': 'code-' + raw[:8], 'gate': 'gate-' + raw[8:12],
                'packingSymbol': 'symbol-' + raw[12:18]}
        query = WORDS[index] + ' shipment'
        anchor_fact = fact if family in ('direct', 'distractor', 'conflict') else {k:v for k,v in fact.items() if k != 'packingSymbol'}
        def text(prefix, value):
            return prefix + '\nFACT ' + json.dumps(value, sort_keys=True, separators=(',', ':'))
        rows = [{'key': 'anchor', 'text': text(f'{query} dispatch. {query} verified manifest. {query} collection.', anchor_fact)}]
        links = []
        if family != 'direct':
            detail = {'schema': fact['schema'], 'shipmentId': shipment, 'packingSymbol': fact['packingSymbol']}
            prefix = 'Shipment packing details.'
            if family == 'query-free':
                prefix = 'Packaging instruction.'
            if family == 'distractor':
                detail = {**fact, 'shipmentId': str(uuid.uuid5(NAMESPACE, case_id + '-other')),
                          'pickupCode': 'do-not-use'}
                prefix = 'Shipment manifest for another consignment.'
            if family == 'conflict':
                detail = {'schema': fact['schema'], 'shipmentId': shipment, 'pickupCode': 'conflicting-code'}
                prefix = 'Shipment pickup code remains disputed and requires verification.'
            rows.append({'key': 'detail', 'text': text(prefix, detail),
                         **({'sourceSuffix': 'excluded'} if family == 'excluded-scope' else {}),
                         **({'tags': ['unresolved']} if family == 'conflict' else {})})
            links.append({'from': 'anchor', 'to': 'detail', 'relation': 'supersedes' if family == 'conflict' else 'packing note'})
        cases.append({'id': case_id, 'family': family, 'query': query, 'shipmentId': shipment,
                      'instruction': 'Return a supported dispatch packet with pickupCode, gate and packingSymbol, or abstain.',
                      'rows': rows, 'links': links})
    return {'version': 'dispatch-task-fixture/v1', 'cases': cases}


if __name__ == '__main__':
    target = Path(__file__).with_name('fixture.json')
    with target.open('x') as stream:
        stream.write(json.dumps(fixture(), indent=2) + '\n')
