#!/usr/bin/env bash
set -euo pipefail

contract="references/contracts/mcp/graymatter_mcp_tools_v1.json"

jq -e '.version == "v1"' "$contract" >/dev/null
jq -e '.tools | length >= 10' "$contract" >/dev/null
jq -e '.tools | map(.name) | sort == ["memory_get","memory_health","memory_link","memory_put","memory_put_batch","memory_query","memory_replay_deferred","memory_retrieve_with_receipt","omega_evaluate","omega_forget","omega_index_job","omega_outcome","omega_plan","omega_recall","omega_remember","omega_resolve_domains","omega_trajectory_get","retrieval_receipt_get","retrieval_receipt_query"]' "$contract" >/dev/null
jq -e '.tools[] | .errors | length >= 1' "$contract" >/dev/null
jq -e '.tools[] | .errors[] | has("code") and has("retryable")' "$contract" >/dev/null
jq -e '
  .tools[]
  | select(.name == "memory_retrieve_with_receipt" or .name == "retrieval_receipt_get")
  | .outputSchema.required | index("graymatterPolicy")
' "$contract" >/dev/null
jq -e '
  .tools[]
  | select(.name == "memory_retrieve_with_receipt" or .name == "retrieval_receipt_get")
  | .outputSchema.properties.graymatterPolicy.required
  | index("answerAllowed") and index("caveatRequired") and index("disposition") and index("requiredActions")
' "$contract" >/dev/null
jq -e '
  .tools[]
  | select(.name == "retrieval_receipt_query")
  | .outputSchema.properties.receipts.items.properties.graymatterPolicy.required
  | index("answerAllowed") and index("caveatRequired") and index("disposition") and index("requiredActions")
' "$contract" >/dev/null

echo "portable MCP contract surface checks passed"
