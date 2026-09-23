#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-objective-evidence"
POLICY="$ROOT/references/contracts/release/graymatter_omegarag_release_policy_v1.json"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-objective-evidence-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "gm_objective_evidence_test: $*" >&2
  exit 1
}

now_epoch="$(date -u +%s)"
evaluated_at="$(date -u +%FT%TZ)"
window_start="$(date -u +%Y-%m-01T00:00:00Z)"
scope_hash="$(printf 'a%.0s' {1..64})"
tenant_id="private-tenant-must-not-enter-release-evidence"

security="$TMP_DIR/security.json"
jq -n \
  --arg evaluatedAt "$evaluated_at" \
  --arg windowStart "$window_start" \
  --arg scopeHash "$scope_hash" \
  --arg tenantId "$tenant_id" \
  --argjson environments "$(jq -c '.objectiveEvidence.requiredSecurityEnvironments' "$POLICY")" \
  --argjson probes "$(jq -c '.objectiveEvidence.requiredSecurityProbeClasses' "$POLICY")" '
  {
    contractVersion:"omegarag-security-objectives/v1",tenantId:$tenantId,scopeHash:$scopeHash,
    windowStart:$windowStart,windowEnd:$evaluatedAt,evidenceLimit:10000,
    assessments:[$environments[] | {
      environment:.,requiredProbeClasses:$probes,coveredProbeClasses:$probes,
      missingProbeClasses:[],totalProbeCount:12,passedProbeCount:12,
      failedProbeCount:0,invalidEvidenceCount:0,evidenceState:"attested",
      assessmentStatus:"passed",blockingReasons:[]}],
    liveClaimStatus:"passed",releaseEligible:true,evaluatedAt:$evaluatedAt
  }
' >"$security"

availability="$TMP_DIR/availability.json"
jq -n --arg evaluatedAt "$evaluated_at" --arg windowStart "$window_start" \
  --arg scopeHash "$scope_hash" --arg tenantId "$tenant_id" '
  def assessment($objective;$target): {
    objective:$objective,targetAvailability:$target,totalProbeCount:100,
    successfulProbeCount:100,failedProbeCount:0,excludedProviderOutageCount:0,
    invalidEvidenceCount:0,observedAvailability:1,maxObservedGapSeconds:60,
    evidenceState:"measured",assessmentStatus:"passed",blockingReasons:[]};
  {
    contractVersion:"omegarag-availability-objectives/v1",tenantId:$tenantId,scopeHash:$scopeHash,
    windowStart:$windowStart,windowEnd:$evaluatedAt,requiredProbeCount:100,
    maximumProbeGapSeconds:600,synchronousApi:assessment("synchronous_api";0.9995),
    receiptRetrieval:assessment("receipt_retrieval";0.9999),evaluatedAt:$evaluatedAt
  }
' >"$availability"

latency="$TMP_DIR/latency.json"
jq -n \
  --arg evaluatedAt "$evaluated_at" \
  --arg windowStart "$window_start" \
  --arg scopeHash "$scope_hash" \
  --arg tenantId "$tenant_id" \
  --argjson objectives "$(jq -c '.objectiveEvidence.requiredLatencyObjectives' "$POLICY")" '
  {
    contractVersion:"omegarag-latency-objectives/v1",tenantId:$tenantId,scopeHash:$scopeHash,
    windowStart:$windowStart,windowEnd:$evaluatedAt,requiredProbeCount:100,
    maximumProbeGapSeconds:600,evidenceEnvironment:"production",
    assessments:[$objectives[] | {
      objective:.,targetP50LatencyMs:100,targetP95LatencyMs:200,targetP99LatencyMs:300,
      hardBehavior:"bounded",totalProbeCount:100,distinctBenchmarkEvidenceCount:1,
      hardBehaviorFailureCount:0,invalidEvidenceCount:0,observedP50LatencyMs:50,
      observedP95LatencyMs:100,observedP99LatencyMs:150,maxObservedGapSeconds:60,
      evidenceState:"measured",assessmentStatus:"passed",blockingReasons:[]}],
    liveClaimStatus:"passed",releaseEligible:true,evaluatedAt:$evaluatedAt
  }
' >"$latency"

recovery="$TMP_DIR/recovery.json"
jq -n --arg evaluatedAt "$evaluated_at" --arg scopeHash "$scope_hash" \
  --arg tenantId "$tenant_id" '
  {
    contractVersion:"omegarag-recovery-objectives/v1",tenantId:$tenantId,scopeHash:$scopeHash,
    targetRpoSeconds:300,targetRtoSeconds:1800,evidenceState:"attested",
    drillAssessment:"passed",liveClaimStatus:"passed",environment:"production",
    backupOperationId:"11111111-1111-1111-1111-111111111111",
    restoreOperationId:"22222222-2222-2222-2222-222222222222",
    recoveryPointAt:$evaluatedAt,disruptionAt:$evaluatedAt,restoreStartedAt:$evaluatedAt,
    restoreCompletedAt:$evaluatedAt,observedRpoSeconds:120,observedRtoSeconds:900,
    evidenceHash:("b" * 64),attestedAt:$evaluatedAt,blockingReasons:[],evaluatedAt:$evaluatedAt
  }
' >"$recovery"

deletion="$TMP_DIR/deletion.json"
jq -n --arg evaluatedAt "$evaluated_at" --arg windowStart "$window_start" \
  --arg scopeHash "$scope_hash" --arg tenantId "$tenant_id" '
  {
    contractVersion:"omegarag-deletion-slo/v1",tenantId:$tenantId,scopeHash:$scopeHash,
    targetSuccessRate:0.999,currentConfiguredSlaSeconds:300,windowStart:$windowStart,
    windowEnd:$evaluatedAt,eligibleEventCount:1000,measuredEventCount:1000,
    withinSlaEventCount:1000,lateEventCount:0,residualProofFailureCount:0,
    excludedLegalHoldCount:2,observedSuccessRate:1,evidenceState:"measured",
    assessmentStatus:"passed",blockingReasons:[],evaluatedAt:$evaluatedAt
  }
' >"$deletion"

evidence="$TMP_DIR/objectives.json"
projection="$TMP_DIR/projection.json"
"$SCRIPT" --security "$security" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$evidence" \
  --format projection >"$projection"
jq -e '
  .complete == true and .fresh == true and .objectiveCount == 5
  and .securityEnvironmentCount == 3 and .securityProbeClassCount == 12
  and .receiptTrajectoryCoverage == true and (.sourceHashes | length) == 5
' "$projection" >/dev/null || fail "complete objective suite did not pass projection"
"$SCRIPT" --validate "$evidence" --format projection >/dev/null

if grep -Fq "$tenant_id" "$evidence"; then
  fail "objective bundle copied tenant identity"
fi
if grep -Eq '11111111-1111|22222222-2222' "$evidence"; then
  fail "objective bundle copied recovery operation identifiers"
fi

wrong_scope="$TMP_DIR/wrong-scope.json"
jq '.scopeHash = ("f" * 64)' "$security" >"$wrong_scope"
if "$SCRIPT" --security "$wrong_scope" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$TMP_DIR/wrong-scope-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted objective sources from different scopes"
fi

missing_probe="$TMP_DIR/missing-probe.json"
jq '(.assessments[].coveredProbeClasses) -= ["receipt_trajectory_coverage"]' \
  "$security" >"$missing_probe"
if "$SCRIPT" --security "$missing_probe" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$TMP_DIR/missing-probe-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted missing receipt and trajectory coverage"
fi

failed_availability="$TMP_DIR/failed-availability.json"
jq '.synchronousApi.assessmentStatus = "failed" | .synchronousApi.blockingReasons = ["probe_failed"]' \
  "$availability" >"$failed_availability"
if "$SCRIPT" --security "$security" --availability "$failed_availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$TMP_DIR/failed-availability-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted a failed availability objective"
fi

stale_recovery="$TMP_DIR/stale-recovery.json"
jq --argjson now "$now_epoch" '
  .evaluatedAt = ($now - (2 * 86400) | strftime("%Y-%m-%dT%H:%M:%SZ"))
  | .attestedAt = .evaluatedAt
' "$recovery" >"$stale_recovery"
if "$SCRIPT" --security "$security" --availability "$availability" --latency "$latency" \
  --recovery "$stale_recovery" --deletion "$deletion" --out "$TMP_DIR/stale-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted stale recovery evidence"
fi

wrong_window="$TMP_DIR/wrong-window.json"
jq --argjson now "$now_epoch" '
  .windowStart = ($now - (32 * 86400) | strftime("%Y-%m-01T00:00:00Z"))
' "$security" >"$wrong_window"
if "$SCRIPT" --security "$wrong_window" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$TMP_DIR/wrong-window-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted an objective response outside the current UTC month"
fi

private_field="$TMP_DIR/private-field.json"
jq '.tenantName = "must-not-pass"' "$security" >"$private_field"
if "$SCRIPT" --security "$private_field" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$TMP_DIR/private-field-out.json" \
  >/dev/null 2>&1; then
  fail "collector accepted an extra private field"
fi

tampered_bundle="$TMP_DIR/tampered-bundle.json"
jq '.objectives.security.environments[0].coveredProbeClasses -= ["receipt_trajectory_coverage"]' \
  "$evidence" >"$tampered_bundle"
if "$SCRIPT" --validate "$tampered_bundle" >/dev/null 2>&1; then
  fail "validator accepted a release bundle without receipt and trajectory coverage"
fi

concatenated="$TMP_DIR/concatenated.json"
jq -c . "$evidence" >"$concatenated"
jq -c . "$evidence" >>"$concatenated"
if "$SCRIPT" --validate "$concatenated" >/dev/null 2>&1; then
  fail "validator accepted concatenated evidence objects"
fi

if "$SCRIPT" --security "$security" --availability "$availability" --latency "$latency" \
  --recovery "$recovery" --deletion "$deletion" --out "$security" >/dev/null 2>&1; then
  fail "collector overwrote an objective source"
fi

echo "gm_objective_evidence_test: ok"
