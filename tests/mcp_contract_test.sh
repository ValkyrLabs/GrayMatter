#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT="${ROOT}/references/mcp/memory-tool-contract.v1.json"

jq -e '.version == "v1"' "$CONTRACT" >/dev/null
for t in memory_query memory_get memory_put memory_put_batch memory_link memory_health memory_replay_deferred; do
  jq -e --arg t "$t" '.tools[] | select(.name==$t)' "$CONTRACT" >/dev/null
done
jq -e '.errors.AUTH_REQUIRED and .errors.UPSTREAM_UNAVAILABLE' "$CONTRACT" >/dev/null

echo "mcp_contract_test: ok"
