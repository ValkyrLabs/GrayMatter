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
fallback_spool="${tmp}/graymatter-fallback.json"
printf '{"status":"synced","items":[]}\n' >"$fallback_spool"

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
  GRAYMATTER_FALLBACK_SPOOL="$fallback_spool" \
  GRAYMATTER_REPLAY_LOCK_DIR="${tmp}/replay.lock" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_stub" \
  GRAYMATTER_SKIP_REPLAY_PREFLIGHT=true \
  "$SCRIPT"
)"

[[ "$output" == *"Replayed deferred operation op-1"* ]] || fail "gm-replay-deferred should report replayed operation id"
[[ -f "${tmp}/replay.log" ]] || fail "gm-replay-deferred should invoke API script"
[[ ! -f "${deferred_dir}/op.json" ]] || fail "gm-replay-deferred should remove successfully replayed record"
jq -e 'select(.event == "replay_started" and .deferredId == "op-1")' "${tmp}/credit-events.jsonl" >/dev/null || fail "gm-replay-deferred should emit replay_started telemetry"
jq -e 'select(.event == "replay_succeeded" and .deferredId == "op-1")' "${tmp}/credit-events.jsonl" >/dev/null || fail "gm-replay-deferred should emit replay_succeeded telemetry"

cat >"$fallback_spool" <<'JSON'
{
  "timestamp": "2026-07-29T00:00:00Z",
  "source": "chat",
  "status": "pending_replay",
  "items": [
    {"type":"artifact","text":"legacy artifact","owner":"codex:workspace:ValkyrAI","reason":"offline"},
    {"type":"context","text":"legacy context","owner":"codex:workspace:ValkyrAI","reason":"tenant unknown"}
  ]
}
JSON
rm -f "${tmp}/replay.log"
legacy_output="$(
  GRAYMATTER_DEFERRED_DIR="$deferred_dir" \
  GRAYMATTER_FALLBACK_SPOOL="$fallback_spool" \
  GRAYMATTER_REPLAY_LOCK_DIR="${tmp}/replay.lock" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events-legacy.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_stub" \
  GRAYMATTER_SKIP_REPLAY_PREFLIGHT=true \
  "$SCRIPT"
)"

[[ "$(grep -c '^POST /MemoryEntry/write ' "${tmp}/replay.log")" -eq 2 ]] \
  || fail "gm-replay-deferred should migrate every legacy gm-write fallback record"
[[ "$legacy_output" == *"Replayed fallback record fallback-"* ]] \
  || fail "gm-replay-deferred should report legacy fallback replay"
jq -e '.status == "synced" and (.items | length) == 0' "$fallback_spool" >/dev/null \
  || fail "gm-replay-deferred should mark the legacy fallback spool synced only after all writes succeed"

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
  GRAYMATTER_FALLBACK_SPOOL="$fallback_spool" \
  GRAYMATTER_REPLAY_LOCK_DIR="${tmp}/replay.lock" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events-fail.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_fail_stub" \
  GRAYMATTER_SKIP_REPLAY_PREFLIGHT=true \
  "$SCRIPT" 2>&1
)"
fail_status=$?
set -e

[[ "$fail_status" == "1" ]] || fail "gm-replay-deferred should stop with exit 1 when replay fails"
[[ "$fail_output" == *"Replay failed for op-fail; stopping."* ]] || fail "gm-replay-deferred should print a deterministic replay failure message"
[[ -f "${deferred_dir}/op-fail.json" ]] || fail "gm-replay-deferred should preserve failed deferred records for later retry"

rm -f "${deferred_dir}/op-fail.json"
cat >"$fallback_spool" <<'JSON'
{"status":"pending_replay","items":[{"type":"context","text":"preserve me","owner":"codex:workspace:test"}]}
JSON
set +e
legacy_fail_output="$(
  GRAYMATTER_DEFERRED_DIR="$deferred_dir" \
  GRAYMATTER_FALLBACK_SPOOL="$fallback_spool" \
  GRAYMATTER_REPLAY_LOCK_DIR="${tmp}/replay.lock" \
  GRAYMATTER_CREDIT_EVENTS_PATH="${tmp}/credit-events-legacy-fail.jsonl" \
  GRAYMATTER_API_SCRIPT="$api_fail_stub" \
  GRAYMATTER_SKIP_REPLAY_PREFLIGHT=true \
  "$SCRIPT" 2>&1
)"
legacy_fail_status=$?
set -e

[[ "$legacy_fail_status" == "1" ]] || fail "gm-replay-deferred should fail when a legacy fallback replay fails"
[[ "$legacy_fail_output" == *"Replay failed for fallback-"* ]] || fail "legacy replay failure should name its content-derived id"
jq -e '.status == "pending_replay" and (.items | length) == 1' "$fallback_spool" >/dev/null \
  || fail "failed legacy fallback records must remain queued"

echo "gm_replay_deferred_test.sh: PASS"
