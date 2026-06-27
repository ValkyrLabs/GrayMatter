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
  chmod +x "$work_dir/gm-status"
  out="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN=test "$work_dir/gm-status")"

  echo "$out" | grep -q '^graymatter_auth=env$'
  echo "$out" | grep -q '^tenant_schema_context=unknown$'
  echo "$out" | grep -q '^memory_layer=degraded$'
  echo "$out" | grep -q '^graph_layer=ready$'
  echo "$out" | grep -q '^strategic_layer=ready$'
  echo "$out" | grep -q '^kpi_layer=ready$'

  readonly_jwt='eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlcyI6WyJFVkVSWU9ORSJdLCJzY29wZXMiOlsiU0NPUEVfc2NoZW1hLnJlYWQiXX0.'
  out_readonly="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$readonly_jwt" "$work_dir/gm-status")"
  echo "$out_readonly" | grep -q '^graymatter_auth=env:read_only$'
  echo "$out_readonly" | grep -q '^tenant_schema_context=unknown$'
  echo "$out_readonly" | grep -q '^memory_layer=degraded$'

  valkyr_agent_jwt='eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJyb2xlcyI6WyJFVkVSWU9ORSIsIlZBTEtZUl9BR0VOVCJdLCJzY29wZXMiOlsiU0NPUEVfc2NoZW1hLnJlYWQiLCJTQ09QRV9zY2hlbWEud3JpdGUiXX0.'
  out_agent="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status")"
  echo "$out_agent" | grep -q '^graymatter_auth=env$'
  echo "$out_agent" | grep -q '^tenant_schema_context=ready$'
  echo "$out_agent" | grep -q '^tenant_schema_name=main$'
  echo "$out_agent" | grep -q '^tenant_schema_source=jwt_valkyr_agent_main_schema_fallback$'
  echo "$out_agent" | grep -q '^memory_layer=degraded$'

  json_out="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status" --json)"
  jq -e '
    .graymatter.health == "ok"
    and .graymatter.auth == "env_token"
    and .graymatter.tenantSchemaContext.tenantSchemaContext == "ready"
    and .graymatter.tenantSchemaContext.schemaName == "main"
    and .graymatter.fallback.pendingWrites == 0
  ' <<<"$json_out" >/dev/null

  format_json_out="$(ROOT_DIR="$work_dir" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$valkyr_agent_jwt" "$work_dir/gm-status" --format=json)"
  jq -e '.graymatter.tenantSchemaContext.source == "jwt_valkyr_agent_main_schema_fallback"' <<<"$format_json_out" >/dev/null

  if "$work_dir/gm-status" --format yaml >"$work_dir/gm-status-invalid.out" 2>&1; then
    echo "expected invalid format failure for $label" >&2
    exit 1
  fi
  grep -q "unsupported format yaml" "$work_dir/gm-status-invalid.out"
}

run_status_contract "$ROOT_DIR/scripts/gm-status" "root"
run_status_contract "$ROOT_DIR/plugins/graymatter/scripts/gm-status" "plugin"

echo "gm_status_test: ok"
