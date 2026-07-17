#!/usr/bin/env bash
set -euo pipefail

# Run the four bounded OmegaRAG release signatures against an authenticated
# api-0 session.  The report and published evidence deliberately contain only
# contract metadata: never request/response bodies, tenant identifiers, query
# text, tokens, or provider secrets.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_COMMAND="${GRAYMATTER_API_COMMAND:-${SCRIPT_DIR}/graymatter_api.sh}"
CONTRACT_VERSION="omegarag-signature-canary/v1"
CANARY_QUERY="${GRAYMATTER_CANARY_QUERY:-GrayMatter OmegaRAG authenticated signature canary}"
MAX_CONTEXT_CHARS="${GRAYMATTER_CANARY_MAX_CONTEXT_CHARS:-1200}"
PUBLISH_EVIDENCE=false
FORMAT="text"
TOKEN_COMMAND=""
ARTIFACT=""
RUN_REF=""

usage() {
  cat <<'EOF'
Usage: graymatter-prod-acceptance.sh [options]

Run authenticated, bounded OmegaRAG release signatures for:
  - retrieval receipt creation
  - policy-gated context assembly
  - RBAC-visible object-graph shape
  - semantic-index lifecycle manifest

Options:
  --token-command COMMAND       Execute COMMAND and use its stdout as VALKYR_AUTH_TOKEN.
  --api-base URL                Set VALKYR_API_BASE for this invocation.
  --canary-query TEXT           Low-sensitivity synthetic query (never written to the report).
  --max-context-chars N         Bounded context response size (default: 1200).
  --artifact PATH               Content-free JSON report path.
  --format text|json            Console result format (default: text).
  --publish-capability-evidence Publish all pass/fail observations, then verify manifest state.
  -h, --help                    Show this help.

The normal GrayMatter auth bootstrap is used unless --token-command is supplied.
Publishing requires the server's GrayMatter capability-evidence administrator authority.
EOF
}

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "graymatter-prod-acceptance requires jq" >&2
    exit 2
  }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token-command)
      [[ $# -ge 2 ]] || { echo "--token-command requires a command" >&2; exit 2; }
      TOKEN_COMMAND="$2"
      shift 2
      ;;
    --api-base)
      [[ $# -ge 2 ]] || { echo "--api-base requires a URL" >&2; exit 2; }
      export VALKYR_API_BASE="$2"
      shift 2
      ;;
    --canary-query)
      [[ $# -ge 2 ]] || { echo "--canary-query requires text" >&2; exit 2; }
      CANARY_QUERY="$2"
      shift 2
      ;;
    --max-context-chars)
      [[ $# -ge 2 ]] || { echo "--max-context-chars requires a number" >&2; exit 2; }
      MAX_CONTEXT_CHARS="$2"
      shift 2
      ;;
    --artifact)
      [[ $# -ge 2 ]] || { echo "--artifact requires a path" >&2; exit 2; }
      ARTIFACT="$2"
      shift 2
      ;;
    --format)
      [[ $# -ge 2 ]] || { echo "--format requires text or json" >&2; exit 2; }
      FORMAT="$2"
      shift 2
      ;;
    --publish-capability-evidence)
      PUBLISH_EVIDENCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$FORMAT" in
  text|json) ;;
  *) echo "--format must be text or json" >&2; exit 2 ;;
esac

[[ "$MAX_CONTEXT_CHARS" =~ ^[0-9]+$ ]] && (( MAX_CONTEXT_CHARS >= 1200 && MAX_CONTEXT_CHARS <= 48000 )) || {
  echo "--max-context-chars must be an integer from 1200 through 48000" >&2
  exit 2
}

require_jq
[[ -x "$API_COMMAND" ]] || { echo "GrayMatter API command is not executable: $API_COMMAND" >&2; exit 2; }

if [[ -n "$TOKEN_COMMAND" ]]; then
  if ! token="$(bash -lc "$TOKEN_COMMAND")"; then
    echo "The supplied --token-command failed" >&2
    exit 2
  fi
  [[ -n "$token" ]] || { echo "The supplied --token-command returned no token" >&2; exit 2; }
  export VALKYR_AUTH_TOKEN="$token"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/graymatter-acceptance.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT
PROBES_FILE="$TMP_DIR/probes.jsonl"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_REF="$(date -u +%Y%m%dT%H%M%SZ)-$$"
if command -v uuidgen >/dev/null 2>&1; then
  RUN_REF="$(uuidgen | tr '[:upper:]' '[:lower:]')"
fi
if [[ -z "$ARTIFACT" ]]; then
  ARTIFACT="${SCRIPT_DIR}/../tmp/graymatter-capability-acceptance-${RUN_REF}.json"
fi
mkdir -p "$(dirname "$ARTIFACT")"

RESPONSE=""
REQUEST_OK=false
invoke() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response_file="$TMP_DIR/response.json"
  local stderr_file="$TMP_DIR/request.stderr"

  REQUEST_OK=false
  : >"$response_file"
  : >"$stderr_file"
  if "$API_COMMAND" "$method" "$path" "$body" >"$response_file" 2>"$stderr_file"; then
    RESPONSE="$(<"$response_file")"
    REQUEST_OK=true
  else
    RESPONSE=""
  fi
}

record_probe() {
  local capability_id="$1"
  local passed="$2"
  local reason="$3"
  local http_status="$4"
  local short_ref="$5"

  jq -nc \
    --arg capabilityId "$capability_id" \
    --argjson passed "$passed" \
    --argjson httpStatus "$http_status" \
    --arg contractVersion "$CONTRACT_VERSION" \
    --arg reason "$reason" \
    --arg evidenceRef "signature-canary/${RUN_REF}/${short_ref}" \
    '{capabilityId:$capabilityId,passed:$passed,httpStatus:$httpStatus,contractVersion:$contractVersion,reason:$reason,evidenceRef:$evidenceRef}' \
    >>"$PROBES_FILE"
}

receipt_id=""
receipt_request="$(jq -nc \
  --arg query "$CANARY_QUERY" \
  --arg key "omega-canary-${RUN_REF}" \
  '{query:$query,topK:1,retrievalMode:"KEYWORD",includeItems:false,includeText:false,includeEvaluator:true,idempotencyKey:$key,filters:{canary:true,canaryContract:"omegarag-signature-canary/v1"}}')"
invoke POST /graymatter-retrieval-receipts "$receipt_request"
if [[ "$REQUEST_OK" == true ]] && jq -e '
    (.receipt // .retrievalReceipt // empty) as $receipt
    | ($receipt | type == "object")
    and (($receipt.receiptId // $receipt.traceId // $receipt.id // "") | type == "string" and length > 0)
  ' >/dev/null 2>&1 <<<"$RESPONSE"; then
  receipt_id="$(jq -r '(.receipt // .retrievalReceipt).receiptId // .traceId // .id // empty' <<<"$RESPONSE")"
  record_probe graymatter.receipt.create true contract_passed 200 receipt
else
  record_probe graymatter.receipt.create false receipt_contract_or_transport_failed 0 receipt
fi

if [[ -n "$receipt_id" ]]; then
  invoke GET "/graymatter/retrieval-context/${receipt_id}?maxChars=${MAX_CONTEXT_CHARS}"
  if [[ "$REQUEST_OK" == true ]] && jq -e '
      (.retrievalReceipt // .receipt // empty) as $receipt
      | ($receipt | type == "object")
      and (($receipt.receiptId // $receipt.traceId // $receipt.id // "") | type == "string" and length > 0)
      and ((.answerPolicy // "") | type == "string" and length > 0)
    ' >/dev/null 2>&1 <<<"$RESPONSE"; then
    record_probe graymatter.context.create true contract_passed 200 context
  else
    record_probe graymatter.context.create false context_contract_or_transport_failed 0 context
  fi
else
  record_probe graymatter.context.create false receipt_signature_failed 0 context
fi

invoke GET /graymatter/object-graph/shape
if [[ "$REQUEST_OK" == true ]] && jq -e '
    .schemaAvailable == true
    and .rbacFiltered == true
    and ((.schemaVersion // "") | type == "string" and length > 0)
    and ((.policyVersion // "") | type == "string" and length > 0)
    and (.domains | type == "array")
  ' >/dev/null 2>&1 <<<"$RESPONSE"; then
  record_probe graymatter.graph.shape true contract_passed 200 graph-shape
else
  record_probe graymatter.graph.shape false graph_shape_contract_or_transport_failed 0 graph-shape
fi

invoke GET /graymatter/semantic-index/manifest
if [[ "$REQUEST_OK" == true ]] && jq -e '
    .schemaAvailable == true
    and .rbacFiltered == true
    and (.indexLifecycle | type == "object")
    and (.indexLifecycle.lifecycleDataAvailable == true)
    and ((.indexLifecycle.manifestVersion // "") | type == "string" and length > 0)
    and ((.indexLifecycle.healthStatus // "") | ascii_downcase) as $health
    | ($health | startswith("blocked") or startswith("degraded") or startswith("unavailable") or . == "migration_required" or . == "empty_authorized_scope" | not)
  ' >/dev/null 2>&1 <<<"$RESPONSE"; then
  record_probe graymatter.semantic.manifest true contract_passed 200 semantic-manifest
else
  record_probe graymatter.semantic.manifest false semantic_manifest_contract_or_transport_failed 0 semantic-manifest
fi

PUBLISHED=false
VERIFY_STATE="NOT_REQUESTED"
if [[ "$PUBLISH_EVIDENCE" == true ]]; then
  submission="$(jq -s '{probes:.}' "$PROBES_FILE")"
  invoke POST /graymatter/omega/capabilities/evidence "$submission"
  if [[ "$REQUEST_OK" == true ]] && jq -e --slurpfile probes "$PROBES_FILE" '
      (.acceptedCapabilityIds | type == "array")
      and ((.acceptedCapabilityIds | sort) == ($probes | map(.capabilityId) | sort))
    ' >/dev/null 2>&1 <<<"$RESPONSE"; then
    PUBLISHED=true
    invoke GET /graymatter/omega/capabilities
    if [[ "$REQUEST_OK" == true ]] && jq -e --slurpfile probes "$PROBES_FILE" '
        . as $manifest
        | ($manifest.capabilities | type == "array")
        and all($probes[]; . as $probe
          | ([$manifest.capabilities[]
              | select((.capabilityId // .id) == $probe.capabilityId)
              | .state] | first) as $state
          | $state == (if $probe.passed then "LIVE_VERIFIED" else "DEGRADED" end))
      ' >/dev/null 2>&1 <<<"$RESPONSE"; then
      VERIFY_STATE="PASSED"
    else
      VERIFY_STATE="FAILED"
    fi
  else
    VERIFY_STATE="EVIDENCE_PUBLICATION_FAILED"
  fi
fi

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
query_digest="$(printf '%s' "$CANARY_QUERY" | shasum -a 256 | awk '{print $1}')"
jq -s \
  --arg reportVersion "$CONTRACT_VERSION" \
  --arg startedAt "$STARTED_AT" \
  --arg finishedAt "$FINISHED_AT" \
  --arg runRef "signature-canary/${RUN_REF}" \
  --arg queryDigest "sha256:${query_digest}" \
  --argjson publishRequested "$PUBLISH_EVIDENCE" \
  --argjson published "$PUBLISHED" \
  --arg verification "$VERIFY_STATE" \
  '{reportVersion:$reportVersion,startedAt:$startedAt,finishedAt:$finishedAt,runRef:$runRef,queryDigest:$queryDigest,publishRequested:$publishRequested,published:$published,verification:$verification,probes:.}' \
  "$PROBES_FILE" >"$ARTIFACT"

all_passed=false
if jq -s -e 'all(.[]; .passed == true)' "$PROBES_FILE" >/dev/null 2>&1; then
  all_passed=true
fi

if [[ "$FORMAT" == json ]]; then
  cat "$ARTIFACT"
else
  printf 'OmegaRAG signature canary: %s\n' "$([[ "$all_passed" == true && "$VERIFY_STATE" != "FAILED" && "$VERIFY_STATE" != "EVIDENCE_PUBLICATION_FAILED" ]] && echo PASS || echo FAIL)"
  jq -r '.probes[] | "  - \(.capabilityId): " + (if .passed then "PASS" else "FAIL" end) + " (\(.reason))"' "$ARTIFACT"
  printf 'Content-free report: %s\n' "$ARTIFACT"
  if [[ "$PUBLISH_EVIDENCE" == true ]]; then
    printf 'Capability evidence: %s\n' "$VERIFY_STATE"
  fi
fi

if [[ "$all_passed" != true || "$VERIFY_STATE" == "FAILED" || "$VERIFY_STATE" == "EVIDENCE_PUBLICATION_FAILED" ]]; then
  exit 1
fi
