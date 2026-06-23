#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-read-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fake_api="$TMP_DIR/fake-graymatter-api"
out="$TMP_DIR/gm-read.out"
err="$TMP_DIR/gm-read.err"
call_log="$TMP_DIR/gm-read.calls"

cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"
printf '%s %s\n' "$METHOD" "$PATH_PART" >>"${TEST_GM_READ_CALL_LOG}"

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry/f7c29154-216f-4934-ac02-2d5e8b242180" ]]; then
  cat <<'JSON'
{
  "id": "f7c29154-216f-4934-ac02-2d5e8b242180",
  "type": "decision",
  "text": "ValkyrAI JUnit testing invariant should be retrievable directly by id without guessing at low-level API paths.",
  "sourceChannel": "codex:workspace:ValkyrAI",
  "tags": [{"name": "testing"}, {"name": "invariant"}]
}
JSON
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
chmod +x "$fake_api"

TEST_GM_READ_CALL_LOG="$call_log" \
  GRAYMATTER_API_COMMAND="$fake_api" \
  "$ROOT_DIR/scripts/gm-read" f7c29154-216f-4934-ac02-2d5e8b242180 --brief --text-max 90 \
  >"$out" 2>"$err"

grep -q "GET /MemoryEntry/f7c29154-216f-4934-ac02-2d5e8b242180" "$call_log"
grep -q "GrayMatter memory entry f7c29154-216f-4934-ac02-2d5e8b242180" "$out"
grep -q "type=decision, source=codex:workspace:ValkyrAI, tags=invariant,testing" "$out"
grep -q "ValkyrAI JUnit testing invariant should be retrievable directly by id" "$out"
[[ ! -s "$err" ]]

set +e
TEST_GM_READ_CALL_LOG="$call_log" \
  GRAYMATTER_API_COMMAND="$fake_api" \
  "$ROOT_DIR/scripts/gm-read" f7c29154-216f-4934-ac02-2d5e8b242180 --format xml \
  >"$TMP_DIR/gm-read-invalid.out" 2>"$TMP_DIR/gm-read-invalid.err"
status=$?
set -e

[[ "$status" -eq 1 ]]
grep -q "gm-read: --format must be json, brief, or english" "$TMP_DIR/gm-read-invalid.err"

echo "gm_read_test: ok"
