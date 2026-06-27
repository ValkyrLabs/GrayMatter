#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

run_matrix_contract() {
  local label="$1"
  local script="$2"
  local out="$tmp_dir/gm-agent-smoke-matrix-${label}.json"

  "$script" --out "$out" >/dev/null

  jq -e '.lane == "graymatter-agent-install-openclaw-skill"' "$out" >/dev/null
  jq -e '.statuses == ["pass","fail","skipped","manual_required"]' "$out" >/dev/null
  jq -e '.summary.fail == 0' "$out" >/dev/null
  jq -e '.summary.pass >= 5' "$out" >/dev/null
  jq -e '.summary.manual_required >= 2' "$out" >/dev/null

  for stage in install_readiness read_search_readiness mcp_readiness schema_sync_readiness tool_routing_readiness; do
    jq -e --arg stage "$stage" '.stages[] | select(.name == $stage and .status == "pass")' "$out" >/dev/null
  done

  for stage in write_readiness safe_response_readiness; do
    jq -e --arg stage "$stage" '.stages[] | select(.name == $stage and .status == "manual_required")' "$out" >/dev/null
  done
}

run_matrix_contract root "$ROOT/scripts/gm-agent-smoke-matrix"
run_matrix_contract plugin "$ROOT/plugins/graymatter/scripts/gm-agent-smoke-matrix"

echo "gm_agent_smoke_matrix_test: ok"
