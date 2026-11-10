"""Verify the frozen authority evidence and replay the independent packet judge."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    for name, expected in manifest['files'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    capture = json.loads((ROOT / 'native-capture.json').read_text())
    identity = capture['requesterIdentity']
    assert identity['organizationRole'] == 'org_member' and identity['status'] == 'active'
    assert set(identity['authorities']) == {'ROLE_EVERYONE', 'ROLE_FREE', 'ROLE_GRAYMATTER_USER'}
    assert identity['actorId'] == capture['actorId'] and identity['organizationId'] == capture['tenantId']
    expected = {'unreadable_match_does_not_suppress_unique_authorized_seed', 'explicit_ids_with_discovery_denied',
                'effective_target_read_denied', 'revoked_target_merge', 'second_visible_match_same_fk',
                'second_visible_match_different_fk'}
    controls = capture['controls']
    assert len(controls) == len(expected) and {row['control'] for row in controls} == expected
    for row in controls:
        if row['control'] == 'unreadable_match_does_not_suppress_unique_authorized_seed':
            assert row['passed'] is True
        elif row['control'] == 'explicit_ids_with_discovery_denied':
            assert row['httpStatus'] == 400
        else:
            assert row['typedPathEvidenceCount'] == 0
    with tempfile.TemporaryDirectory() as directory:
        replayed = Path(directory) / 'results.json'
        subprocess.run([sys.executable, '-B', str(ROOT / 'score.py'), str(ROOT / 'native-capture.json'), str(replayed)],
                       check=True)
        assert json.loads(replayed.read_text()) == json.loads((ROOT / 'results.json').read_text())
    print('6/6 native authority controls matched')


if __name__ == '__main__':
    main()
