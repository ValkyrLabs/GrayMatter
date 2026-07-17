#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-prod-acceptance.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$ROOT/scripts/graymatter-prod-acceptance.sh" "$TMP_DIR/graymatter-prod-acceptance.sh"
chmod +x "$TMP_DIR/graymatter-prod-acceptance.sh"

cat >"$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

method="$1"
path="$2"
body="${3:-}"
if [[ -n "${TEST_EXPECT_TOKEN:-}" && "${VALKYR_AUTH_TOKEN:-}" != "$TEST_EXPECT_TOKEN" ]]; then
  echo "Expected token was not forwarded to the authenticated transport" >&2
  exit 89
fi
printf '%s|%s|%s\n' "$method" "$path" "$body" >>"${TEST_CALL_LOG:?}"

case "$method $path" in
  'POST /graymatter-retrieval-receipts')
    printf '%s\n' '{"receipt":{"receiptId":"receipt-canary","traceId":"trace-canary"}}'
    ;;
  'GET /graymatter/retrieval-context/receipt-canary?maxChars=1200')
    printf '%s\n' '{"retrievalReceipt":{"receiptId":"receipt-canary"},"answerPolicy":"DO_NOT_ANSWER_CONFIDENTLY"}'
    ;;
  'GET /graymatter/object-graph/shape')
    printf '%s\n' '{"schemaAvailable":true,"rbacFiltered":true,"schemaVersion":"schema-v1","policyVersion":"policy-v1","domains":[]}'
    ;;
  'GET /graymatter/semantic-index/manifest')
    health="${TEST_SEMANTIC_HEALTH:-healthy}"
    jq -nc --arg health "$health" '{schemaAvailable:true,rbacFiltered:true,indexLifecycle:{lifecycleDataAvailable:true,manifestVersion:"index-v1",healthStatus:$health}}'
    ;;
  'POST /graymatter/omega/capabilities/evidence')
    jq -e '.probes | length == 4' >/dev/null <<<"$body"
    jq -e 'all(.probes[]; (.evidenceRef | contains("signature-canary/")) and (.evidenceRef | contains("mock-secret-token") | not))' >/dev/null <<<"$body"
    jq -c '{acceptedCapabilityIds:[.probes[].capabilityId]}' <<<"$body"
    ;;
  'GET /graymatter/omega/capabilities')
    if [[ "${TEST_SEMANTIC_HEALTH:-healthy}" == "healthy" ]]; then
      printf '%s\n' '{"capabilities":[{"id":null,"capabilityId":"graymatter.receipt.create","state":"LIVE_VERIFIED"},{"id":null,"capabilityId":"graymatter.context.create","state":"LIVE_VERIFIED"},{"id":null,"capabilityId":"graymatter.graph.shape","state":"LIVE_VERIFIED"},{"id":null,"capabilityId":"graymatter.semantic.manifest","state":"LIVE_VERIFIED"}]}'
    else
      printf '%s\n' '{"capabilities":[{"id":"graymatter.receipt.create","state":"LIVE_VERIFIED"},{"id":"graymatter.context.create","state":"LIVE_VERIFIED"},{"id":"graymatter.graph.shape","state":"LIVE_VERIFIED"},{"id":"graymatter.semantic.manifest","state":"DEGRADED"}]}'
    fi
    ;;
  *)
    echo "Unexpected request: $method $path" >&2
    exit 88
    ;;
esac
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

REPORT="$TMP_DIR/report.json"
TEST_CALL_LOG="$TMP_DIR/calls.log" \
TEST_EXPECT_TOKEN=mock-secret-token \
GRAYMATTER_API_COMMAND="$TMP_DIR/graymatter_api.sh" \
"$TMP_DIR/graymatter-prod-acceptance.sh" \
  --token-command 'printf mock-secret-token' \
  --publish-capability-evidence \
  --format json \
  --artifact "$REPORT" >"$TMP_DIR/console.json"

jq -e '.publishRequested == true and .published == true and .verification == "PASSED" and (.probes | length == 4) and all(.probes[]; .passed == true)' "$REPORT" >/dev/null
grep -q '^POST|/graymatter/omega/capabilities/evidence|' "$TMP_DIR/calls.log"
! grep -Fq 'mock-secret-token' "$REPORT"
! grep -Fq 'GrayMatter OmegaRAG authenticated signature canary' "$REPORT"

FAILED_REPORT="$TMP_DIR/failed-report.json"
set +e
TEST_CALL_LOG="$TMP_DIR/failed-calls.log" \
TEST_SEMANTIC_HEALTH=degraded_embedding_health \
GRAYMATTER_API_COMMAND="$TMP_DIR/graymatter_api.sh" \
"$TMP_DIR/graymatter-prod-acceptance.sh" \
  --publish-capability-evidence \
  --format json \
  --artifact "$FAILED_REPORT" >"$TMP_DIR/failed-console.json"
FAILED_STATUS=$?
set -e

test "$FAILED_STATUS" -eq 1
jq -e '
  .published == true and .verification == "PASSED"
  and ([.probes[] | select(.capabilityId == "graymatter.semantic.manifest") | .passed] == [false])
' "$FAILED_REPORT" >/dev/null
grep -q '^POST|/graymatter/omega/capabilities/evidence|' "$TMP_DIR/failed-calls.log"

echo "graymatter_prod_acceptance_test: PASS"
