#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if bash "$ROOT_DIR/scripts/gm-entity" >/tmp/gm-entity.out 2>&1; then
  echo "expected usage failure" >&2
  exit 1
fi

grep -q "Usage:" /tmp/gm-entity.out
grep -q "gm-entity <Entity>" /tmp/gm-entity.out

if bash "$ROOT_DIR/scripts/gm-entity" --help >/tmp/gm-entity-help.out 2>&1; then
  echo "expected help usage exit" >&2
  exit 1
fi

grep -q "Usage:" /tmp/gm-entity-help.out

echo "gm_entity_test: ok"
