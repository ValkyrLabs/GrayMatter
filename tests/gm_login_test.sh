#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGIN_SRC="${ROOT}/scripts/gm-login"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$message"
  fi
}

make_fake_bin() {
  local dir="$1"

  cat >"${dir}/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-nc" ]]; then
  printf '%s\n' '{"username":"valor","password":"secret-password"}'
else
  printf 'null\n'
fi
EOF
  chmod +x "${dir}/jq"

  cat >"${dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

headers_file=""
cookie_jar=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -D)
      headers_file="$2"
      shift 2
      ;;
    -c)
      cookie_jar="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -n "$headers_file" ]]; then
  cat >"${headers_file}" <<'HEADERS'
HTTP/1.1 200 OK
Set-Cookie: VALKYR_AUTH=test-token; Path=/; HttpOnly
HEADERS
fi

if [[ -n "$cookie_jar" ]]; then
  cat >"${cookie_jar}" <<'COOKIES'
# Netscape HTTP Cookie File
api-0.valkyrlabs.com	FALSE	/	FALSE	0	VALKYR_AUTH	test-token
COOKIES
fi

printf '{}\n'
EOF
  chmod +x "${dir}/curl"

  cat >"${dir}/security" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_SECURITY_LOG}"
EOF
  chmod +x "${dir}/security"

  cat >"${dir}/osascript" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
printf 'osascript called\n' >>"${TEST_OSASCRIPT_LOG}"
printf 'popup-password\n'
EOF
  chmod +x "${dir}/osascript"
}

test_login_stores_token_and_reusable_credentials() {
  local temp_root
  local fake_bin
  local script_copy
  local output

  temp_root="$(mktemp -d)"
  fake_bin="${temp_root}/bin"
  script_copy="${temp_root}/gm-login"
  mkdir -p "${fake_bin}"

  cp "${LOGIN_SRC}" "${script_copy}"
  chmod +x "${script_copy}"
  make_fake_bin "${fake_bin}"
  export TEST_SECURITY_LOG="${temp_root}/security.log"
  export TEST_OSASCRIPT_LOG="${temp_root}/osascript.log"

  output="$(
    PATH="${fake_bin}:/usr/bin:/bin" \
    GRAYMATTER_USERNAME="valor" \
    GRAYMATTER_PASSWORD="secret-password" \
    "${script_copy}" keychain 2>&1
  )"

  local security_log
  security_log="$(cat "${temp_root}/security.log")"
  assert_contains "${security_log}" "add-generic-password -U -a valor -s VALKYR_AUTH -w test-token" "gm-login should store a username-scoped token"
  assert_contains "${security_log}" "add-generic-password -U -a default -s VALKYR_AUTH -w test-token" "gm-login should preserve the legacy default token alias"
  assert_contains "${security_log}" "add-generic-password -U -a default -s VALKYR_AUTH_USERNAME -w valor" "gm-login should remember the username for autonomous refresh"
  assert_contains "${security_log}" "add-generic-password -U -a valor -s VALKYR_AUTH_PASSWORD -w secret-password" "gm-login should store the password under a username-scoped keychain entry"
  assert_contains "${output}" "Stored GrayMatter credentials securely in macOS/iCloud Keychain" "gm-login should report credential persistence"
}

test_login_uses_secure_password_popup_when_password_missing() {
  local temp_root
  local fake_bin
  local script_copy

  temp_root="$(mktemp -d)"
  fake_bin="${temp_root}/bin"
  script_copy="${temp_root}/gm-login"
  mkdir -p "${fake_bin}"

  cp "${LOGIN_SRC}" "${script_copy}"
  chmod +x "${script_copy}"
  make_fake_bin "${fake_bin}"
  export TEST_SECURITY_LOG="${temp_root}/security.log"
  export TEST_OSASCRIPT_LOG="${temp_root}/osascript.log"

  PATH="${fake_bin}:/usr/bin:/bin" \
  GRAYMATTER_USERNAME="valor" \
  "${script_copy}" keychain >/dev/null 2>&1

  local security_log
  security_log="$(cat "${temp_root}/security.log")"
  assert_contains "$(cat "${temp_root}/osascript.log")" "osascript called" "gm-login should use the macOS secure password popup when no password is available"
  assert_contains "${security_log}" "add-generic-password -U -a valor -s VALKYR_AUTH_PASSWORD -w popup-password" "gm-login should persist the password returned by the secure popup"
}

test_login_stores_token_and_reusable_credentials
test_login_uses_secure_password_popup_when_password_missing

printf 'PASS: gm_login_test.sh\n'
