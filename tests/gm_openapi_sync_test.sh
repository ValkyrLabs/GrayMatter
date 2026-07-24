#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SRC="$ROOT/scripts/gm-openapi-sync"
LIB_SRC="$ROOT/scripts/gm-schema-cache-lib"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/scripts" "$tmp/cache"
cp "$SYNC_SRC" "$tmp/scripts/gm-openapi-sync"
cp "$LIB_SRC" "$tmp/scripts/gm-schema-cache-lib"
chmod +x "$tmp/scripts/gm-openapi-sync" "$tmp/scripts/gm-schema-cache-lib"

cat >"$tmp/scripts/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$TEST_GRAYMATTER_API_LOG"
if [[ "${TEST_OPENAPI_MODE:-200}" == "outage" ]]; then
  exit 7
fi
if [[ "${TEST_OPENAPI_MODE:-200}" == "invalid" ]]; then
  printf '{"not":"openapi"}\n'
  printf '200\n' >"$GRAYMATTER_API_RESPONSE_STATUS"
  printf 'HTTP/1.1 200 OK\n' >"$GRAYMATTER_API_RESPONSE_HEADERS"
  exit 0
fi
if [[ -n "${TEST_OPENAPI_SLEEP:-}" ]]; then
  sleep "$TEST_OPENAPI_SLEEP"
fi
if [[ "${GRAYMATTER_OPENAPI_IF_NONE_MATCH:-}" == '"v1"' && "${TEST_OPENAPI_MODE:-200}" == "304" ]]; then
  : >"$GRAYMATTER_API_RESPONSE_HEADERS"
  printf '304\n' >"$GRAYMATTER_API_RESPONSE_STATUS"
  exit 0
fi
printf '{"openapi":"3.0.1","info":{"version":"1.2.3"},"paths":{"/MemoryEntry":{},"/SwarmOps/graph":{}}}\n'
printf 'HTTP/1.1 200 OK\nETag: "v1"\nX-Schema-Revision: rev-1\nX-Server-Revision: build-7\n' >"$GRAYMATTER_API_RESPONSE_HEADERS"
printf '200\n' >"$GRAYMATTER_API_RESPONSE_STATUS"
EOF
chmod +x "$tmp/scripts/graymatter_api.sh"
export TEST_GRAYMATTER_API_LOG="$tmp/api.log"
export VALKYR_AUTH_TOKEN="header.payload.signature"
export VALKYR_API_BASE="http://127.0.0.1:9/v1"
out="$tmp/cache/api-docs.json"

set +e
TEST_OPENAPI_MODE=outage "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null 2>"$tmp/first.err"
first_status=$?
set -e
[[ "$first_status" -ne 0 ]] || fail "first launch without a cache should report api-0 outage"
[[ ! -e "$out" ]] || fail "first launch outage should not create a schema cache"

TEST_OPENAPI_MODE=200 "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null
[[ -s "$out" ]] || fail "successful OpenAPI fetch should write the document"
meta="$out.meta.json"
[[ "$(stat -f '%Lp' "$out" 2>/dev/null || stat -c '%a' "$out")" == "600" ]] || fail "OpenAPI cache must be private"
[[ "$(stat -f '%Lp' "$meta" 2>/dev/null || stat -c '%a' "$meta")" == "600" ]] || fail "OpenAPI metadata must be private"
jq -e '.etag == "\"v1\"" and .schemaRevision == "rev-1" and .serverBuildRevision == "build-7" and .specVersion == "3.0.1" and (.documentSha256 | length == 64)' "$meta" >/dev/null || fail "OpenAPI metadata must record revision, ETag, spec version, and SHA-256"
old_sha="$(shasum -a 256 "$out" | awk '{print $1}')"

: >"$tmp/api.log"
TEST_OPENAPI_MODE=304 "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null
grep -q 'GET /api-docs' "$tmp/api.log" || fail "304 path must still perform an online conditional check"
jq -e '.lastOutcome == "304" and .schemaSource == "live"' "$meta" >/dev/null || fail "304 path must refresh live-check metadata"
[[ "$(shasum -a 256 "$out" | awk '{print $1}')" == "$old_sha" ]] || fail "304 must preserve the cached document"

: >"$tmp/api.log"
set +e
TEST_OPENAPI_MODE=invalid "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null 2>"$tmp/invalid.err"
invalid_status=$?
set -e
[[ "$invalid_status" -ne 0 ]] || fail "invalid OpenAPI response must fail"
[[ "$(shasum -a 256 "$out" | awk '{print $1}')" == "$old_sha" ]] || fail "invalid response must preserve the last valid document"

set +e
TEST_OPENAPI_MODE=outage "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null 2>"$tmp/outage.err"
outage_status=$?
set -e
[[ "$outage_status" -ne 0 ]] || fail "outage with a valid cache should be surfaced"
[[ -s "$out" ]] || fail "outage must preserve a valid stale cache"
cp "$ROOT/scripts/gm-status" "$tmp/scripts/gm-status"
chmod +x "$tmp/scripts/gm-status"
stale_status="$(ROOT_DIR="$tmp" OPENAPI_PATH="$out" VALKYR_API_BASE="http://127.0.0.1:9/v1" VALKYR_AUTH_TOKEN="$VALKYR_AUTH_TOKEN" "$tmp/scripts/gm-status")"
grep -q '^schema_cache=stale$' <<<"$stale_status" || fail "api-0 outage must report a valid preserved cache as stale"
grep -q '^schema_source=cached$' <<<"$stale_status" || fail "api-0 outage must report cached schema source"

TEST_OPENAPI_MODE=200 TEST_OPENAPI_SLEEP=1 "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null &
first_pid=$!
TEST_OPENAPI_MODE=200 TEST_OPENAPI_SLEEP=1 "$tmp/scripts/gm-openapi-sync" "$out" >/dev/null &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
jq -e '.paths["/MemoryEntry"]' "$out" >/dev/null || fail "concurrent startups must leave one valid cache"

token_a='eyJhbGciOiJub25lIn0.eyJ0ZW5hbnRJZCI6InRlbmFudC1hIiwic3ViIjoicHJpbmNpcGFsLWEifQ.'
token_b='eyJhbGciOiJub25lIn0.eyJ0ZW5hbnRJZCI6InRlbmFudC1iIiwic3ViIjoicHJpbmNpcGFsLWIifQ.'
path_a="$(bash -c 'source "$1"; gm_schema_cache_path "$2" "$3" "$4"' _ "$tmp/scripts/gm-schema-cache-lib" "$tmp" "https://api-a.example/v1" "$token_a")"
path_b="$(bash -c 'source "$1"; gm_schema_cache_path "$2" "$3" "$4"' _ "$tmp/scripts/gm-schema-cache-lib" "$tmp" "https://api-b.example/v1" "$token_b")"
[[ "$path_a" != "$path_b" ]] || fail "schema caches must be isolated by API environment and authorized tenant/principal"

echo "gm_openapi_sync_test: PASS"
