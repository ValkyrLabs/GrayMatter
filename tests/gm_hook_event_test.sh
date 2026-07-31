#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SPOOL="$TMP_DIR/graymatter-hook-events.json"

"$ROOT_DIR/scripts/gm-hook-event" post_tool "tool completed" \
  --owner test-owner \
  --session s-123 \
  --spool "$SPOOL" >"$TMP_DIR/gm-hook-event.out"

grep -q '"ok": true' "$TMP_DIR/gm-hook-event.out"

grep -q '"event": "post_tool"' "$SPOOL"
grep -q '"session": "s-123"' "$SPOOL"

echo "gm_hook_event_test: ok"
