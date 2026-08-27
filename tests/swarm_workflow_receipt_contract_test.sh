#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/references/contracts/swarm/graymatter_swarm_workflow_execution_receipt_v1.schema.json"
EXAMPLE="$ROOT/examples/swarm-workflow-execution-receipt.v1.json"
PLUGIN_SCHEMA="$ROOT/plugins/graymatter/references/contracts/swarm/graymatter_swarm_workflow_execution_receipt_v1.schema.json"
PLUGIN_EXAMPLE="$ROOT/plugins/graymatter/examples/swarm-workflow-execution-receipt.v1.json"

jq -e '.properties.contractVersion.const == "v1"' "$SCHEMA" >/dev/null
jq -e '.description | contains("not a scheduler command or an execution journal")' "$SCHEMA" >/dev/null
jq -e '.properties.node.properties.nodeClass.enum == ["agentic-runtime", "model-only"]' "$SCHEMA" >/dev/null
jq -e '.allOf[0].then.properties.node.properties.executionMode.const == "signed-workflow-only"' "$SCHEMA" >/dev/null
jq -e '.allOf[0].then.properties.node.properties.nativeCapabilities.maxItems == 0' "$SCHEMA" >/dev/null
jq -e '.allOf[0].then.properties.inference.properties.provider.enum == ["lm-studio", "ollama"]' "$SCHEMA" >/dev/null
jq -e '
  ["originIntent", "workflowPackage", "signedExecutionEnvelope", "node", "inference", "checkpoints", "artifacts", "approvals", "terminalOutcome", "receiptReplay"]
  - .required | length == 0
' "$SCHEMA" >/dev/null

jq -e '
  .contractVersion == "v1" and
  .node.nodeClass == "model-only" and
  .node.executionMode == "signed-workflow-only" and
  .node.nativeCapabilities == [] and
  (.inference.provider == "lm-studio" or .inference.provider == "ollama") and
  .signedExecutionEnvelope.signatureVerified == true and
  (.receiptReplay.state | IN("DURABLE", "QUEUED", "DEGRADED", "REPLAYED"))
' "$EXAMPLE" >/dev/null

if jq -e '.. | objects | has("tenantId") or has("ownerId") or has("credential") or has("prompt") or has("journal")' "$EXAMPLE" | grep -q true; then
  echo "execution receipt example must remain non-secret and server-scoped" >&2
  exit 1
fi

cmp -s "$SCHEMA" "$PLUGIN_SCHEMA"
cmp -s "$EXAMPLE" "$PLUGIN_EXAMPLE"
grep -q 'GrayMatter is not a scheduler, command bus, or' "$ROOT/docs/local-models.md"
grep -q 'model-only' "$ROOT/docs/local-models.md"
grep -q 'signed-workflow-only' "$ROOT/plugins/graymatter/docs/local-models.md"

echo "swarm_workflow_receipt_contract_test: ok"
