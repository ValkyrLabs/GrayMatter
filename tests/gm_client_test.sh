#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if "$ROOT_DIR/scripts/gm-client" >/tmp/gm-client.out 2>&1; then
  echo "expected usage failure" >&2
  exit 1
fi

grep -q "Usage: gm-client" /tmp/gm-client.out
grep -q -- "--body-file" /tmp/gm-client.out
grep -q "get|post|put|patch|delete" /tmp/gm-client.out

"$ROOT_DIR/scripts/gm-client" --help >/tmp/gm-client-help.out 2>&1
grep -q "Usage: gm-client" /tmp/gm-client-help.out

if "$ROOT_DIR/scripts/gm-client" foo /memory-entries >/tmp/gm-client-invalid.out 2>&1; then
  echo "expected invalid method failure" >&2
  exit 1
fi
grep -q "unsupported method 'foo'" /tmp/gm-client-invalid.out

if "$ROOT_DIR/scripts/gm-client" --body-file /no/such/file post /memory-entries >/tmp/gm-client-nofile.out 2>&1; then
  echo "expected missing body-file failure" >&2
  exit 1
fi
grep -q "body file not found" /tmp/gm-client-nofile.out

echo '{"title":"From file"}' >/tmp/gm-client-body.json
if "$ROOT_DIR/scripts/gm-client" --body-file /tmp/gm-client-body.json post /memory-entries '{"title":"Inline"}' >/tmp/gm-client-both.out 2>&1; then
  echo "expected body conflict failure" >&2
  exit 1
fi
grep -q "provide either \[json-body\] or --body-file" /tmp/gm-client-both.out

echo "gm_client_test: ok"
