#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/scripts/gm-replay-deferred"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

deferred_dir="${tmp}/deferred"
mkdir -p "$deferred_dir"

cat >"${deferred_dir}/op.json" <<'JSON'
{"id":"op-1","method":"POST","path":"/MemoryEntry","body":"{\"type\":\"context\",\"text\":\"hello\"}"}
JSON

api_stub="${tmp}/graymatter_api_stub.sh"
cat >"$api_stub" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s %s %s\n' "$1" "$2" "${3:-}" >>"${TEST_REPLAY_LOG}"
EOF
chmod +x "$api_stub"

export TEST_REPLAY_LOG="${tmp}/replay.log"
output="$(
  GRAYMATTER_DEFERRED_DIR="$deferred_dir" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_stub" \
  "$SCRIPT"
)"

[[ "$output" == *"Replayed deferred operation op-1"* ]] || fail "gm-replay-deferred should report replayed operation id"
[[ -f "${tmp}/replay.log" ]] || fail "gm-replay-deferred should invoke API script"
[[ ! -f "${deferred_dir}/op.json" ]] || fail "gm-replay-deferred should remove successfully replayed record"
jq -e 'select(.event == "replay_started" and .deferredId == "op-1")' "${tmp}/credit-events.jsonl" >/dev/null || fail "gm-replay-deferred should emit replay_started telemetry"
jq -e 'select(.event == "replay_succeeded" and .deferredId == "op-1")' "${tmp}/credit-events.jsonl" >/dev/null || fail "gm-replay-deferred should emit replay_succeeded telemetry"

cat >"${deferred_dir}/op-fail.json" <<'JSON'
{"id":"op-fail","method":"POST","path":"/MemoryEntry","body":"{\"type\":\"context\",\"text\":\"retry\"}"}
JSON

api_fail_stub="${tmp}/graymatter_api_fail_stub.sh"
cat >"$api_fail_stub" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 1
EOF
chmod +x "$api_fail_stub"

set +e
fail_output="$(
  GRAYMATTER_DEFERRED_DIR="$deferred_dir" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events-fail.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_fail_stub" \
  "$SCRIPT" 2>&1
)"
fail_status=$?
set -e

[[ "$fail_status" == "1" ]] || fail "gm-replay-deferred should stop with exit 1 when replay fails"
[[ "$fail_output" == *"Replay failed for op-fail; stopping."* ]] || fail "gm-replay-deferred should print a deterministic replay failure message"
[[ -f "${deferred_dir}/op-fail.json" ]] || fail "gm-replay-deferred should preserve failed deferred records for later retry"

echo "gm_replay_deferred_test.sh: PASS"
