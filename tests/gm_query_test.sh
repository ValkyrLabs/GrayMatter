#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-query-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_API="$TMP_DIR/fake-graymatter-api"
cat >"$FAKE_API" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"path":"uri=/v1/MemoryEntry/query","error":"Runtime Error","message":"transaction timeout expired"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
[
  {
    "id": "580739d8-1776-4517-82c0-f3f51a8759bb",
    "type": "context",
    "text": "TrustLove mandate",
    "sourceChannel": "codex:workspace:graymatter"
  },
  {
    "id": "unrelated",
    "type": "context",
    "text": "Nothing to see here",
    "sourceChannel": "codex:workspace:graymatter"
  },
  {
    "id": "wrong-source",
    "type": "context",
    "text": "TrustLove outside this scope",
    "sourceChannel": "codex:workspace:other"
  }
]
JSON
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
chmod +x "$FAKE_API"

GRAYMATTER_API_COMMAND="$FAKE_API" \
  "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter \
  >"$TMP_DIR/query.out" 2>"$TMP_DIR/query.err"

jq -e 'length == 1 and .[0].id == "580739d8-1776-4517-82c0-f3f51a8759bb"' "$TMP_DIR/query.out" >/dev/null
grep -q "falling back to MemoryEntry list filtering" "$TMP_DIR/query.err"

echo "gm_query_test: ok"
