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

long_description="$(printf 'x%.0s' {1..256})"
if bash "$ROOT_DIR/scripts/gm-entity" StrategicPriority POST "{\"description\":\"$long_description\"}" >/tmp/gm-entity-long-strategy.out 2>&1; then
  echo "expected long StrategicPriority validation failure" >&2
  exit 1
fi
grep -q "StrategicPriority.description is 256 characters" /tmp/gm-entity-long-strategy.out
grep -q "SQL truncation 500" /tmp/gm-entity-long-strategy.out

long_note="$(printf 'n%.0s' {1..256})"
if bash "$ROOT_DIR/scripts/gm-entity" Note POST "{\"content\":\"$long_note\"}" >/tmp/gm-entity-long-note.out 2>&1; then
  echo "expected long Note validation failure" >&2
  exit 1
fi
grep -q "Note.content is 256 characters" /tmp/gm-entity-long-note.out
grep -q "MemoryEntry/ContentData" /tmp/gm-entity-long-note.out

echo "gm_entity_test: ok"
