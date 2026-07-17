#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-omegabench-corpus"
PLUGIN_SCRIPT="$ROOT/plugins/graymatter/scripts/gm-omegabench-corpus"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-omegabench-corpus-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'gm_omegabench_corpus_test: %s\n' "$*" >&2
  exit 1
}

[[ -x "$SCRIPT" ]] || fail "corpus package tool is missing or not executable"
[[ -x "$PLUGIN_SCRIPT" ]] || fail "marketplace corpus package tool is missing or not executable"
cmp -s "$SCRIPT" "$PLUGIN_SCRIPT" || fail "root and marketplace corpus package tools differ"

source_file="$TMP_DIR/source.jsonl"
license_file="$TMP_DIR/LICENSE"
package_file="$TMP_DIR/package.json"
printf '%s\n' 'public-fixture-without-tenant-data' >"$source_file"
printf '%s\n' 'Apache License 2.0 fixture' >"$license_file"
case_checksum="$(printf 'a%.0s' {1..64})"

common_args=(
  --corpus-id omega-public-smoke
  --corpus-version 2026.07.17
  --corpus-license Apache-2.0
  --source "$source_file"
  --source-uri https://benchmarks.valkyrlabs.com/omega/2026.07.17/source.jsonl
  --source-revision refs/tags/2026.07.17
  --license "$license_file"
  --license-uri https://www.apache.org/licenses/LICENSE-2.0.txt
  --case-count 1
  --case-set-checksum "$case_checksum"
  --confirm-public-only
  --confirm-no-tenant-data
)

"$SCRIPT" "${common_args[@]}" --out "$package_file"
"$SCRIPT" --validate "$package_file"
"$SCRIPT" --validate "$package_file" --source "$source_file" --license "$license_file"

jq -e --arg sourceHash "$(shasum -a 256 "$source_file" | awk '{print $1}')" \
  --arg licenseHash "$(shasum -a 256 "$license_file" | awk '{print $1}')" \
  --arg checksum "$case_checksum" '
    .schemaVersion == "omegabench-corpus-package/v1"
    and .sourceSha256 == $sourceHash
    and .licenseSha256 == $licenseHash
    and .caseSetChecksum == $checksum
    and .privacyClassification == "PUBLIC"
    and .tenantDataExcluded == true
    and ((keys | length) == 14)
  ' "$package_file" >/dev/null || fail "generated package does not contain the bounded provenance contract"
if grep -q 'public-fixture-without-tenant-data' "$package_file"; then
  fail "generated package copied source content"
fi

tampered_hash="$TMP_DIR/tampered-hash.json"
jq '.packageEvidenceSha256 = ("f" * 64)' "$package_file" >"$tampered_hash"
if "$SCRIPT" --validate "$tampered_hash" >/dev/null 2>&1; then
  fail "validator accepted a tampered package evidence hash"
fi

floating_revision="$TMP_DIR/floating-revision.json"
jq '.sourceRevision = "refs/heads/main"' "$package_file" >"$floating_revision"
if "$SCRIPT" --validate "$floating_revision" >/dev/null 2>&1; then
  fail "validator accepted a floating source revision"
fi

extra_field="$TMP_DIR/extra-field.json"
jq '.tenantId = "must-never-appear"' "$package_file" >"$extra_field"
if "$SCRIPT" --validate "$extra_field" >/dev/null 2>&1; then
  fail "validator accepted a private or non-contract field"
fi

concatenated="$TMP_DIR/concatenated.json"
package_json="$(<"$package_file")"
printf '%s\n%s\n' "$package_json" "$package_json" >"$concatenated"
if "$SCRIPT" --validate "$concatenated" >/dev/null 2>&1; then
  fail "validator accepted concatenated JSON objects"
fi

printf '%s\n' 'tampered source bytes' >"$source_file"
if "$SCRIPT" --validate "$package_file" --source "$source_file" --license "$license_file" >/dev/null 2>&1; then
  fail "validator accepted source bytes that do not match the package"
fi
printf '%s\n' 'public-fixture-without-tenant-data' >"$source_file"

if "$SCRIPT" "${common_args[@]:0:${#common_args[@]}-1}" --out "$TMP_DIR/missing-confirmation.json" \
  >/dev/null 2>&1; then
  fail "generator accepted a package without the no-tenant-data confirmation"
fi

http_args=("${common_args[@]}")
for index in "${!http_args[@]}"; do
  if [[ "${http_args[$index]}" == "https://benchmarks.valkyrlabs.com/omega/2026.07.17/source.jsonl" ]]; then
    http_args[$index]="http://benchmarks.valkyrlabs.com/omega/2026.07.17/source.jsonl"
  fi
done
if "$SCRIPT" "${http_args[@]}" --out "$TMP_DIR/http-source.json" >/dev/null 2>&1; then
  fail "generator accepted a non-HTTPS source URI"
fi

query_uri="$TMP_DIR/query-uri.json"
jq '.sourceUri += "?token=must-not-enter-evidence"' "$package_file" >"$query_uri"
if "$SCRIPT" --validate "$query_uri" >/dev/null 2>&1; then
  fail "validator accepted a source URI with query parameters"
fi

if "$SCRIPT" "${common_args[@]}" --out "$source_file" >/dev/null 2>&1; then
  fail "generator accepted an output path that overwrites the source artifact"
fi
if "$SCRIPT" "${common_args[@]}" --out "$license_file" >/dev/null 2>&1; then
  fail "generator accepted an output path that overwrites the license artifact"
fi

printf 'gm_omegabench_corpus_test: ok\n'
