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
    {"type":"note","text":"alpha","owner":"ops","reason":"retry"}
  ]
}
JSON

OUT="$(cd "$TMP" && $ROOT/scripts/gm-fallback-replay --drain 2>&1)"
echo "$OUT" | grep -q "type=note"
echo "$OUT" | grep -q "drained 1 fallback items"
grep -q '"status": "replayed"' "$TMP/memory/graymatter-fallback.json"
