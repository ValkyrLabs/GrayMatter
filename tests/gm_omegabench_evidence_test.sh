#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-omegabench-evidence"
POLICY="$ROOT/references/contracts/release/graymatter_omegarag_release_policy_v1.json"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-omegabench-evidence-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'gm_omegabench_evidence_test: %s\n' "$*" >&2
  exit 1
}

[[ -x "$SCRIPT" ]] || fail "OmegaBench evidence collector is missing or not executable"
cmp -s "$SCRIPT" "$ROOT/plugins/graymatter/scripts/gm-omegabench-evidence" \
  || fail "root and marketplace OmegaBench evidence collectors differ"

runtime_revision="$(printf 'f%.0s' {1..40})"
scope_hash="$(printf 'a%.0s' {1..64})"
now_epoch="$(date -u +%s)"
manifest_counter=0
manifest_args=()
first_manifest=""

while IFS= read -r track; do
  track_index="$(jq -r --arg track "$track" '.omegaBench.requiredTracks | index($track)' "$POLICY")"
  corpus_hash="$(printf '%064x' "$((track_index + 100))")"
  while IFS= read -r baseline; do
    manifest_counter=$((manifest_counter + 1))
    evidence_hash="$(printf '%064x' "$manifest_counter")"
    case_hash="$(printf '%064x' "$((manifest_counter + 1000))")"
    manifest_path="$TMP_DIR/manifest-${manifest_counter}.json"
    jq -n \
      --arg track "$track" \
      --arg baseline "$baseline" \
      --arg evidenceHash "$evidence_hash" \
      --arg caseHash "$case_hash" \
      --arg corpusHash "$corpus_hash" \
      --arg scopeHash "$scope_hash" \
      --argjson now "$now_epoch" \
      --argjson policy "$(jq -c '.omegaBench' "$POLICY")" '
        ("case:sha256:" + $caseHash) as $caseRef
        | {
            manifestVersion:$policy.manifestVersion,
            evidenceHash:$evidenceHash,
            state:"REPRODUCIBLE",
            metadataAuthority:$policy.metadataAuthority,
            corpusId:("public-" + ($track | ascii_downcase)),
            corpusVersion:"2026.07",
            corpusLicense:"Apache-2.0",
            declaredCorpusChecksum:$corpusHash,
            computedCorpusChecksum:$corpusHash,
            corpusChecksumVerified:true,
            track:$track,
            baseline:$baseline,
            seed:42,
            hiddenHoldout:false,
            referenceImplementationVersion:null,
            caseCount:1,
            caseRefs:[$caseRef],
            failingCaseRefs:[],
            trackCoverage:[$policy.allTracks[] | {id:.,status:(if . == $track then "MEASURED" else "NOT_MEASURED" end)}],
            baselineCoverage:[$policy.allBaselines[] | {id:.,status:(if . == $baseline then "MEASURED" else "NOT_MEASURED" end)}],
            budgets:[{
              caseRef:$caseRef,
              retrievalMode:"HYBRID",
              topK:10,
              maxLatencyMs:3000,
              maxEstimatedCredits:20,
              evaluatorRequired:true
            }],
            sloObjective:{maxP50LatencyMs:1200,maxP95LatencyMs:3000,maxP99LatencyMs:5000},
            sloAssessment:{
              measured:true,passed:true,maxP50LatencyMs:1200,maxP95LatencyMs:3000,
              maxP99LatencyMs:5000,violations:[]
            },
            totalEstimatedCredits:10,
            passRateConfidenceInterval:{measured:true,lowerBound:0.2,upperBound:1},
            environment:{
              environment:"production",runtimeVersion:"runtime-2026.07",javaVersion:"21",
              javaVm:"OpenJDK",osName:"Linux",osArch:"amd64",availableProcessors:8,maxHeapMiB:4096
            },
            runtimeEvidence:{
              schemaVersion:"schema-v1",policyVersion:"policy-v1",indexManifestVersion:"index-manifest-v1",
              indexVersion:"index-v1",scopeHash:$scopeHash,
              observedAt:($now - 30 | strftime("%Y-%m-%dT%H:%M:%SZ")),healthStatus:"ready",
              activeProviders:["postgres-fts-v1","pgvector-v1"],
              activeModels:(if $baseline | IN("VECTOR_ONLY","FIXED_HYBRID","CURRENT_PLANNER")
                then ["embedding-v1"] else [] end),
              activeDimensions:(if $baseline | IN("VECTOR_ONLY","FIXED_HYBRID","CURRENT_PLANNER")
                then [1536] else [] end),
              activeChunkerVersions:["chunker-v1"],plannerVersion:"planner-v1",graphPolicyVersion:"graph-v1"
            },
            observedProviderIds:["postgres-fts-v1"],
            missingEvidence:[],
            releaseGateFailures:[],
            publicReleaseEligible:true
          }
      ' >"$manifest_path"
    if [[ -z "$first_manifest" ]]; then
      first_manifest="$manifest_path"
    fi
    manifest_args+=(--manifest "$manifest_path")
  done < <(jq -r '.omegaBench.requiredBaselines[]' "$POLICY")
done < <(jq -r '.omegaBench.requiredTracks[]' "$POLICY")
[[ "$manifest_counter" -eq 30 ]] || fail "expected 30 policy matrix manifests, found $manifest_counter"

complete_evidence="$TMP_DIR/complete.json"
projection="$TMP_DIR/projection.json"
"$SCRIPT" "${manifest_args[@]}" --runtime-revision "$runtime_revision" \
  --out "$complete_evidence" --format projection >"$projection"
jq -e '
  .complete == true
  and .fresh == true
  and .manifestCount == 30
  and .totalCaseCount == 30
  and .scopeHash == ("a" * 64)
  and ([.coverage[] | select(.present == false)] | length == 0)
  and ([.corpusComparability[] | select(.comparable == false)] | length == 0)
' "$projection" >/dev/null || fail "complete matrix did not satisfy the release projection"
"$SCRIPT" --validate "$complete_evidence" --format projection >/dev/null

full_report="$TMP_DIR/full-report.json"
jq '{reproducibilityManifest:.,privateResults:{query:"must-not-enter-evidence"}}' \
  "$first_manifest" >"$full_report"
single_evidence="$TMP_DIR/single.json"
"$SCRIPT" --manifest "$full_report" --runtime-revision "$runtime_revision" --out "$single_evidence"
if grep -Fq 'must-not-enter-evidence' "$single_evidence"; then
  fail "collector copied private benchmark result content"
fi

"$SCRIPT" --manifest "$first_manifest" --evidence "$complete_evidence" \
  --runtime-revision "$runtime_revision" --out "$complete_evidence"
jq -e '.entries | length == 30' "$complete_evidence" >/dev/null \
  || fail "re-collecting an evidence hash was not idempotent"

original_evidence_hash="$(jq -r '.evidenceHash' "$first_manifest")"
refreshed_manifest="$TMP_DIR/refreshed-manifest.json"
jq '.evidenceHash = ("c" * 64)' "$first_manifest" >"$refreshed_manifest"
"$SCRIPT" --manifest "$refreshed_manifest" --evidence "$complete_evidence" \
  --runtime-revision "$runtime_revision" --out "$complete_evidence"
jq -e --arg original "$original_evidence_hash" '
  (.entries | length) == 30
  and ([.entries[] | select(.manifest.evidenceHash == ("c" * 64))] | length) == 1
  and ([.entries[] | select(.manifest.evidenceHash == $original)] | length) == 0
' "$complete_evidence" >/dev/null \
  || fail "a refreshed matrix cell did not replace its predecessor"

conflicting_manifest="$TMP_DIR/conflicting-manifest.json"
jq '.evidenceHash = ("d" * 64)' "$first_manifest" >"$conflicting_manifest"
if "$SCRIPT" --manifest "$first_manifest" --manifest "$conflicting_manifest" \
  --runtime-revision "$runtime_revision" --out "$TMP_DIR/conflicting-evidence.json" \
  >/dev/null 2>&1; then
  fail "collector accepted conflicting manifests for one matrix cell"
fi

incomplete_evidence="$TMP_DIR/incomplete.json"
jq 'del(.entries[-1])' "$complete_evidence" >"$incomplete_evidence"
incomplete_projection="$TMP_DIR/incomplete-projection.json"
"$SCRIPT" --validate "$incomplete_evidence" --format projection >"$incomplete_projection"
jq -e '.complete == false and ([.coverage[] | select(.present == false)] | length == 1)' \
  "$incomplete_projection" >/dev/null || fail "missing baseline was not reported as incomplete"

private_manifest="$TMP_DIR/private-manifest.json"
jq '.tenantId = "must-not-be-accepted"' "$first_manifest" >"$private_manifest"
if "$SCRIPT" --manifest "$private_manifest" --runtime-revision "$runtime_revision" \
  --out "$TMP_DIR/private-evidence.json" >/dev/null 2>&1; then
  fail "collector accepted a private extra manifest field"
fi

failed_manifest="$TMP_DIR/failed-manifest.json"
jq '.publicReleaseEligible = false | .releaseGateFailures = ["isolation_leakage"]' \
  "$first_manifest" >"$failed_manifest"
if "$SCRIPT" --manifest "$failed_manifest" --runtime-revision "$runtime_revision" \
  --out "$TMP_DIR/failed-evidence.json" >/dev/null 2>&1; then
  fail "collector accepted a release-blocked manifest"
fi

drifted_evidence="$TMP_DIR/drifted.json"
jq '.entries[0].manifest.runtimeEvidence.scopeHash = ("b" * 64)' \
  "$complete_evidence" >"$drifted_evidence"
drifted_projection="$TMP_DIR/drifted-projection.json"
"$SCRIPT" --validate "$drifted_evidence" --format projection >"$drifted_projection"
jq -e '.complete == false and .scopeHash == null' "$drifted_projection" >/dev/null \
  || fail "scope drift did not fail matrix coherence"

stale_evidence="$TMP_DIR/stale.json"
jq --argjson now "$now_epoch" '
  .entries[].manifest.runtimeEvidence.observedAt =
    ($now - (8 * 86400) | strftime("%Y-%m-%dT%H:%M:%SZ"))
' "$complete_evidence" >"$stale_evidence"
stale_projection="$TMP_DIR/stale-projection.json"
"$SCRIPT" --validate "$stale_evidence" --format projection >"$stale_projection"
jq -e '.complete == false and .fresh == false' "$stale_projection" >/dev/null \
  || fail "stale server-observed benchmark evidence remained complete"

mixed_age_evidence="$TMP_DIR/mixed-age.json"
jq --argjson now "$now_epoch" '
  .entries[0].manifest.runtimeEvidence.observedAt =
    ($now - (8 * 86400) | strftime("%Y-%m-%dT%H:%M:%SZ"))
' "$complete_evidence" >"$mixed_age_evidence"
mixed_age_projection="$TMP_DIR/mixed-age-projection.json"
"$SCRIPT" --validate "$mixed_age_evidence" --format projection >"$mixed_age_projection"
jq -e '.complete == false and .fresh == false and .earliestObservedAt < .latestObservedAt' \
  "$mixed_age_projection" >/dev/null \
  || fail "one stale matrix cell was hidden by fresher evidence"

concatenated="$TMP_DIR/concatenated.json"
jq -c . "$complete_evidence" >"$concatenated"
jq -c . "$complete_evidence" >>"$concatenated"
if "$SCRIPT" --validate "$concatenated" >/dev/null 2>&1; then
  fail "validator accepted concatenated evidence objects"
fi

if "$SCRIPT" --manifest "$first_manifest" --runtime-revision "$runtime_revision" \
  --out "$first_manifest" >/dev/null 2>&1; then
  fail "collector overwrote a manifest input"
fi

if "$SCRIPT" --manifest "$first_manifest" --evidence "$complete_evidence" \
  --runtime-revision "$(printf 'e%.0s' {1..40})" --out "$TMP_DIR/revision-mismatch.json" >/dev/null 2>&1; then
  fail "collector merged evidence from different runtime revisions"
fi

echo "gm_omegabench_evidence_test: ok"
