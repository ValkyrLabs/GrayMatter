#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-signature-history"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-signature-history-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'gm_signature_history_test: %s\n' "$*" >&2
  exit 1
}

[[ -x "$SCRIPT" ]] || fail "collector is missing or not executable"
cmp -s "$SCRIPT" "$ROOT/plugins/graymatter/scripts/gm-signature-history" \
  || fail "root and marketplace collectors differ"

now_epoch="$(date -u +%s)"
make_report() {
  local environment="$1"
  local scope_hash="$2"
  local authority_hash="$3"
  local output="$4"
  jq -n \
    --arg environment "$environment" \
    --arg scopeHash "$scope_hash" \
    --arg authorityHash "$authority_hash" \
    --argjson now "$now_epoch" '
      def capabilities: [
        "graymatter.receipt.create",
        "graymatter.context.create",
        "graymatter.graph.shape",
        "graymatter.semantic.manifest"
      ];
      ("signature-canary/" + $environment + "/run-1") as $runRef
      | {
          reportVersion:"omegarag-signature-canary/v1",
          environment:$environment,
          startedAt:($now - 40 | strftime("%Y-%m-%dT%H:%M:%SZ")),
          finishedAt:($now - 30 | strftime("%Y-%m-%dT%H:%M:%SZ")),
          runRef:$runRef,
          queryDigest:("sha256:" + ("e" * 64)),
          publishRequested:true,
          published:true,
          verification:"PASSED",
          scopeHash:$scopeHash,
          authorityHash:$authorityHash,
          probes:[
            capabilities[] as $capabilityId
            | {
                capabilityId:$capabilityId,
                passed:true,
                httpStatus:200,
                contractVersion:"omegarag-signature-canary/v1",
                reason:"contract_passed",
                evidenceRef:($runRef + "/" + $capabilityId)
              }
          ]
        }
    ' >"$output"
}

staging_report="$TMP_DIR/staging.json"
production_report="$TMP_DIR/production.json"
make_report staging "$(printf 'c%.0s' {1..64})" "$(printf 'd%.0s' {1..64})" "$staging_report"
make_report production "$(printf 'a%.0s' {1..64})" "$(printf 'b%.0s' {1..64})" "$production_report"

history="$TMP_DIR/history.json"
"$SCRIPT" --report "$staging_report" --report "$production_report" --out "$history"
jq -e '
  .schemaVersion == "omegarag-signature-history/v1"
  and (.observations | length == 8)
  and ([.observations[].environment] | unique == ["production","staging"])
  and (all(.observations[];
    (.evidenceHash | test("^[0-9a-f]{64}$"))
    and (.evidenceRef | startswith("signature-canary/"))
    and ((keys - ["authorityHash","capabilityId","contractVersion","environment","evidenceHash","evidenceRef","httpStatus","observedAt","passed","scopeHash"]) | length == 0)))
' "$history" >/dev/null || fail "valid reports did not produce bounded history"

"$SCRIPT" --history "$history" --report "$staging_report" --out "$history"
jq -e '.observations | length == 8' "$history" >/dev/null \
  || fail "re-collecting one report was not idempotent"

private_report="$TMP_DIR/private-report.json"
jq '.tenantId = "must-not-enter-history"' "$staging_report" >"$private_report"
if "$SCRIPT" --report "$private_report" --out "$TMP_DIR/private-history.json" >/dev/null 2>&1; then
  fail "collector accepted a report with a private extra field"
fi

unpublished_report="$TMP_DIR/unpublished-report.json"
jq '.published = false | .verification = "NOT_REQUESTED"' "$staging_report" >"$unpublished_report"
if "$SCRIPT" --report "$unpublished_report" --out "$TMP_DIR/unpublished-history.json" >/dev/null 2>&1; then
  fail "collector accepted an unpublished report"
fi

relabelled_report="$TMP_DIR/relabelled-report.json"
jq '.environment = "production"' "$staging_report" >"$relabelled_report"
if "$SCRIPT" --report "$relabelled_report" --out "$TMP_DIR/relabelled-history.json" >/dev/null 2>&1; then
  fail "collector accepted a report whose run reference did not match its environment"
fi

if "$SCRIPT" --report "$staging_report" --out "$staging_report" >/dev/null 2>&1; then
  fail "collector overwrote a source report"
fi

echo "gm_signature_history_test: ok"
