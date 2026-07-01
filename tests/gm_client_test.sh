#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if "$ROOT_DIR/scripts/gm-client" >/tmp/gm-client.out 2>&1; then
  echo "expected usage failure" >&2
  exit 1
fi

grep -q "Usage: gm-client" /tmp/gm-client.out
grep -q "get|post|put|patch|delete" /tmp/gm-client.out

"$ROOT_DIR/scripts/gm-client" --help >/tmp/gm-client-help.out 2>&1
grep -q "Usage: gm-client" /tmp/gm-client-help.out

if "$ROOT_DIR/scripts/gm-client" foo /memory-entries >/tmp/gm-client-invalid.out 2>&1; then
  echo "expected invalid method failure" >&2
  exit 1
fi
grep -q "unsupported method 'foo'" /tmp/gm-client-invalid.out

long_note="$(printf 'n%.0s' {1..256})"
if "$ROOT_DIR/scripts/gm-client" post /Note "{\"content\":\"$long_note\"}" >/tmp/gm-client-long-note.out 2>&1; then
  echo "expected long Note validation failure" >&2
  exit 1
fi
grep -q "Note.content is 256 characters" /tmp/gm-client-long-note.out
grep -q "SQL truncation 500" /tmp/gm-client-long-note.out

echo "gm_client_test: ok"
