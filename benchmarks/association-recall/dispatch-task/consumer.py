"""Closed-schema dispatch workflow; no oracle, product identity or corpus access."""
import hashlib
import json

FIELDS = ('pickupCode', 'gate', 'packingSymbol')
MAX_BYTES = 1024
MAX_SOURCES = 16


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate field')
        result[key] = value
    return result


def execute(shipment_id, sources, permitted=True):
    if not permitted:
        return {'status': 'withheld', 'packet': None, 'citations': {}}
    if len(sources) > MAX_SOURCES or sum(len(s['text'].encode()) for s in sources) > MAX_BYTES:
        return {'status': 'budget_exceeded', 'packet': None, 'citations': {}}
    values = {field: {} for field in FIELDS}
    for source in sources:
        for line in source['text'].splitlines():
            if not line.startswith('FACT '):
                continue
            try:
                fact = json.loads(line[5:], object_pairs_hook=strict_object)
                if not isinstance(fact, dict) or fact.get('schema') != 'dispatch-fact/v1':
                    raise ValueError('schema')
                if set(fact) - {'schema', 'shipmentId', *FIELDS}:
                    raise ValueError('unknown field')
                if fact.get('shipmentId') != shipment_id:
                    continue
                for field in FIELDS:
                    if field not in fact:
                        continue
                    value = fact[field]
                    if not isinstance(value, str) or not value or len(value) > 64:
                        raise ValueError('value')
                    values[field].setdefault(value, []).append(source['id'])
            except (ValueError, TypeError):
                return {'status': 'invalid_evidence', 'packet': None, 'citations': {}}
    if any(len(found) > 1 for found in values.values()):
        return {'status': 'conflict', 'packet': None, 'citations': {}}
    if any(not found for found in values.values()):
        return {'status': 'insufficient', 'packet': None, 'citations': {}}
    packet = {'shipmentId': shipment_id, **{field: next(iter(values[field])) for field in FIELDS}}
    citations = {field: sorted(set(next(iter(values[field].values())))) for field in FIELDS}
    canonical = json.dumps(packet, sort_keys=True, separators=(',', ':')).encode()
    return {'status': 'ready', 'packet': packet, 'citations': citations,
            'packetSha256': hashlib.sha256(canonical).hexdigest()}
