#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SRC="$ROOT/scripts/gm-startup-preflight"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-startup-preflight-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'gm_startup_preflight_test: %s\n' "$*" >&2
  exit 1
}

assert_jq() {
  local file="$1"
  local expression="$2"
  jq -e "$expression" "$file" >/dev/null || fail "assertion failed for $file: $expression"
}

fixture_scripts="$TMP_DIR/scripts"
mkdir -p "$fixture_scripts"
cp "$SCRIPT_SRC" "$fixture_scripts/gm-startup-preflight"
chmod 755 "$fixture_scripts/gm-startup-preflight"

cat >"$fixture_scripts/gm-invariant-preflight" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_INVARIANT_LOG:?}"
if [[ "${TEST_INVARIANT_FAIL:-false}" == "true" ]]; then
  exit 2
fi
jq -n --arg workspace "${1##*:}" '{
  sourceChannel:("codex:workspace:" + $workspace),
  workspace:$workspace,
  status:{state:"ready",response:{}},
  count:2,
  entries:[],
  failClosed:true
}'
EOF
chmod 755 "$fixture_scripts/gm-invariant-preflight"

cat >"$fixture_scripts/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_API_LOG:?}"
case "$*" in
  "GET /graymatter/omega/capabilities") cat "${TEST_CAPABILITY_FILE:?}" ;;
  "GET /graymatter/semantic-index/manifest") cat "${TEST_INDEX_MANIFEST_FILE:?}" ;;
  *) exit 2 ;;
esac
EOF
chmod 755 "$fixture_scripts/graymatter_api.sh"

cat >"$fixture_scripts/gm-openapi-sync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_SCHEMA_LOG:?}"
mkdir -p "$(dirname "$1")"
cp "${TEST_OPENAPI_FILE:?}" "$1"
printf '%s\n' "$1"
EOF
chmod 755 "$fixture_scripts/gm-openapi-sync"

now_epoch="$(date -u +%s)"
valid_capabilities="$TMP_DIR/capabilities.json"
jq -n --argjson now "$now_epoch" '
  def fractional_utc($epoch):
    ($epoch | strftime("%Y-%m-%dT%H:%M:%SZ") | sub("Z$"; ".123456789Z"));
  {
    manifestVersion:"omegarag-capability-manifest/v1",
    apiVersion:"v1",
    environment:"test",
    scopeHash:("a" * 64),
    schemaVersion:"schema-v1",
    policyVersion:"policy-v1",
    authorityHash:("b" * 64),
    checkedAt:fractional_utc($now - 30),
    expiresAt:fractional_utc($now + 300),
    ttlSeconds:330,
    capabilities:[
      {
        id:null,
        capabilityId:"graymatter.memory.query",
        state:"LIVE_VERIFIED",
        evidenceTier:"AUTHENTICATED_LIVE_READ",
        invocable:true,
        liveVerified:true,
        evidenceExpiresAt:fractional_utc($now + 300),
        safeNextAction:"continue_with_policy",
        tenantName:"must-not-leak",
        providerResponse:{secret:"must-not-leak"}
      },
      {
        id:null,
        capabilityId:"graymatter.graph.expand",
        state:"IMPLEMENTED_UNVERIFIED",
        evidenceTier:"RUNTIME_COMPONENT_REGISTRATION",
        invocable:true,
        liveVerified:false,
        safeNextAction:"run_content_free_canary"
      }
    ],
    subsystems:[{
      id:null,
      subsystemId:"graymatter.receipt",
      state:"IMPLEMENTED_UNVERIFIED",
      evidenceTier:"RUNTIME_COMPONENT_REGISTRATION",
      safeNextAction:"run_content_free_canary",
      privateCount:42
    }],
    limits:{maxTopK:50,maxAsyncAttempts:4,circuitFailureThreshold:3,privateBalance:999},
    distributions:{
      light:{
        displayName:"GrayMatter Light",
        evidenceTier:"CONTRACT_DECLARATION",
        currentRuntimeCompatible:true,
        correctnessPath:["portable"],
        optionalAccelerators:[],
        explicitDifferences:["local"]
      },
      cloud:{
        displayName:"GrayMatter Cloud",
        evidenceTier:"AUTHENTICATED_LIVE_READ",
        currentRuntimeCompatible:true,
        correctnessPath:["tenant-acl"],
        optionalAccelerators:["managed-vector"],
        explicitDifferences:["managed"]
      }
    },
    accessToken:"must-not-leak"
  }
' >"$valid_capabilities"

valid_index_manifest="$TMP_DIR/semantic-index-manifest.json"
jq -n '{
  mode:"rbac_visible_schema",
  schemaAvailable:true,
  rbacFiltered:true,
  reindexEndpoint:"/memory/semantic-index/reindex",
  targetSearchEndpoint:"/memory/semantic-index/search",
  tenantName:"must-not-leak",
  indexLifecycle:{
    lifecycleDataAvailable:true,
    healthStatus:"healthy",
    qualityState:"portable_embeddings_active",
    freshnessStatus:"current",
    indexMigrationRequired:false,
    providerMigrationRequired:false,
    chunkerVersionMismatch:false,
    readOnly:false,
    containsIndexedContent:true,
    manifestTruncated:false,
    manifestVersion:"omegarag-semantic-index-manifest/v1",
    indexVersion:"semantic-index-entry/v1",
    chunkerVersion:"omegarag-corpus-indexer/v1",
    aclStrategy:"tenant_scope_then_generated_target_read_acl",
    activeDimensions:[384,1536],
    recommendedAction:null,
    warnings:[],
    activeRows:99,
    configuredProvider:"must-not-leak",
    configuredModel:"must-not-leak",
    providerResponse:{secret:"must-not-leak"}
  },
  indexPolicy:{
    schemaVersion:("sha256:" + ("c" * 64)),
    effectivePolicyVersion:("sha256:" + ("d" * 64)),
    snapshotVersion:"omegarag-generated-index-policy/v1",
    reviewedOverridesRequired:true,
    staleOverridesRejected:true,
    warnings:[]
  }
}' >"$valid_index_manifest"

valid_openapi="$TMP_DIR/api-docs.json"
jq -n '{
  openapi:"3.1.0",
  info:{title:"ValkyrAI CORE API",version:"test-version"},
  paths:{
    "/v1/graymatter/omega/capabilities":{get:{}},
    "/v1/graymatter/semantic-index/manifest":{get:{}},
    "/v1/MemoryEntry/query":{post:{}},
    "/v1/MemoryEntry":{get:{}}
  }
}' >"$valid_openapi"

export TEST_CAPABILITY_FILE="$valid_capabilities"
export TEST_INDEX_MANIFEST_FILE="$valid_index_manifest"
export TEST_OPENAPI_FILE="$valid_openapi"
export TEST_API_LOG="$TMP_DIR/api.log"
export TEST_SCHEMA_LOG="$TMP_DIR/schema.log"
export TEST_INVARIANT_LOG="$TMP_DIR/invariant.log"
export GRAYMATTER_STATE_DIR="$TMP_DIR/state"

run_dir="$TMP_DIR/ready"
mkdir -p "$run_dir"
ready_out="$run_dir/startup.json"
"$fixture_scripts/gm-startup-preflight" \
  --workspace-key OmegaTest \
  --openapi-cache "$run_dir/api-docs.json" \
  --capability-cache "$run_dir/capability-summary.json" \
  --index-manifest-cache "$run_dir/semantic-index-summary.json" \
  --out "$ready_out" \
  --format json >/dev/null
assert_jq "$ready_out" '
  .schemaVersion == "graymatter-startup-preflight/v1"
  and .status == "READY_WITH_LIMITS"
  and .invariantPreflight.workspace == "OmegaTest"
  and .invariantPreflight.matchCount == 2
  and .capabilityDiscovery.stateCounts.LIVE_VERIFIED == 1
  and .capabilityDiscovery.stateCounts.IMPLEMENTED_UNVERIFIED == 1
  and .capabilityDiscovery.subsystemStateCounts.IMPLEMENTED_UNVERIFIED == 1
  and .capabilityDiscovery.subsystems[0].id == "graymatter.receipt"
  and .capabilityDiscovery.capabilities[0].id == "graymatter.graph.expand"
  and .capabilityDiscovery.limits.maxAsyncAttempts == 4
  and .capabilityDiscovery.limits.circuitFailureThreshold == 3
  and .semanticIndexCompatibility.status == "READY"
  and .semanticIndexCompatibility.rbacFiltered == true
  and .semanticIndexCompatibility.lifecycle.manifestVersion == "omegarag-semantic-index-manifest/v1"
  and .semanticIndexCompatibility.lifecycle.activeDimensions == ["384","1536"]
  and .semanticIndexCompatibility.lifecycle.indexMigrationRequired == false
  and .semanticIndexCompatibility.policy.reviewedOverridesRequired == true
  and .schemaFreshness.status == "READY"
  and .schemaFreshness.apiVersion == "test-version"
  and .schemaFreshness.requiredPaths.capabilityDiscovery == true
  and .schemaFreshness.requiredPaths.semanticIndexManifest == true
  and ([.authorizations[]] | all(. == false))
'
if jq -r tostring "$ready_out" | grep -Eq 'must-not-leak|privateBalance|privateCount|activeRows|configuredProvider|configuredModel|providerResponse'; then
  fail "startup evidence leaked a private capability or semantic-index field"
fi
cmp -s "$run_dir/semantic-index-summary.json" <(jq -c '.semanticIndexCompatibility' "$ready_out") \
  || fail "semantic-index cache does not match the safe startup projection"
grep -q 'OmegaTest startup activation capability schema invariant rule instruction' "$TEST_INVARIANT_LOG" \
  || fail "startup did not run the workspace invariant preflight"
grep -q '^GET /graymatter/omega/capabilities$' "$TEST_API_LOG" \
  || fail "startup did not run canonical capability discovery"
grep -q '^GET /graymatter/semantic-index/manifest$' "$TEST_API_LOG" \
  || fail "startup did not run canonical semantic-index compatibility discovery"

degraded_capabilities="$TMP_DIR/degraded-capabilities.json"
jq '.capabilities[0].state = "DEGRADED" | .capabilities[0].liveVerified = false' \
  "$valid_capabilities" >"$degraded_capabilities"
export TEST_CAPABILITY_FILE="$degraded_capabilities"
degraded_out="$TMP_DIR/degraded-startup.json"
"$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/degraded-api.json" \
  --capability-cache "$TMP_DIR/degraded-capability-summary.json" \
  --out "$degraded_out" --format json >/dev/null
assert_jq "$degraded_out" '
  .status == "DEGRADED"
  and .capabilityDiscovery.status == "DEGRADED"
  and .capabilityDiscovery.stateCounts.DEGRADED == 1
'

export TEST_CAPABILITY_FILE="$valid_capabilities"
degraded_index_manifest="$TMP_DIR/degraded-index-manifest.json"
jq '
  .indexLifecycle.healthStatus = "blocked_dimension_mismatch"
  | .indexLifecycle.indexMigrationRequired = true
  | .indexLifecycle.providerMigrationRequired = true
  | .indexLifecycle.readOnly = true
  | .indexLifecycle.recommendedAction = "run_semantic_reindex"
  | .indexLifecycle.warnings = ["semantic_index_migration_required"]
' "$valid_index_manifest" >"$degraded_index_manifest"
export TEST_INDEX_MANIFEST_FILE="$degraded_index_manifest"
degraded_index_out="$TMP_DIR/degraded-index-startup.json"
"$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/degraded-index-api.json" \
  --capability-cache "$TMP_DIR/degraded-index-capability-summary.json" \
  --index-manifest-cache "$TMP_DIR/degraded-index-summary.json" \
  --out "$degraded_index_out" --format json >/dev/null
assert_jq "$degraded_index_out" '
  .status == "DEGRADED"
  and .semanticIndexCompatibility.status == "DEGRADED"
  and .semanticIndexCompatibility.lifecycle.healthStatus == "blocked_dimension_mismatch"
  and .semanticIndexCompatibility.lifecycle.recommendedAction == "run_semantic_reindex"
'

unsupported_index_manifest="$TMP_DIR/unsupported-index-manifest.json"
jq '.indexLifecycle.activeDimensions += [768]' "$valid_index_manifest" >"$unsupported_index_manifest"
export TEST_INDEX_MANIFEST_FILE="$unsupported_index_manifest"
unsupported_index_out="$TMP_DIR/unsupported-index-startup.json"
"$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/unsupported-index-api.json" \
  --capability-cache "$TMP_DIR/unsupported-index-capability-summary.json" \
  --out "$unsupported_index_out" --format json >/dev/null
assert_jq "$unsupported_index_out" '
  .status == "DEGRADED"
  and .semanticIndexCompatibility.status == "DEGRADED"
  and .semanticIndexCompatibility.lifecycle.activeDimensions == ["384","768","1536"]
'

unavailable_index_manifest="$TMP_DIR/unavailable-index-manifest.json"
jq '
  .schemaAvailable = false
  | .indexLifecycle.lifecycleDataAvailable = false
  | .indexLifecycle.healthStatus = "unavailable"
  | .indexLifecycle.qualityState = "unavailable"
  | .indexLifecycle.freshnessStatus = "unknown"
  | .indexLifecycle.recommendedAction = "restore_semantic_index_runtime"
' "$valid_index_manifest" >"$unavailable_index_manifest"
export TEST_INDEX_MANIFEST_FILE="$unavailable_index_manifest"
unavailable_index_out="$TMP_DIR/unavailable-index-startup.json"
"$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/unavailable-index-api.json" \
  --capability-cache "$TMP_DIR/unavailable-index-capability-summary.json" \
  --out "$unavailable_index_out" --format json >/dev/null
assert_jq "$unavailable_index_out" '
  .status == "DEGRADED"
  and .semanticIndexCompatibility.status == "DEGRADED"
  and .semanticIndexCompatibility.schemaAvailable == false
  and .semanticIndexCompatibility.lifecycle.healthStatus == "unavailable"
'

invalid_index_manifest="$TMP_DIR/invalid-index-manifest.json"
jq '.rbacFiltered = false' "$valid_index_manifest" >"$invalid_index_manifest"
export TEST_INDEX_MANIFEST_FILE="$invalid_index_manifest"
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/invalid-index-api.json" \
  --capability-cache "$TMP_DIR/invalid-index-summary.json" >/dev/null 2>&1; then
  fail "startup accepted an unscoped semantic-index manifest"
fi
export TEST_INDEX_MANIFEST_FILE="$valid_index_manifest"

invalid_index_policy="$TMP_DIR/invalid-index-policy.json"
jq '.indexPolicy.schemaVersion = "must-not-leak"' "$valid_index_manifest" >"$invalid_index_policy"
export TEST_INDEX_MANIFEST_FILE="$invalid_index_policy"
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/invalid-index-policy-api.json" \
  --capability-cache "$TMP_DIR/invalid-index-policy-summary.json" >/dev/null 2>&1; then
  fail "startup accepted an invalid semantic-index policy version"
fi
export TEST_INDEX_MANIFEST_FILE="$valid_index_manifest"

expired_capabilities="$TMP_DIR/expired-capabilities.json"
jq --argjson now "$now_epoch" \
  '.expiresAt = ($now - 1 | strftime("%Y-%m-%dT%H:%M:%SZ"))' \
  "$valid_capabilities" >"$expired_capabilities"
export TEST_CAPABILITY_FILE="$expired_capabilities"
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/expired-api.json" \
  --capability-cache "$TMP_DIR/expired-summary.json" >/dev/null 2>&1; then
  fail "startup accepted an expired capability manifest"
fi

export TEST_CAPABILITY_FILE="$valid_capabilities"
invalid_openapi="$TMP_DIR/invalid-api-docs.json"
jq 'del(.paths["/v1/graymatter/omega/capabilities"])' "$valid_openapi" >"$invalid_openapi"
export TEST_OPENAPI_FILE="$invalid_openapi"
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/invalid-api.json" \
  --capability-cache "$TMP_DIR/invalid-summary.json" >/dev/null 2>&1; then
  fail "startup accepted a schema without capability discovery"
fi

invalid_index_openapi="$TMP_DIR/invalid-index-api-docs.json"
jq 'del(.paths["/v1/graymatter/semantic-index/manifest"])' "$valid_openapi" >"$invalid_index_openapi"
export TEST_OPENAPI_FILE="$invalid_index_openapi"
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/invalid-index-schema.json" \
  --capability-cache "$TMP_DIR/invalid-index-schema-summary.json" >/dev/null 2>&1; then
  fail "startup accepted a schema without semantic-index manifest discovery"
fi

export TEST_OPENAPI_FILE="$valid_openapi"
export TEST_INVARIANT_FAIL=true
if "$fixture_scripts/gm-startup-preflight" \
  --openapi-cache "$TMP_DIR/invariant-fail-api.json" \
  --capability-cache "$TMP_DIR/invariant-fail-summary.json" >/dev/null 2>&1; then
  fail "startup accepted unavailable invariant retrieval without an explicit degraded mode"
fi
memory_degraded_out="$TMP_DIR/memory-degraded.json"
"$fixture_scripts/gm-startup-preflight" \
  --allow-memory-degraded \
  --openapi-cache "$TMP_DIR/memory-degraded-api.json" \
  --capability-cache "$TMP_DIR/memory-degraded-summary.json" \
  --out "$memory_degraded_out" --format json >/dev/null
assert_jq "$memory_degraded_out" '
  .status == "DEGRADED"
  and .invariantPreflight.status == "DEGRADED"
  and .invariantPreflight.reason == "invariant_preflight_unavailable"
'

installed_dir="$TMP_DIR/installed"
mkdir -p "$installed_dir"
unzip -q "$ROOT/graymatter.skill" -d "$installed_dir"
installed_matrix="$TMP_DIR/installed-smoke-matrix.json"
"$installed_dir/graymatter/scripts/gm-agent-smoke-matrix" --out "$installed_matrix" >/dev/null
assert_jq "$installed_matrix" '
  .summary.fail == 0
  and (.stages[] | select(.name == "startup_preflight_readiness" and .status == "pass"))
'

echo "gm_startup_preflight_test: ok"
