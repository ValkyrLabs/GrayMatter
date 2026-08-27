#!/usr/bin/env bash
set -euo pipefail

thor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
thor_tmp="$(mktemp -d "${TMPDIR:-/tmp}/gm-profile-test.XXXXXX")"
trap 'rm -rf "$thor_tmp"' EXIT

export GRAYMATTER_STATE_DIR="$thor_tmp/state"
export GRAYMATTER_SKIP_SELF_UPDATE=true

thor_file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

printf 'local-secret-one\n' | "$thor_root/scripts/gm-profile" add-local lite \
  --api-base http://localhost:8787/v1 --password-stdin --activate >/dev/null

jq -e '.mode == "single" and .activeProfile == "lite" and .profiles.lite.kind == "local"' \
  "$GRAYMATTER_STATE_DIR/profiles.json" >/dev/null
if grep -q 'local-secret-one' "$GRAYMATTER_STATE_DIR/profiles.json"; then
  echo "local profile secret leaked into profiles.json" >&2
  exit 1
fi
test "$(thor_file_mode "$GRAYMATTER_STATE_DIR/secrets/lite.password")" = "600"

unset GRAYMATTER_PROFILE_RESOLVED GRAYMATTER_PROFILE_MODE GRAYMATTER_ACTIVE_PROFILE
source "$thor_root/scripts/gm-profile-lib"
gm_profile_apply
test "$GRAYMATTER_PROFILE_MODE" = "single"
test "$GRAYMATTER_ACTIVE_PROFILE" = "lite"
test "$GRAYMATTER_LIGHT_MODE" = "true"
test "$GRAYMATTER_LIGHT_PASSWORD" = "local-secret-one"
test "$VALKYR_API_BASE" = "http://localhost:8787/v1"

# A legacy profile missing its account binding must fail safely rather than
# attempting Keychain access as the string "null".
jq '.profiles.broken={accountFingerprint:"sha256:deadbeef",apiBase:"https://api-0.valkyrlabs.com/v1",keychainService:"VALKYR_AUTH"}' \
  "$GRAYMATTER_STATE_DIR/profiles.json" >"$thor_tmp/profiles.json"
mv "$thor_tmp/profiles.json" "$GRAYMATTER_STATE_DIR/profiles.json"
set +e
"$thor_root/scripts/gm-profile" login broken >"$thor_tmp/broken.out" 2>"$thor_tmp/broken.err"
thor_status=$?
set -e
test "$thor_status" -eq 65
grep -q 'missing its account binding' "$thor_tmp/broken.err"

printf 'local-secret-two\n' | "$thor_root/scripts/gm-profile" add-local second \
  --api-base http://localhost:8877/v1 --password-stdin >/dev/null
"$thor_root/scripts/gm-profile" blend lite second >/dev/null

mkdir -p "$thor_tmp/bin"
cat >"$thor_tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
thor_output=""
thor_headers=""
thor_url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) thor_output="$2"; shift 2 ;;
    -D) thor_headers="$2"; shift 2 ;;
    -w|-X|-H|-u|-b|--connect-timeout|--max-time|--data) shift 2 ;;
    http://*|https://*) thor_url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' >"$thor_headers"
case "$thor_url" in
  http://localhost:8787/*) printf '%s' '[{"id":"local-memory"}]' >"$thor_output" ;;
  http://localhost:8877/*) printf '%s' '[{"id":"second-memory"}]' >"$thor_output" ;;
  *) printf '%s' '{"error":"unexpected test URL"}' >"$thor_output"; printf '500'; exit 0 ;;
esac
printf '200'
EOF
chmod +x "$thor_tmp/bin/curl"

PATH="$thor_tmp/bin:$PATH" GRAYMATTER_PROFILE_RESOLVED=false \
  "$thor_root/scripts/graymatter_api.sh" GET MemoryEntry >"$thor_tmp/blended-read.json"
jq -e '
  .mode == "federated-read"
  and .summary.successful == 2
  and .summary.failed == 0
  and ([.results[].profile] | sort) == ["lite", "second"]
  and all(.results[]; .ok == true and (.accountFingerprint | startswith("sha256:")))
' "$thor_tmp/blended-read.json" >/dev/null

set +e
GRAYMATTER_PROFILE_RESOLVED=false "$thor_root/scripts/gm-write" context "must not write" \
  >"$thor_tmp/write.out" 2>"$thor_tmp/write.err"
thor_status=$?
set -e
test "$thor_status" -eq 64
grep -q 'federated read mode' "$thor_tmp/write.err"

diff -q "$thor_root/scripts/gm-profile" "$thor_root/plugins/graymatter/scripts/gm-profile" >/dev/null
diff -q "$thor_root/scripts/gm-profile-lib" "$thor_root/plugins/graymatter/scripts/gm-profile-lib" >/dev/null

echo "gm_profile_test: ok"
