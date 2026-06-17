#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FASTLANE_SRC="${ROOT}/scripts/gm-activation-fastlane"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$message"
  fi
}

make_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  cp "$FASTLANE_SRC" "$dir/gm-activation-fastlane"
  chmod +x "$dir/gm-activation-fastlane"

  for helper in gm-install-check gm-status gm-mcp-contract gm-activate gm-write gm-query gm-graph gm-openapi-summary gm-entity; do
    cat >"$dir/$helper" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\n' "$(basename "$0")" "$*" >>"${TEST_HELPER_LOG}"
case "$(basename "$0")" in
  gm-mcp-contract)
    printf '{"tools":["memory_write","memory_query","graph_get","schema_summary"]}\n'
    ;;
  gm-status)
    printf 'status ok\n'
    ;;
  gm-openapi-summary)
    printf 'schema summary ok\n'
    ;;
  *)
    printf 'ok\n'
    ;;
esac
EOF
    chmod +x "$dir/$helper"
  done
}

run_fastlane() {
  local mode="$1"
  local temp_root
  temp_root="$(mktemp -d)"
  make_fixture "$temp_root/scripts"

  export TEST_HELPER_LOG="$temp_root/helpers.log"
  export GRAYMATTER_ACTIVATION_EVENT_LOG="$temp_root/events.jsonl"

  local output
  local status=0
  set +e
  output="$("$temp_root/scripts/gm-activation-fastlane" $mode 2>&1)"
  status=$?
  set -e

  printf '%s\n' "$status"
  printf '%s\n' "$temp_root"
  printf '%s' "$output"
}

test_check_only_does_not_activate_or_touch_demo_data() {
  local result status temp_root output helper_log event_log
  result="$(run_fastlane --check-only)"
  status="$(printf '%s\n' "$result" | sed -n '1p')"
  temp_root="$(printf '%s\n' "$result" | sed -n '2p')"
  output="$(printf '%s\n' "$result" | tail -n +3)"
  helper_log="$(cat "$temp_root/helpers.log")"
  event_log="$(cat "$temp_root/events.jsonl")"

  [[ "$status" == "0" ]] || fail "check-only mode should succeed"
  assert_contains "$helper_log" "gm-install-check" "check-only should run install readiness"
  assert_contains "$helper_log" "gm-status" "check-only should run status readiness"
  assert_contains "$helper_log" "gm-mcp-contract" "check-only should validate the MCP contract"
  [[ "$helper_log" != *"gm-activate"* ]] || fail "check-only mode should not run activation"
  [[ "$helper_log" != *"gm-write"* ]] || fail "check-only mode should not write demo memory"
  assert_contains "$event_log" '"event":"activation_completed","state":"check_only"' "check-only should emit a completion event"
  assert_contains "$output" "fastlane check complete" "check-only should print operator success copy"
}

test_reviewer_demo_runs_safe_memory_graph_schema_and_entity_checks() {
  local result status temp_root output helper_log event_log
  result="$(run_fastlane --reviewer-demo)"
  status="$(printf '%s\n' "$result" | sed -n '1p')"
  temp_root="$(printf '%s\n' "$result" | sed -n '2p')"
  output="$(printf '%s\n' "$result" | tail -n +3)"
  helper_log="$(cat "$temp_root/helpers.log")"
  event_log="$(cat "$temp_root/events.jsonl")"

  [[ "$status" == "0" ]] || fail "reviewer demo mode should succeed"
  for helper in gm-activate gm-write gm-query gm-graph gm-openapi-summary gm-entity; do
    assert_contains "$helper_log" "$helper" "reviewer demo should run $helper"
  done
  assert_contains "$helper_log" "gm-entity list MemoryEntry 1" "reviewer demo should only run a bounded safe entity list"
  assert_contains "$event_log" '"event":"first_memory_written","state":"completed"' "reviewer demo should emit memory telemetry"
  assert_contains "$event_log" '"event":"first_query_succeeded","state":"completed"' "reviewer demo should emit query telemetry"
  assert_contains "$output" "Next useful actions" "reviewer demo should print customer-facing next actions"
}

test_check_only_does_not_activate_or_touch_demo_data
test_reviewer_demo_runs_safe_memory_graph_schema_and_entity_checks

echo "gm_activation_fastlane_test: ok"
