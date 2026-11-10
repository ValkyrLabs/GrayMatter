"""Independent full-input SQLite oracle and exact result/citation judge."""
import hashlib
import json
import sqlite3


def oracle(case):
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE facts (field TEXT, value TEXT, source TEXT)')
    try:
        for source in case['rows']:
            if source.get('sourceSuffix'):
                continue
            for line in source['text'].splitlines():
                if line[:5] != 'FACT ':
                    continue
                record = json.loads(line[5:])
                if record['shipmentId'] != case['shipmentId']:
                    continue
                for key, value in record.items():
                    if key in ['pickupCode', 'gate', 'packingSymbol']:
                        db.execute('INSERT INTO facts VALUES (?,?,?)', (key, value, source['key']))
        counts = dict(db.execute('SELECT field,COUNT(DISTINCT value) FROM facts GROUP BY field'))
        if any(count > 1 for count in counts.values()):
            return {'action': 'abstain', 'reason': 'conflicting facts'}
        if len(counts) != 3:
            return {'action': 'abstain', 'reason': 'missing authorized facts'}
        packet = {'shipmentId': case['shipmentId'], **dict(db.execute('SELECT field,MIN(value) FROM facts GROUP BY field'))}
        support = {field: [r[0] for r in db.execute('SELECT DISTINCT source FROM facts WHERE field=? ORDER BY source', (field,))]
                   for field in counts}
        return {'action': 'ready', 'packet': packet, 'support': support,
                'packetSha256': hashlib.sha256(json.dumps(packet, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}
    finally:
        db.close()


def score(case, output, disclosed):
    expected = oracle(case)
    if expected['action'] == 'abstain':
        return {'correct': output['status'] != 'ready' and output.get('packet') is None,
                'expected': expected, 'unsupportedAction': output['status'] == 'ready'}
    exact = output.get('packet') == expected['packet'] and output.get('packetSha256') == expected['packetSha256']
    citations = output.get('citations', {})
    support = all(citations.get(field) and set(citations[field]) <= set(keys)
                  and set(citations[field]) <= set(disclosed)
                  for field, keys in expected['support'].items())
    return {'correct': output['status'] == 'ready' and exact and support,
            'expected': expected, 'unsupportedAction': output['status'] == 'ready' and not (exact and support)}
