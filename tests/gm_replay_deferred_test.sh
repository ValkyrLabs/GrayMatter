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
  GRAYMATTER_API_SCRIPT="$api_stub" \
  "$SCRIPT"
)"

[[ "$output" == *"Replayed deferred operation op-1"* ]] || fail "gm-replay-deferred should report replayed operation id"
[[ -f "${tmp}/replay.log" ]] || fail "gm-replay-deferred should invoke API script"
[[ ! -f "${deferred_dir}/op.json" ]] || fail "gm-replay-deferred should remove successfully replayed record"

echo "gm_replay_deferred_test.sh: PASS"
