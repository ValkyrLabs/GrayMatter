#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/memory"
cat > "$TMP/memory/graymatter-fallback.json" <<JSON
{
  "timestamp": "2026-01-01T00:00:00Z",
  "source": "chat",
  "status": "pending_replay",
  "items": [
    {"type":"note","text":"alpha","owner":"ops","reason":"retry"},
    {"type":"task","text":"beta","owner":"ops","reason":"retry"},
    {"text":"missing type","owner":"ops","reason":"retry"}
  ]
}
JSON

LIMIT_JSON="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --json --limit 1 2>&1)"
echo "$LIMIT_JSON" | grep -q '"count": 1'
echo "$LIMIT_JSON" | grep -q '"total": 3'
echo "$LIMIT_JSON" | grep -q '"alpha"'
! echo "$LIMIT_JSON" | grep -q '"beta"'

OFFSET_JSON="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --json --offset 2 --limit 1 2>&1)"
echo "$OFFSET_JSON" | grep -q '"count": 1'
echo "$OFFSET_JSON" | grep -q '"beta"'
! echo "$OFFSET_JSON" | grep -q '"alpha"'

COMPACT_JSON="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --json --compact 2>&1)"
echo "$COMPACT_JSON" | grep -q '"compacted": true'
echo "$COMPACT_JSON" | grep -q '"removed": 1'

grep -q '"type": "note"' "$TMP/memory/graymatter-fallback.json"
! grep -q 'missing type' "$TMP/memory/graymatter-fallback.json"

OUT="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --offset 2 --limit 1 --drain 2>&1)"
echo "$OUT" | grep -q "type=task"
echo "$OUT" | grep -q "drained 1 fallback items"
grep -q '"status": "pending_replay"' "$TMP/memory/graymatter-fallback.json"

echo "$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --json 2>&1)" | grep -q '"total": 1'

echo "$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --drain 2>&1)" | grep -q "drained 1 fallback items"
grep -q '"status": "replayed"' "$TMP/memory/graymatter-fallback.json"

JSON_OUT="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --json 2>&1)"
echo "$JSON_OUT" | grep -q '"status": "empty"'
echo "$JSON_OUT" | grep -q '"count": 0'