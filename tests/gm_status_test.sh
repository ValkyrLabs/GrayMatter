#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_status_contract() {
  local script="$1"
  local label="$2"
  local work_dir="$TMP_DIR/$label"
  mkdir -p "$work_dir/memory" "$work_dir/tmp"
  cat > "$work_dir/memory/graymatter-fallback.json" <<'JSON'
[]
JSON
  cat > "$work_dir/tmp/openapi.json" <<'JSON'
{
  "paths": {
    "/v1/swarm-ops/graph": {},
    "/StrategicRecord": {},
    "/KPIRecord": {}
  }
}
JSON

  cp "$script" "$work_dir/gm-status"
  cp "$(dirname "$script")/gm-schema-cache-lib" "$work_dir/gm-schema-cache-lib"
  identity="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN=test bash -c 'source "$ROOT_DIR/gm-schema-cache-lib"; gm_schema_identity "$VALKYR_API_BASE" "$VALKYR_AUTH_TOKEN"')"
  now_epoch="$(date +%s)"
  jq -n \
    --argjson now "$now_epoch" \
    --arg apiBase "http://127.0.0.1:9/v1" \
    --arg environmentFingerprint "$(jq -r '.environmentFingerprint' <<<"$identity")" \
    --arg tenantFingerprint "$(jq -r '.tenantFingerprint' <<<"$identity")" \
    --arg principalFingerprint "$(jq -r '.principalFingerprint' <<<"$identity")" \
    --arg scopeFingerprint "$(jq -r '.scopeFingerprint' <<<"$identity")" \
    '{fetchedAt:"2026-07-23T00:00:00Z",fetchedAtEpoch:$now,lastCheckedAt:"2026-07-23T00:00:00Z",lastCheckedAtEpoch:$now,lastOutcome:"200",schemaSource:"cached",apiBase:$apiBase,environmentFingerprint:$environmentFingerprint,tenantFingerprint:$tenantFingerprint,principalFingerprint:$principalFingerprint,scopeFingerprint:$scopeFingerprint,schemaRevision:"test",specVersion:"3.0.1"}' \
    > "$work_dir/tmp/openapi.json.meta.json"
  chmod +x "$work_dir/gm-status"
  out="$(ROOT_DIR="$work_dir" OPENAPI_PATH="$work_dir/tmp/openapi.json" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN=test "$work_dir/gm-status")"

  echo "$out" | grep -q '^graymatter_auth=env$'
  echo "$out" | grep -q '^tenant_schema_context=unknown$'
  echo "$out" | grep -q '^memory_layer=degraded$'
  echo "$out" | grep -q '^openapi_schema_cache=ready$'
  echo "$out" | grep -q '^graph_layer=ready$'
  echo "$out" | grep -q '^strategic_layer=ready$'
  echo "$out" | grep -q '^kpi_layer=ready$'

  readonly_jwt='eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlcyI6WyJFVkVSWU9ORSJdLCJzY29wZXMiOlsiU0NPUEVfc2NoZW1hLnJlYWQiXX0.'
  out_readonly="$(ROOT_DIR="$work_dir" OPENAPI_PATH="$work_dir/tmp/openapi.json" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$readonly_jwt" "$work_dir/gm-status")"
  echo "$out_readonly" | grep -q '^graymatter_auth=env:read_only$'
  echo "$out_readonly" | grep -q '^tenant_schema_context=unknown$'
  echo "$out_readonly" | grep -q '^memory_layer=degraded$'

  valkyr_agent_jwt='eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlcyI6WyJFVkVSWU9ORSIsIlZBTEtZUl9BR0VOVCJdLCJzY29wZXMiOlsiU0NPUEVfc2NoZW1hLnJlYWQiLCJTQ09QRV9zY2hlbWEud3JpdGUiXX0.'
  out_agent="$(ROOT_DIR="$work_dir" OPENAPI_PATH="$work_dir/tmp/openapi.json" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status")"
  echo "$out_agent" | grep -q '^graymatter_auth=env$'
  echo "$out_agent" | grep -q '^tenant_schema_context=ready$'
  echo "$out_agent" | grep -q '^tenant_schema_name=main$'
  echo "$out_agent" | grep -q '^tenant_schema_source=jwt_valkyr_agent_main_schema_fallback$'
  echo "$out_agent" | grep -q '^memory_layer=degraded$'

  json_out="$(ROOT_DIR="$work_dir" OPENAPI_PATH="$work_dir/tmp/openapi.json" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status" --json)"
  jq -e '
    .graymatter.health == "degraded"
    and .graymatter.auth == "env_token"
    and .graymatter.tenantSchemaContext.tenantSchemaContext == "ready"
    and .graymatter.tenantSchemaContext.schemaName == "main"
    and .graymatter.fallback.pendingWrites == 0
  ' <<<"$json_out" >/dev/null

  format_json_out="$(ROOT_DIR="$work_dir" OPENAPI_PATH="$work_dir/tmp/openapi.json" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status" --format=json)"
  jq -e '.graymatter.tenantSchemaContext.source == "jwt_valkyr_agent_main_schema_fallback"' <<<"$format_json_out" >/dev/null
  jq -e '
    .graymatter.schemaCache.state == "ready"
    and .graymatter.schemaCache.layers.graph == "ready"
    and .graymatter.schemaCache.layers.strategic == "ready"
    and .graymatter.schemaCache.layers.kpi == "ready"
  ' <<<"$format_json_out" >/dev/null

  if "$work_dir/gm-status" --format yaml >"$work_dir/gm-status-invalid.out" 2>&1; then
    echo "expected invalid format failure for $label" >&2
    exit 1
  fi
  grep -q "unsupported format yaml" "$work_dir/gm-status-invalid.out"
}

run_missing_schema_cache_contract() {
  local script="$1"
  local label="$2"
  local work_dir="$TMP_DIR/${label}-missing-cache"
  mkdir -p "$work_dir/memory" "$work_dir/tmp"
  printf '[]\n' > "$work_dir/memory/graymatter-fallback.json"
  cp "$script" "$work_dir/gm-status"
  cp "$(dirname "$script")/gm-schema-cache-lib" "$work_dir/gm-schema-cache-lib"
  chmod +x "$work_dir/gm-status"

  local out
  out="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN=test "$work_dir/gm-status")"
  echo "$out" | grep -q '^openapi_schema_cache=missing$'
  echo "$out" | grep -q '^graph_layer=unknown$'
  echo "$out" | grep -q '^strategic_layer=unknown$'
  echo "$out" | grep -q '^kpi_layer=unknown$'
}

run_status_contract "$ROOT_DIR/scripts/gm-status" "root"
run_status_contract "$ROOT_DIR/plugins/graymatter/scripts/gm-status" "plugin"
run_missing_schema_cache_contract "$ROOT_DIR/scripts/gm-status" "root"
run_missing_schema_cache_contract "$ROOT_DIR/plugins/graymatter/scripts/gm-status" "plugin"

echo "gm_status_test: ok"
