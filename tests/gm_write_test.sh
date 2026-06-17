#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$ROOT_DIR/scripts/gm-write" "$TMP_DIR/gm-write"
chmod +x "$TMP_DIR/gm-write"

cat > "$TMP_DIR/gm-fallback-append" <<'EOF'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$SCRIPT_DIR/gm-fallback-calls"
EOF
chmod +x "$TMP_DIR/gm-fallback-append"

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
case "${TEST_GRAYMATTER_API_SCENARIO:-payload-too-large}" in
  access-denied)
    cat >&2 <<'DENIED'
GrayMatter access denied for POST /MemoryEntry/write.
Missing permission: MemoryEntry write authority or memory:write scope.
Trace id: trace-rbac
Run scripts/gm-replay-deferred after permissions are fixed.
DENIED
    exit 22
    ;;
  payload-too-large)
    echo "HTTP 413 Payload Too Large" >&2
    exit 1
    ;;
  *)
    echo "unknown TEST_GRAYMATTER_API_SCENARIO" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

OUTPUT="$($TMP_DIR/gm-write todo "$(printf 'x%.0s' {1..1200})" test 2>&1 || true)"

grep -q "gm-write rejected payload length" <<<"$OUTPUT"
grep -q "gm-write failed (type=todo, sourceChannel=test" <<<"$OUTPUT"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:read_only
graymatter_token_state=ok
memory_layer=degraded
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF
chmod +x "$TMP_DIR/gm-status"

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
READ_ONLY_OUTPUT="$($TMP_DIR/gm-write context "signal sweep payload" signal-harvester signal,github 2>&1)"
READ_ONLY_STATUS=$?
set -e

test "$READ_ONLY_STATUS" -eq 23
grep -q "read-only GrayMatter auth" <<<"$READ_ONLY_OUTPUT"
grep -q "queued fallback payload" <<<"$READ_ONLY_OUTPUT"
grep -q "gm-write preflight blocked read-only auth" "$TMP_DIR/gm-fallback-calls"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
memory_layer=degraded
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
DEGRADED_OUTPUT="$($TMP_DIR/gm-write artifact "operator payload" signal-harvester signal 2>&1)"
DEGRADED_STATUS=$?
set -e

test "$DEGRADED_STATUS" -eq 24
grep -q "memory_layer=degraded" <<<"$DEGRADED_OUTPUT"
grep -q "gm-write preflight blocked memory_layer=degraded" "$TMP_DIR/gm-fallback-calls"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
tenant_schema_context=unknown
memory_layer=ready
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
TENANT_CONTEXT_OUTPUT="$($TMP_DIR/gm-write context "schema context payload" signal-harvester signal 2>&1)"
TENANT_CONTEXT_STATUS=$?
set -e

test "$TENANT_CONTEXT_STATUS" -eq 25
grep -q "tenant_schema_context=unknown" <<<"$TENANT_CONTEXT_OUTPUT"
grep -q "gm-write preflight blocked tenant_schema_context=unknown" "$TMP_DIR/gm-fallback-calls"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
tenant_schema_context=ready
memory_layer=ready
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
ACCESS_DENIED_OUTPUT="$(TEST_GRAYMATTER_API_SCENARIO=access-denied "$TMP_DIR/gm-write" context "job-search handoff" codex handoff 2>&1)"
ACCESS_DENIED_STATUS=$?
set -e

test "$ACCESS_DENIED_STATUS" -eq 22
grep -q "GrayMatter access denied for POST /MemoryEntry/write" <<<"$ACCESS_DENIED_OUTPUT"
grep -q "Missing permission: MemoryEntry write authority or memory:write scope" <<<"$ACCESS_DENIED_OUTPUT"
grep -q "Trace id: trace-rbac" <<<"$ACCESS_DENIED_OUTPUT"
grep -q "queued fallback payload" <<<"$ACCESS_DENIED_OUTPUT"
grep -q "gm-write API failure" "$TMP_DIR/gm-fallback-calls"

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s' "$3" > "$SCRIPT_DIR/gm-write-payload.json"
echo '{"id":"memory-entry-1","status":"created"}'
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

TAGGED_OUTPUT="$($TMP_DIR/gm-write decision "tag shape payload" signal-harvester "Signal, GitHub,signal")"
grep -q "memory-entry-1" <<<"$TAGGED_OUTPUT"
jq -e '.tags == ["github","signal"]' "$TMP_DIR/gm-write-payload.json" >/dev/null
jq -e '.tags[] | strings' "$TMP_DIR/gm-write-payload.json" >/dev/null

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNT_FILE="$SCRIPT_DIR/gm-write-api-count"
COUNT=0
if [[ -f "$COUNT_FILE" ]]; then
  COUNT="$(cat "$COUNT_FILE")"
fi
COUNT=$((COUNT + 1))
printf '%s' "$COUNT" > "$COUNT_FILE"
echo '{"error":"tag relation persistence failed"}' >&2
exit 22
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

rm -f "$TMP_DIR/gm-fallback-calls" "$TMP_DIR/gm-write-api-count"
set +e
TAG_RETRY_OUTPUT="$($TMP_DIR/gm-write decision "tag retry payload" signal-harvester signal,github 2>&1)"
TAG_RETRY_STATUS=$?
set -e

test "$TAG_RETRY_STATUS" -eq 22
test "$(cat "$TMP_DIR/gm-write-api-count")" -eq 1
if grep -q "Tagged write failed, retrying without tags" <<<"$TAG_RETRY_OUTPUT"; then
  echo "gm-write must not silently drop tags after a tagged write failure" >&2
  exit 1
fi
grep -q "gm-write failed (type=decision, sourceChannel=signal-harvester" <<<"$TAG_RETRY_OUTPUT"
grep -q "Write failed, queued fallback payload" <<<"$TAG_RETRY_OUTPUT"
grep -q "gm-write API failure" "$TMP_DIR/gm-fallback-calls"

echo "gm_write_test: PASS"
