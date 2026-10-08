#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-replay-deferred"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
mkdir -p "$tmp/deferred"
export GRAYMATTER_DEFERRED_DIR="$tmp/deferred" GRAYMATTER_FALLBACK_SPOOL="$tmp/fallback.json"
export GRAYMATTER_REPLAY_LOCK_DIR="$tmp/lock" GRAYMATTER_CREDIT_EVENTS_PATH="$tmp/events.jsonl"
export VALKYR_API_BASE='https://authorized.test/v1' TEST_REPLAY_LOG="$tmp/calls"
export GRAYMATTER_SKIP_REPLAY_PREFLIGHT=true # Former bypass must not skip source binding.
export TEST_ACTOR='actor-1' TEST_ORG='org-1' TEST_REGISTRY='registry-1' TEST_READY=true TEST_AUTH=true
export GRAYMATTER_API_SCRIPT="$tmp/api"
cat > "$GRAYMATTER_API_SCRIPT" <<'API'
#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\n' "$1" "$2" >> "$TEST_REPLAY_LOG"
if [[ "$1 $2" == 'GET auth/me' ]]; then
  jq -nc --arg id "$TEST_ACTOR" --arg org "$TEST_ORG" --argjson auth "$TEST_AUTH" \
    '{authenticated:$auth,authenticatedPrincipalObject:{principalId:$id,organizationId:$org}}'
elif [[ "$1" == GET && "$2" == tenant-schemas/preflight/* ]]; then
  jq -nc --arg org "$TEST_ORG" --arg registry "$TEST_REGISTRY" --argjson ready "$TEST_READY" \
    '{ready:$ready,tenantSchemaContext:"ready",organizationId:$org,schemaName:"org_1",tenantSchemaRegistryId:$registry}'
else
  [[ "${TEST_WRITE_FAIL:-false}" == false ]] || exit 1
  printf '{"id":"memory-1"}\n'
fi
API
chmod +x "$GRAYMATTER_API_SCRIPT"
new_record() {
  printf '{"items":[],"status":"synced"}\n' > "$GRAYMATTER_FALLBACK_SPOOL"
  local authority body='{"type":"context","text":"PRIVATE CANARY"}'
  authority="$("$ROOT/scripts/gm-source-authority")"
  jq -nc --argjson authority "$authority" --arg body "$body" --arg base "$VALKYR_API_BASE" \
    --arg sha "$(printf '%s' "$body" | shasum -a 256 | awk '{print $1}')" \
    '{id:"op-1",method:"POST",path:"/MemoryEntry/write",apiBase:$base,body:$body,bodySha256:$sha,sourceAuthority:$authority}' \
    > "$tmp/deferred/op.json"
  : > "$TEST_REPLAY_LOG"
}
expect_denied() {
  local status=0
  "$SCRIPT" > "$tmp/out" 2> "$tmp/err" || status=$?
  [[ "$status" == 64 ]] || fail "expected authority denial, received $status: $(cat "$tmp/err")"
  [[ -f "$tmp/deferred/op.json" ]] || fail 'denied record was removed'
  if rg -q '^POST ' "$TEST_REPLAY_LOG"; then fail 'denied replay sent a body'; fi
  if rg -q 'PRIVATE CANARY' "$tmp/out" "$tmp/err"; then fail 'denial disclosed body'; fi
}
new_record
"$SCRIPT" > "$tmp/out"
[[ ! -f "$tmp/deferred/op.json" ]] || fail 'authorized record was not drained'
rg -q '^POST /MemoryEntry/write$' "$TEST_REPLAY_LOG" || fail 'same authority replay did not write'
jq -e 'select(.event=="replay_succeeded")' "$GRAYMATTER_CREDIT_EVENTS_PATH" >/dev/null
# A ready schema cannot establish an incomplete source/destination identity.
for binding_key in TEST_ORG TEST_REGISTRY; do
  original_binding="${!binding_key}"
  export "$binding_key="
  : > "$TEST_REPLAY_LOG"
  status=0
  "$ROOT/scripts/gm-source-authority" > "$tmp/authority.out" 2> "$tmp/authority.err" || status=$?
  [[ "$status" == 64 ]] || fail "incomplete $binding_key source identity was accepted"
  [[ ! -s "$tmp/authority.out" ]] || fail 'incomplete source identity was released'
  if rg -q '^POST ' "$TEST_REPLAY_LOG"; then fail 'authority probe sent a write'; fi
  export "$binding_key=$original_binding"
done
new_record; export TEST_ORG='org-2'; expect_denied; export TEST_ORG='org-1'
new_record; export TEST_ACTOR='actor-2'; expect_denied; export TEST_ACTOR='actor-1'
new_record; export VALKYR_API_BASE='https://other.test/v1'; expect_denied; export VALKYR_API_BASE='https://authorized.test/v1'
new_record; export TEST_READY=false; expect_denied; export TEST_READY=true
new_record; export TEST_AUTH=false; expect_denied; export TEST_AUTH=true
new_record; jq 'del(.sourceAuthority)' "$tmp/deferred/op.json" > "$tmp/edit"; mv "$tmp/edit" "$tmp/deferred/op.json"; expect_denied
new_record; jq '.body="tampered private content"' "$tmp/deferred/op.json" > "$tmp/edit"; mv "$tmp/edit" "$tmp/deferred/op.json"; expect_denied
new_record; export TEST_WRITE_FAIL=true
status=0; "$SCRIPT" > "$tmp/out" 2> "$tmp/err" || status=$?
[[ "$status" == 1 && -f "$tmp/deferred/op.json" ]] || fail 'failed destination write did not preserve queue'
export TEST_WRITE_FAIL=false
rm "$tmp/deferred/op.json"
printf '{"items":[{"type":"context","text":"legacy private","owner":"old-workspace"}],"status":"pending_replay"}\n' > "$GRAYMATTER_FALLBACK_SPOOL"
: > "$TEST_REPLAY_LOG"
status=0; "$SCRIPT" > "$tmp/out" 2> "$tmp/err" || status=$?
[[ "$status" == 64 ]] || fail 'legacy unbound fallback was adopted by current identity'
jq -e '.items|length==1' "$GRAYMATTER_FALLBACK_SPOOL" >/dev/null
if rg -q '^POST ' "$TEST_REPLAY_LOG"; then fail 'legacy private body was exported'; fi
echo 'gm_replay_deferred_test.sh: PASS (12 source/destination cases)'
