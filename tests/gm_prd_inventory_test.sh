#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-prd-inventory"
CANONICAL_PRD="$ROOT/docs/prd-graymatter-omegarag.md"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/gm-prd-inventory-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'gm_prd_inventory_test failed: %s\n' "$*" >&2
  exit 1
}

first="$TMP/first.json"
second="$TMP/second.json"
"$SCRIPT" --out "$first"
"$SCRIPT" --out "$second"
cmp -s "$first" "$second" || fail "inventory generation is not deterministic"
"$SCRIPT" --validate "$first"

jq -e '
  .schemaVersion == "omegarag-prd-inventory/v1"
  and .sourceRef == "docs/prd-graymatter-omegarag.md"
  and .requirementCount == 128
  and .p0P1RequirementCount == 114
  and .priorityCounts == {P0:57,P1:57,P2:14}
  and .familyCounts.CORE == 10
  and .familyCounts.CTX == 12
  and .familyCounts.IDX == 12
  and .familyCounts.SWARM == 10
  and (.requirements | length) == 128
  and ([.requirements[].id] | unique | length) == 128
  and ([.requirements[] | select(.id == "OMR-RET-001" and .priority == "P0")] | length) == 1
  and (.inventoryHash | test("^[0-9a-f]{64}$"))
' "$first" >/dev/null || fail "canonical inventory projection is incorrect"

projection="$($SCRIPT --validate "$first" --format projection)"
jq -e '.requirementCount == 128 and .p0P1RequirementCount == 114' \
  <<<"$projection" >/dev/null || fail "validation projection is incorrect"

duplicate_prd="$TMP/duplicate.md"
cp "$CANONICAL_PRD" "$duplicate_prd"
grep '^| OMR-CORE-001 ' "$CANONICAL_PRD" >>"$duplicate_prd"
if "$SCRIPT" --prd "$duplicate_prd" --out "$TMP/duplicate.json" 2>/dev/null; then
  fail "duplicate requirement ID was accepted"
fi

invalid_row_prd="$TMP/invalid-row.md"
cp "$CANONICAL_PRD" "$invalid_row_prd"
printf '%s\n' '| OMR-TEST-001 | P3 | Invalid priority. | Evidence. |' >>"$invalid_row_prd"
if "$SCRIPT" --prd "$invalid_row_prd" --out "$TMP/invalid-row.json" 2>/dev/null; then
  fail "invalid requirement row was accepted"
fi

drifted_prd="$TMP/drifted.md"
sed 's/Provide one versioned Omega request\/response contract/Provide one revised Omega request\/response contract/' \
  "$CANONICAL_PRD" >"$drifted_prd"
if "$SCRIPT" --prd "$drifted_prd" --validate "$first" 2>/dev/null; then
  fail "PRD drift was accepted"
fi

tampered="$TMP/tampered.json"
jq '.requirementCount = 127' "$first" >"$tampered"
if "$SCRIPT" --validate "$tampered" 2>/dev/null; then
  fail "tampered inventory was accepted"
fi

if "$SCRIPT" --out "$CANONICAL_PRD" 2>/dev/null; then
  fail "PRD overwrite was accepted"
fi

prd_link="$TMP/prd-link.json"
ln -s "$CANONICAL_PRD" "$prd_link"
if "$SCRIPT" --out "$prd_link" 2>/dev/null; then
  fail "symbolic-link PRD overwrite was accepted"
fi

printf 'gm_prd_inventory_test: ok\n'
