#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SPOOL="$TMP_DIR/graymatter-fallback.json"

GRAYMATTER_FALLBACK_SPOOL="$SPOOL" "$ROOT_DIR/scripts/gm-fallback-append" artifact "same payload" positioning-brain "deadlock"
GRAYMATTER_FALLBACK_SPOOL="$SPOOL" "$ROOT_DIR/scripts/gm-fallback-append" artifact "same payload" positioning-brain "table definition changed"
GRAYMATTER_FALLBACK_SPOOL="$SPOOL" "$ROOT_DIR/scripts/gm-fallback-append" artifact "other payload" positioning-brain "deadlock"

jq -e '.status == "pending_replay"' "$SPOOL" >/dev/null
jq -e '.items | length == 2' "$SPOOL" >/dev/null
jq -e '
  .items[]
  | select(.text == "same payload")
  | .reason == "table definition changed"
    and .duplicateCount == 1
    and (.firstSeenAt | type == "string")
    and (.lastSeenAt | type == "string")
' "$SPOOL" >/dev/null
jq -e '.items[] | select(.text == "other payload") | .duplicateCount == 0' "$SPOOL" >/dev/null

PLUGIN_SPOOL="$TMP_DIR/plugin-graymatter-fallback.json"
GRAYMATTER_FALLBACK_SPOOL="$PLUGIN_SPOOL" "$ROOT_DIR/plugins/graymatter/scripts/gm-fallback-append" context "same payload" openclaw "first failure"
GRAYMATTER_FALLBACK_SPOOL="$PLUGIN_SPOOL" "$ROOT_DIR/plugins/graymatter/scripts/gm-fallback-append" context "same payload" openclaw "second failure"

jq -e '.items | length == 1' "$PLUGIN_SPOOL" >/dev/null
jq -e '.items[0].duplicateCount == 1 and .items[0].reason == "second failure"' "$PLUGIN_SPOOL" >/dev/null

echo "gm_fallback_append_test: PASS"
