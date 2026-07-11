#!/usr/bin/env bash
set -euo pipefail

MCP_URL="${GRAYMATTER_MCP_URL:-}"
TOKEN_A="${GRAYMATTER_TENANT_A_TOKEN:-}"
TOKEN_B="${GRAYMATTER_TENANT_B_TOKEN:-}"
RECEIPT_ID="${GRAYMATTER_TEST_RECEIPT_ID:-}"
LOG_FILE="${GRAYMATTER_LOG_FILE:-}"

for command_name in curl jq; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "smoke-test-public-mcp requires $command_name" >&2
    exit 1
  }
done

[[ -n "$MCP_URL" ]] || { echo "GRAYMATTER_MCP_URL is required" >&2; exit 1; }
[[ -n "$TOKEN_A" ]] || { echo "GRAYMATTER_TENANT_A_TOKEN is required" >&2; exit 1; }
[[ -n "$TOKEN_B" ]] || { echo "GRAYMATTER_TENANT_B_TOKEN is required" >&2; exit 1; }
[[ -n "$RECEIPT_ID" ]] || { echo "GRAYMATTER_TEST_RECEIPT_ID is required" >&2; exit 1; }

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/graymatter-public-mcp.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

rpc_payload() {
  local id="$1"
  local method="$2"
  local params_json="${3:-null}"
  jq -cn --argjson id "$id" --arg method "$method" --argjson params "$params_json" \
    '{jsonrpc:"2.0",id:$id,method:$method} + (if $params == null then {} else {params:$params} end)'
}

post_rpc() {
  local token="$1"
  local payload="$2"
  local output="$3"
  curl --fail-with-body --silent --show-error \
    -H 'accept: application/json, text/event-stream' \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${token}" \
    --data "$payload" \
    "$MCP_URL" >"$output"
}

tool_call() {
  local token="$1"
  local id="$2"
  local name="$3"
  local arguments_json="$4"
  local output="$5"
  local params
  params="$(jq -cn --arg name "$name" --argjson arguments "$arguments_json" '{name:$name,arguments:$arguments}')"
  post_rpc "$token" "$(rpc_payload "$id" tools/call "$params")" "$output"
}

RESOURCE_ORIGIN="$(jq -rn --arg url "$MCP_URL" '$url | capture("^(?<origin>https?://[^/]+)").origin')"
METADATA_URL="${RESOURCE_ORIGIN}/.well-known/oauth-protected-resource"

curl --fail-with-body --silent --show-error "$METADATA_URL" >"$TMP_DIR/resource-metadata.json"
jq -e '.resource and (.authorization_servers | length > 0) and (.scopes_supported | index("memory:read")) and (.scopes_supported | index("memory:write")) and (.scopes_supported | index("context:read"))' \
  "$TMP_DIR/resource-metadata.json" >/dev/null

unauth_status="$(curl --silent --show-error -o "$TMP_DIR/unauth.json" -D "$TMP_DIR/unauth.headers" -w '%{http_code}' \
  -H 'content-type: application/json' --data "$(rpc_payload 1 initialize)" "$MCP_URL")"
[[ "$unauth_status" == "401" ]] || { echo "expected OAuth challenge HTTP 401, got $unauth_status" >&2; exit 1; }
grep -qi '^www-authenticate: Bearer .*oauth-protected-resource' "$TMP_DIR/unauth.headers"

post_rpc "$TOKEN_A" "$(rpc_payload 2 initialize)" "$TMP_DIR/initialize.json"
jq -e '.result.protocolVersion and .result.serverInfo.name == "graymatter"' "$TMP_DIR/initialize.json" >/dev/null

post_rpc "$TOKEN_A" "$(rpc_payload 3 tools/list)" "$TMP_DIR/tools.json"
actual_tools="$(jq -r '.result.tools[].name' "$TMP_DIR/tools.json" | sort | tr '\n' ' ' | sed 's/ $//')"
expected_tools="context_compile memory_forget memory_get memory_save memory_search memory_update procedure_search retrieval_receipt_get"
[[ "$actual_tools" == "$expected_tools" ]] || {
  echo "unexpected public tool surface: $actual_tools" >&2
  exit 1
}

marker="graymatter-public-smoke-$(date -u +%Y%m%dT%H%M%SZ)-$$"
save_args="$(jq -cn --arg marker "$marker" '{title:"Public MCP smoke test",content:$marker,type:"context",tags:["mcp-smoke"],scope:"reviewer-test"}')"
tool_call "$TOKEN_A" 4 memory_save "$save_args" "$TMP_DIR/save.json"
jq -e '.result.structuredContent.ok == true and .result.structuredContent.data.id' "$TMP_DIR/save.json" >/dev/null
memory_id="$(jq -r '.result.structuredContent.data.id' "$TMP_DIR/save.json")"

search_args="$(jq -cn --arg marker "$marker" '{query:$marker,limit:10}')"
tool_call "$TOKEN_A" 5 memory_search "$search_args" "$TMP_DIR/search-a.json"
jq -e --arg marker "$marker" '.result.structuredContent.data | any(.text == $marker)' "$TMP_DIR/search-a.json" >/dev/null

tool_call "$TOKEN_B" 6 memory_search "$search_args" "$TMP_DIR/search-b.json"
if jq -e --arg marker "$marker" '.result.structuredContent.data | any(.text == $marker)' "$TMP_DIR/search-b.json" >/dev/null; then
  echo "cross-tenant isolation failed: tenant B retrieved tenant A marker" >&2
  exit 1
fi

override_args="$(jq -cn --arg marker "$marker" '{query:$marker,tenantId:"tenant-b"}')"
tool_call "$TOKEN_A" 7 memory_search "$override_args" "$TMP_DIR/override.json"
jq -e '.result.structuredContent.error.code == "INVALID_ARGUMENT"' "$TMP_DIR/override.json" >/dev/null

receipt_args="$(jq -cn --arg receiptId "$RECEIPT_ID" '{receiptId:$receiptId}')"
tool_call "$TOKEN_A" 8 retrieval_receipt_get "$receipt_args" "$TMP_DIR/receipt.json"
jq -e '.result.structuredContent.ok == true' "$TMP_DIR/receipt.json" >/dev/null

unconfirmed_args="$(jq -cn --arg id "$memory_id" '{id:$id,confirm:false,confirmationText:"not confirmed"}')"
tool_call "$TOKEN_A" 9 memory_forget "$unconfirmed_args" "$TMP_DIR/forget-denied.json"
jq -e '.result.structuredContent.error.code == "CONFIRMATION_REQUIRED"' "$TMP_DIR/forget-denied.json" >/dev/null

confirmed_args="$(jq -cn --arg id "$memory_id" '{id:$id,confirm:true,confirmationText:"Delete the public MCP smoke-test memory"}')"
tool_call "$TOKEN_A" 10 memory_forget "$confirmed_args" "$TMP_DIR/forget.json"
jq -e '.result.structuredContent.ok == true and .result.structuredContent.data.forgotten == true' "$TMP_DIR/forget.json" >/dev/null

if grep -R -F -q -- "$TOKEN_A" "$TMP_DIR" || grep -R -F -q -- "$TOKEN_B" "$TMP_DIR"; then
  echo "representative MCP responses leaked an access token" >&2
  exit 1
fi

if [[ -n "$LOG_FILE" ]]; then
  [[ -r "$LOG_FILE" ]] || { echo "GRAYMATTER_LOG_FILE is not readable" >&2; exit 1; }
  if grep -F -q -- "$TOKEN_A" "$LOG_FILE" || grep -F -q -- "$TOKEN_B" "$LOG_FILE" \
      || grep -E -qi 'authorization:[[:space:]]*bearer|access[_-]?token[[:space:]]*[:=]|password[[:space:]]*[:=]|private[_-]?key' "$LOG_FILE"; then
    echo "representative service logs contain secret-shaped data" >&2
    exit 1
  fi
fi

echo "GrayMatter public MCP smoke test passed"
echo "verified=metadata,oauth_challenge,initialize,tools,write_search,cross_tenant,receipt,forget_confirmation,secret_scan"

