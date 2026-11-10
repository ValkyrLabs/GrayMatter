"""Verify immutable files, full assigned matrix, authority witnesses and independently replay scores."""
import argparse
import hashlib
import json
from pathlib import Path
from score import evaluate


def verify_controls(capture):
    controls = capture['controls']
    if len(controls) == 1 and controls[0]['control'] == 'revocation_unavailable':
        return {'qualified': False, 'reason': controls[0]['reason']}
    assert len(controls) == 2
    assert {row['control'] for row in controls} == {'effective_read_denied', 'merge_revoked'}
    for row in controls:
        assert row['receiptHttpStatus'] in (403, 404, 409)
        assert row['hydrateHttpStatus'] in (403, 404, 409)
        assert row['receiptRef'] and row['pageRef']
    pairs = {(row['receiptRef'], row['pageRef']) for row in controls}
    assert len(pairs) == 1
    completed = {(trial['typed_pair']['toolResponse']['receiptRef'],
                  trial['typed_pair']['hydrateResponse']['contextPage']['pageRef'])
                 for case in capture['cases'] for trial in case['trials']
                 if trial['typed_pair']['status'] == 'completed'}
    assert pairs <= completed, 'Revocation must target an actual measured typed pair'
    return {'qualified': True, 'controls': 2}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--frozen', type=Path, required=True)
    parser.add_argument('--protocol', type=Path, default=Path(__file__).with_name('protocol.json'))
    parser.add_argument('--results', type=Path)
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    if args.manifest:
        manifest = json.loads(args.manifest.read_text())
        for name, expected in manifest['files'].items():
            assert hashlib.sha256((args.manifest.parent / name).read_bytes()).hexdigest() == expected, name
    capture = json.loads(args.capture.read_text())
    result = evaluate(capture, args.protocol, args.frozen)
    controls = verify_controls(capture)
    assert not capture['unexpectedFailures'], 'Capture contains unqualified infrastructure failures'
    if args.results:
        assert json.loads(args.results.read_text()) == result
    print(json.dumps({'summary': result['summary'], 'authorityControls': controls,
                      'unexpectedFailures': capture['unexpectedFailures']}, indent=2))


if __name__ == '__main__':
    main()
