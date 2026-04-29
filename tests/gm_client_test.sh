#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if "$ROOT_DIR/scripts/gm-client" >/tmp/gm-client.out 2>&1; then
  echo "expected usage failure" >&2
  exit 1
fi

grep -q "Usage: gm-client" /tmp/gm-client.out
grep -q "get|post|put|patch|delete" /tmp/gm-client.out
echo "gm_client_test: ok"
