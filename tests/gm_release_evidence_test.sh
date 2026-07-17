#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-release-evidence"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-release-evidence-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'gm_release_evidence_test: %s\n' "$*" >&2
  exit 1
}

assert_jq() {
  local file="$1"
  local expression="$2"
  jq -e "$expression" "$file" >/dev/null || fail "assertion failed for $file: $expression"
}

[[ -x "$SCRIPT" ]] || fail "release evidence script is missing or not executable"
cmp -s "$SCRIPT" "$ROOT/plugins/graymatter/scripts/gm-release-evidence" \
  || fail "root and marketplace release evidence scripts differ"
cmp -s "$ROOT/references/contracts/release/graymatter_omegarag_release_policy_v1.json" \
  "$ROOT/plugins/graymatter/references/contracts/release/graymatter_omegarag_release_policy_v1.json" \
  || fail "root and marketplace release policies differ"

missing_out="$TMP_DIR/missing.json"
"$SCRIPT" --out "$missing_out"
assert_jq "$missing_out" '
  .schemaVersion == "graymatter-omegarag-release-evidence/v1"
  and .decision == "HOLD"
  and ([.checks[] | select(.id == "capability-manifest" and .status == "FAIL")] | length == 1)
  and ([.checks[] | select(.id == "sustained-signature-canaries" and .status == "FAIL")] | length == 1)
  and ([.authorizations[]] | all(. == false))
'

now_epoch="$(date -u +%s)"
valid_manifest="$TMP_DIR/capabilities.json"
jq -n --argjson now "$now_epoch" '
  {
    manifestVersion:"omegarag-capability-manifest/v1",
    apiVersion:"v1",
    environment:"production",
    scopeHash:("a" * 64),
    schemaVersion:"schema-v1",
    policyVersion:"policy-v1",
    authorityHash:("b" * 64),
    checkedAt:($now - 30 | strftime("%Y-%m-%dT%H:%M:%SZ")),
    expiresAt:($now + 300 | strftime("%Y-%m-%dT%H:%M:%SZ")),
    ttlSeconds:330,
    capabilities:[
      {
        id:"graymatter.memory.query",
        state:"LIVE_VERIFIED",
        evidenceTier:"AUTHENTICATED_LIVE_READ",
        invocable:true,
        liveVerified:true,
        lastCheckedAt:($now - 30 | strftime("%Y-%m-%dT%H:%M:%SZ")),
        evidenceExpiresAt:($now + 300 | strftime("%Y-%m-%dT%H:%M:%SZ")),
        privateTenant:"tenant-must-not-leak",
        providerResponse:{secret:"provider-must-not-leak"}
      },
      {
        id:"graymatter.graph.expand",
        state:"IMPLEMENTED_UNVERIFIED",
        evidenceTier:"RUNTIME_COMPONENT_REGISTRATION",
        invocable:true,
        liveVerified:false,
        safeNextAction:"run_content_free_canary"
      },
      {
        id:"graymatter.future.contract",
        state:"PLANNED",
        evidenceTier:"CONTRACT_DECLARATION",
        invocable:false,
        liveVerified:false
      }
    ],
    subsystems:[],
    limits:{
      maxTopK:100,
      maxAsyncRunDurationMs:30000,
      maxAsyncAttempts:4,
      retryInitialBackoffMs:250,
      retryBackoffMultiplier:2,
      retryMaxBackoffMs:4000,
      circuitFailureThreshold:3,
      circuitOpenSeconds:30,
      privateBalance:999999
    },
    distributions:{
      light:{
        displayName:"GrayMatter Light",
        evidenceTier:"CONTRACT_DECLARATION",
        currentRuntimeCompatible:true,
        correctnessPath:["portable-java"],
        optionalAccelerators:[],
        explicitDifferences:["local-process-boundary"]
      },
      cloud:{
        displayName:"GrayMatter Cloud",
        evidenceTier:"AUTHENTICATED_LIVE_READ",
        currentRuntimeCompatible:true,
        correctnessPath:["tenant-acl-policy"],
        optionalAccelerators:["managed-vector"],
        explicitDifferences:["managed-provider-acceleration"]
      }
    },
    tenantName:"tenant-must-not-leak",
    accessToken:"token-must-not-leak"
  }
' >"$valid_manifest"

valid_history="$TMP_DIR/signature-history.json"
jq -n --argjson now "$now_epoch" '
  def capabilities: [
    "graymatter.receipt.create",
    "graymatter.context.create",
    "graymatter.graph.shape",
    "graymatter.semantic.manifest"
  ];
  {
    schemaVersion:"omegarag-signature-history/v1",
    generatedAt:($now - 10 | strftime("%Y-%m-%dT%H:%M:%SZ")),
    observations:[
      ["staging","production"][] as $environment
      | range(0; 7) as $day
      | capabilities[] as $capabilityId
      | {
          environment:$environment,
          observedAt:($now - 30 - ($day * 86400) | strftime("%Y-%m-%dT%H:%M:%SZ")),
          capabilityId:$capabilityId,
          passed:true,
          httpStatus:204,
          contractVersion:"omegarag-signature-canary/v1",
          evidenceRef:("signature-canary/" + $environment + "/" + ($day | tostring) + "/" + $capabilityId),
          evidenceHash:("e" * 64),
          scopeHash:(if $environment == "production" then ("a" * 64) else ("c" * 64) end),
          authorityHash:(if $environment == "production" then ("b" * 64) else ("d" * 64) end)
        }
    ]
  }
' >"$valid_history"

if "$SCRIPT" --capability-manifest "$valid_manifest" --out "$valid_manifest" >/dev/null 2>&1; then
  fail "generator accepted an output path that overwrites its capability input"
fi
if "$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$valid_history" \
  --out "$valid_history" >/dev/null 2>&1; then
  fail "generator accepted an output path that overwrites its signature-history input"
fi

valid_out="$TMP_DIR/valid-evidence.json"
"$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$valid_history" --out "$valid_out"
assert_jq "$valid_out" '
  .decision == "ELIGIBLE_FOR_HUMAN_REVIEW"
  and ([.checks[] | select(.status == "FAIL")] | length == 0)
  and ([.authorizations[]] | all(. == false))
  and (.checks[] | select(.id == "deterministic-package") | .status == "PASS")
  and (.checks[] | select(.id == "capability-manifest") | .details.manifest.stateCounts.IMPLEMENTED_UNVERIFIED == 1)
  and (.checks[] | select(.id == "capability-manifest") | .details.manifest.stateCounts.PLANNED == 1)
  and (.checks[] | select(.id == "capability-manifest") | .details.manifest.limits.maxAsyncAttempts == 4)
  and (.checks[] | select(.id == "capability-manifest") | .details.manifest.limits.circuitFailureThreshold == 3)
  and (.checks[] | select(.id == "sustained-signature-canaries")
    | .details.history.complete == true
      and .details.history.observationCount == 56
      and .details.history.productionManifestBound == true
      and ([.details.history.environments[].completeDays] | all(. == 7)))
  and (.knownLimitations | map(.distribution) | index("light") != null)
  and (.knownLimitations | map(.distribution) | index("cloud") != null)
'
if jq -r tostring "$valid_out" | grep -Eq 'tenant-must-not-leak|provider-must-not-leak|token-must-not-leak|privateBalance|signature-canary/(staging|production)'; then
  fail "release evidence leaked a private capability-manifest field"
fi
if jq -e '.. | strings | select(startswith("/private/") or startswith("/Users/") or startswith("/tmp/"))' \
  "$valid_out" >/dev/null; then
  fail "release evidence leaked an absolute local path"
fi

generated_manifest="$TMP_DIR/generated-shape.json"
jq --argjson now "$now_epoch" '
  def fractional_utc($epoch):
    ($epoch | strftime("%Y-%m-%dT%H:%M:%SZ") | sub("Z$"; ".123456789Z"));
  .checkedAt = fractional_utc($now - 30)
  | .expiresAt = fractional_utc($now + 300)
  | .capabilities |= map(
      .capabilityId = .id
      | .id = null
      | if .state == "LIVE_VERIFIED" then .evidenceExpiresAt = fractional_utc($now + 300) else . end)
  | .subsystems = [{
      id:null,
      subsystemId:"graymatter.receipt",
      state:"IMPLEMENTED_UNVERIFIED",
      evidenceTier:"RUNTIME_COMPONENT_REGISTRATION",
      reason:"registered",
      safeNextAction:"run_content_free_canary"
    }]
' "$valid_manifest" >"$generated_manifest"
generated_out="$TMP_DIR/generated-shape-evidence.json"
"$SCRIPT" --capability-manifest "$generated_manifest" --signature-history "$valid_history" --out "$generated_out"
assert_jq "$generated_out" '
  .decision == "ELIGIBLE_FOR_HUMAN_REVIEW"
  and (.checks[] | select(.id == "capability-manifest")
    | .details.manifest.capabilities[0].id == "graymatter.memory.query")
  and (.checks[] | select(.id == "capability-manifest")
    | .details.manifest.subsystems[0].id == "graymatter.receipt")
'

expired_manifest="$TMP_DIR/expired.json"
jq --argjson now "$now_epoch" \
  '.checkedAt = ($now - 120 | strftime("%Y-%m-%dT%H:%M:%SZ"))
   | .expiresAt = ($now - 60 | strftime("%Y-%m-%dT%H:%M:%SZ"))' \
  "$valid_manifest" >"$expired_manifest"
expired_out="$TMP_DIR/expired-evidence.json"
"$SCRIPT" --capability-manifest "$expired_manifest" --signature-history "$valid_history" --out "$expired_out"
assert_jq "$expired_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "capability-manifest") | .details.status == "INVALID_OR_EXPIRED")
'

stale_live_manifest="$TMP_DIR/stale-live.json"
jq --argjson now "$now_epoch" \
  '.capabilities[0].evidenceExpiresAt = ($now - 1 | strftime("%Y-%m-%dT%H:%M:%SZ"))' \
  "$valid_manifest" >"$stale_live_manifest"
stale_live_out="$TMP_DIR/stale-live-evidence.json"
"$SCRIPT" --capability-manifest "$stale_live_manifest" --signature-history "$valid_history" --out "$stale_live_out"
assert_jq "$stale_live_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "capability-manifest") | .details.status == "INVALID_OR_EXPIRED")
'

missing_cloud_manifest="$TMP_DIR/missing-cloud.json"
jq 'del(.distributions.cloud)' "$valid_manifest" >"$missing_cloud_manifest"
missing_cloud_out="$TMP_DIR/missing-cloud-evidence.json"
"$SCRIPT" --capability-manifest "$missing_cloud_manifest" --signature-history "$valid_history" --out "$missing_cloud_out"
assert_jq "$missing_cloud_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "capability-manifest") | .details.status == "INVALID_OR_EXPIRED")
'

for blocked_state in DEGRADED UNAVAILABLE; do
  blocked_manifest="$TMP_DIR/${blocked_state}.json"
  blocked_out="$TMP_DIR/${blocked_state}-evidence.json"
  jq --arg state "$blocked_state" '.capabilities[0].state = $state | .capabilities[0].liveVerified = false' \
    "$valid_manifest" >"$blocked_manifest"
  "$SCRIPT" --capability-manifest "$blocked_manifest" --signature-history "$valid_history" --out "$blocked_out"
  assert_jq "$blocked_out" '
    .decision == "HOLD"
    and (.checks[] | select(.id == "capability-manifest") | .details.status == "BLOCKED")
  '
done

multiple_manifest="$TMP_DIR/multiple.json"
jq -c . "$valid_manifest" >"$multiple_manifest"
jq -c . "$valid_manifest" >>"$multiple_manifest"
multiple_out="$TMP_DIR/multiple-evidence.json"
"$SCRIPT" --capability-manifest "$multiple_manifest" --signature-history "$valid_history" --out "$multiple_out"
assert_jq "$multiple_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "capability-manifest") | .details.status == "INVALID_OR_EXPIRED")
'

nonproduction_manifest="$TMP_DIR/nonproduction.json"
jq '.environment = "staging"' "$valid_manifest" >"$nonproduction_manifest"
nonproduction_out="$TMP_DIR/nonproduction-evidence.json"
"$SCRIPT" --capability-manifest "$nonproduction_manifest" --signature-history "$valid_history" --out "$nonproduction_out"
assert_jq "$nonproduction_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "capability-manifest") | .details.status == "INVALID_OR_EXPIRED")
  and (.checks[] | select(.id == "sustained-signature-canaries")
    | .details.status == "INCOMPLETE" and .details.history.productionManifestBound == false)
'

missing_cell_history="$TMP_DIR/missing-cell-history.json"
jq '.observations |= map(select(
    (.environment == "production" and .capabilityId == "graymatter.semantic.manifest") | not))
  | .observations += [
      (input.observations
        | map(select(.environment == "production" and .capabilityId == "graymatter.semantic.manifest"))
        | .[1:])[]
    ]' "$valid_history" "$valid_history" >"$missing_cell_history"
missing_cell_out="$TMP_DIR/missing-cell-evidence.json"
"$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$missing_cell_history" --out "$missing_cell_out"
assert_jq "$missing_cell_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "sustained-signature-canaries")
    | .details.status == "INCOMPLETE"
      and (.details.history.environments[] | select(.environment == "production") | .completeDays == 6))
'

failed_history="$TMP_DIR/failed-history.json"
jq '.observations[0].passed = false | .observations[0].httpStatus = 503' \
  "$valid_history" >"$failed_history"
failed_history_out="$TMP_DIR/failed-history-evidence.json"
"$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$failed_history" --out "$failed_history_out"
assert_jq "$failed_history_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "sustained-signature-canaries") | .details.status == "INCOMPLETE")
'

drift_history="$TMP_DIR/drift-history.json"
jq '.observations[0].scopeHash = ("f" * 64)' "$valid_history" >"$drift_history"
drift_history_out="$TMP_DIR/drift-history-evidence.json"
"$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$drift_history" --out "$drift_history_out"
assert_jq "$drift_history_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "sustained-signature-canaries")
    | .details.status == "INCOMPLETE"
      and (.details.history.environments[] | select(.environment == "staging") | .scopeHash == null))
'

private_history="$TMP_DIR/private-history.json"
jq '.observations[0].tenantId = "must-not-be-accepted"' "$valid_history" >"$private_history"
private_history_out="$TMP_DIR/private-history-evidence.json"
"$SCRIPT" --capability-manifest "$valid_manifest" --signature-history "$private_history" --out "$private_history_out"
assert_jq "$private_history_out" '
  .decision == "HOLD"
  and (.checks[] | select(.id == "sustained-signature-canaries") | .details.status == "INVALID")
'

plugin_archive="$TMP_DIR/graymatter-plugin.skill"
GRAYMATTER_PLUGIN_PACKAGE_OUT="$plugin_archive" \
  "$ROOT/plugins/graymatter/scripts/package-graymatter" >/dev/null
installed_root="$TMP_DIR/installed"
mkdir -p "$installed_root"
unzip -q "$plugin_archive" -d "$installed_root"
printf '%s\n' "$(git -C "$ROOT" rev-parse HEAD)" >"$installed_root/graymatter/.graymatter-source-rev"
installed_out_one="$TMP_DIR/installed-one.json"
installed_out_two="$TMP_DIR/installed-two.json"
"$installed_root/graymatter/scripts/gm-release-evidence" \
  --capability-manifest "$valid_manifest" --signature-history "$valid_history" --out "$installed_out_one"
"$installed_root/graymatter/scripts/gm-release-evidence" \
  --capability-manifest "$valid_manifest" --signature-history "$valid_history" --out "$installed_out_two"
assert_jq "$installed_out_one" '
  .decision == "ELIGIBLE_FOR_HUMAN_REVIEW"
  and .source.revisionSource == "installed-source-marker"
  and (.checks[] | select(.id == "deterministic-package") | .status == "NOT_APPLICABLE")
  and (.checks[] | select(.id == "marketplace-release-parity") | .status == "NOT_APPLICABLE")
'
jq -S 'del(.generatedAt)' "$installed_out_one" >"$TMP_DIR/installed-one.normalized.json"
jq -S 'del(.generatedAt)' "$installed_out_two" >"$TMP_DIR/installed-two.normalized.json"
cmp -s "$TMP_DIR/installed-one.normalized.json" "$TMP_DIR/installed-two.normalized.json" \
  || fail "installed-shaped evidence is not deterministic after removing generation time"

echo "gm_release_evidence_test: ok"
