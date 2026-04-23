#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_SRC="${ROOT}/scripts/graymatter_api.sh"

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

assert_file_exists() {
  local path="$1"
  local message="$2"
  if [[ ! -e "$path" ]]; then
    fail "$message"
  fi
}

assert_file_missing() {
  local path="$1"
  local message="$2"
  if [[ -e "$path" ]]; then
    fail "$message"
  fi
}

make_fake_bin() {
  local dir="$1"

  cat >"${dir}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

out_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      out_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$out_file" ]]; then
  echo "Missing -o output file" >&2
  exit 2
fi

case "${TEST_CURL_SCENARIO:-success}" in
  success)
    printf '{"ok":true}\n' >"${out_file}"
    printf '200'
    ;;
  insufficient-funds)
    printf '{"error":"INSUFFICIENT_FUNDS","insufficientFunds":true}\n' >"${out_file}"
    printf '402'
    ;;
  transport-fail)
    echo "curl transport failure" >&2
    exit 7
    ;;
  *)
    echo "Unknown TEST_CURL_SCENARIO" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "${dir}/curl"

  cat >"${dir}/osascript" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
printf 'osascript called\n' >>"${TEST_OSASCRIPT_LOG}"
exit "${TEST_OSASCRIPT_STATUS:-0}"
EOF
  chmod +x "${dir}/osascript"

  cat >"${dir}/powershell.exe" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'powershell called\n' >>"${TEST_POWERSHELL_LOG}"
exit "${TEST_POWERSHELL_STATUS:-0}"
EOF
  chmod +x "${dir}/powershell.exe"

  cat >"${dir}/open" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'open %s\n' "$*" >>"${TEST_OPEN_LOG}"
exit 0
EOF
  chmod +x "${dir}/open"

  cat >"${dir}/xdg-open" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'xdg-open %s\n' "$*" >>"${TEST_OPEN_LOG}"
exit 0
EOF
  chmod +x "${dir}/xdg-open"

  cat >"${dir}/cmd.exe" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'cmd.exe %s\n' "$*" >>"${TEST_OPEN_LOG}"
exit 0
EOF
  chmod +x "${dir}/cmd.exe"
}

run_api() {
  local bin_dir="$1"
  local script_path="$2"

  local output
  local status=0
  set +e
  output="$(
    PATH="${bin_dir}:/usr/bin:/bin" \
    VALKYR_AUTH_TOKEN="test-token" \
    "${script_path}" GET /MemoryEntry/stats 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "${status}"
  printf '%s' "${output}"
}

with_fixture() {
  local callback="$1"
  local temp_root
  local fake_bin
  local script_copy

  temp_root="$(mktemp -d)"
  fake_bin="${temp_root}/bin"
  script_copy="${temp_root}/graymatter_api.sh"
  mkdir -p "${fake_bin}"

  cp "${API_SRC}" "${script_copy}"
  chmod +x "${script_copy}"
  make_fake_bin "${fake_bin}"

  TEST_OSASCRIPT_LOG="${temp_root}/osascript.log"
  TEST_POWERSHELL_LOG="${temp_root}/powershell.log"
  TEST_OPEN_LOG="${temp_root}/open.log"
  export TEST_OSASCRIPT_LOG TEST_POWERSHELL_LOG TEST_OPEN_LOG

  "${callback}" "${temp_root}" "${fake_bin}" "${script_copy}"
}

test_success_passthrough() {
  local _temp_root="$1"
  local fake_bin="$2"
  local script_copy="$3"

  export TEST_CURL_SCENARIO="success"
  local result
  local status
  local output

  result="$(run_api "${fake_bin}" "${script_copy}")"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"
  output="$(printf '%s\n' "${result}" | tail -n +2)"

  [[ "${status}" == "0" ]] || fail "graymatter_api should return success for HTTP 200"
  assert_contains "${output}" '{"ok":true}' "graymatter_api should print response body on success"
}

test_insufficient_funds_shows_links_and_uses_macos_prompt() {
  local temp_root="$1"
  local fake_bin="$2"
  local script_copy="$3"

  export TEST_CURL_SCENARIO="insufficient-funds"
  export TEST_OSASCRIPT_STATUS="0"
  export TEST_POWERSHELL_STATUS="0"
  export VALKYR_BUY_CREDITS_URL="https://example.com/buy"
  export VALKYR_HUMAN_SIGNUP_URL="https://example.com/signup"

  local result
  local status
  local output

  result="$(run_api "${fake_bin}" "${script_copy}")"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"
  output="$(printf '%s\n' "${result}" | tail -n +2)"

  [[ "${status}" == "22" ]] || fail "graymatter_api should return 22 for HTTP errors"
  assert_contains "${output}" "Insufficient credits. Buy credits: https://example.com/buy" "graymatter_api should print buy-credits guidance"
  assert_contains "${output}" "Need an account? Sign up here: https://example.com/signup" "graymatter_api should print signup guidance"
  assert_file_exists "${temp_root}/osascript.log" "graymatter_api should trigger macOS prompt when available"
  assert_file_missing "${temp_root}/powershell.log" "graymatter_api should not invoke Windows prompt when macOS prompt succeeds"
}

test_insufficient_funds_falls_back_to_windows_prompt() {
  local temp_root="$1"
  local fake_bin="$2"
  local script_copy="$3"

  export TEST_CURL_SCENARIO="insufficient-funds"
  export TEST_OSASCRIPT_STATUS="1"
  export TEST_POWERSHELL_STATUS="0"
  export VALKYR_BUY_CREDITS_URL="https://valkyrlabs.com/buy-credits"
  export VALKYR_HUMAN_SIGNUP_URL="https://valkyrlabs.com/funnel/white-paper"

  local result
  local status

  result="$(run_api "${fake_bin}" "${script_copy}")"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"

  [[ "${status}" == "22" ]] || fail "graymatter_api should still return 22 when insufficient funds occurs"
  assert_file_exists "${temp_root}/osascript.log" "graymatter_api should attempt macOS prompt first"
  assert_file_exists "${temp_root}/powershell.log" "graymatter_api should invoke Windows prompt fallback when macOS prompt fails"
}

with_fixture test_success_passthrough
with_fixture test_insufficient_funds_shows_links_and_uses_macos_prompt
with_fixture test_insufficient_funds_falls_back_to_windows_prompt

printf 'PASS: graymatter_api_test.sh\n'
