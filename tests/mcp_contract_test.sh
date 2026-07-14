#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEGACY_CONTRACT="${ROOT}/references/mcp/memory-tool-contract.v1.json"
PORTABLE_CONTRACT="${ROOT}/references/contracts/mcp/graymatter_mcp_tools_v1.json"
PLUGIN_LEGACY_CONTRACT="${ROOT}/plugins/graymatter/references/mcp/memory-tool-contract.v1.json"
PLUGIN_PORTABLE_CONTRACT="${ROOT}/plugins/graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json"

jq -e '.version == "v1"' "$LEGACY_CONTRACT" >/dev/null
jq -e '.errors.AUTH_REQUIRED and .errors.UPSTREAM_UNAVAILABLE' "$LEGACY_CONTRACT" >/dev/null

jq -e '.version == "v1"' "$PORTABLE_CONTRACT" >/dev/null
for t in memory_query memory_retrieve_with_receipt omega_remember omega_recall omega_forget retrieval_receipt_get retrieval_receipt_query memory_get memory_put memory_put_batch memory_link memory_health memory_replay_deferred; do
  jq -e --arg t "$t" '.tools[] | select(.name==$t)' "$PORTABLE_CONTRACT" >/dev/null
done
jq -e '
  .tools[]
  | select(.name == "memory_retrieve_with_receipt" or .name == "retrieval_receipt_get")
  | .outputSchema.required | index("graymatterPolicy")
' "$PORTABLE_CONTRACT" >/dev/null
jq -e '
  .tools[]
  | select(.name == "memory_retrieve_with_receipt" or .name == "retrieval_receipt_get")
  | .outputSchema.properties.graymatterPolicy.required
  | index("answerAllowed") and index("caveatRequired") and index("disposition") and index("requiredActions")
' "$PORTABLE_CONTRACT" >/dev/null
jq -e '
  .tools[]
  | select(.name == "retrieval_receipt_query")
  | .outputSchema.properties.receipts.items.properties.graymatterPolicy.required
  | index("answerAllowed") and index("caveatRequired") and index("disposition") and index("requiredActions")
' "$PORTABLE_CONTRACT" >/dev/null

jq -e '.tools | map(.name) | sort == ["memory_get","memory_health","memory_link","memory_put","memory_put_batch","memory_query","memory_replay_deferred","memory_retrieve_with_receipt","omega_forget","omega_recall","omega_remember","retrieval_receipt_get","retrieval_receipt_query"]' < <("${ROOT}/scripts/gm-mcp-contract") >/dev/null
jq -e '.tools[] | select(.name == "memory_retrieve_with_receipt") | .outputSchema.required | index("graymatterPolicy")' < <("${ROOT}/scripts/gm-mcp-contract") >/dev/null
jq -e '.tools | length > 0' < <("${ROOT}/scripts/gm-mcp-contract" --mode=portable --validate) >/dev/null
jq -e '.errors.AUTH_REQUIRED and .errors.UPSTREAM_UNAVAILABLE' < <("${ROOT}/scripts/gm-mcp-contract" legacy) >/dev/null
jq -e '.errors.AUTH_REQUIRED and .errors.UPSTREAM_UNAVAILABLE' < <("${ROOT}/scripts/gm-mcp-contract" --mode=legacy --validate) >/dev/null

cmp -s "$PORTABLE_CONTRACT" "$PLUGIN_PORTABLE_CONTRACT"
cmp -s "$LEGACY_CONTRACT" "$PLUGIN_LEGACY_CONTRACT"
jq -e '.tools[] | select(.name == "memory_retrieve_with_receipt") | .outputSchema.required | index("graymatterPolicy")' < <("${ROOT}/plugins/graymatter/scripts/gm-mcp-contract") >/dev/null
jq -e '.tools | length > 0' < <("${ROOT}/plugins/graymatter/scripts/gm-mcp-contract" --mode=portable --validate) >/dev/null
jq -e '.errors.AUTH_REQUIRED and .errors.UPSTREAM_UNAVAILABLE' < <("${ROOT}/plugins/graymatter/scripts/gm-mcp-contract" --mode=legacy --validate) >/dev/null

echo "mcp_contract_test: ok"
