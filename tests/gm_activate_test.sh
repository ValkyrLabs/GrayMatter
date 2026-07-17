#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GM_ACTIVATE_SRC="${ROOT}/scripts/gm-activate"
GM_LOGIN_SRC="${ROOT}/scripts/gm-login"

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

make_fake_bin() {
  local dir="$1"

  cat >"${dir}/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec /usr/bin/jq "$@"
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

if [[ -n "${headers_file}" ]]; then
  cat >"${headers_file}" <<'HEADERS'
HTTP/1.1 200 OK
Set-Cookie: VALKYR_AUTH=test-token; Path=/; HttpOnly
HEADERS
fi

if [[ -n "${cookie_jar}" ]]; then
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

  cat >"${dir}/hostname" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'test-host\n'
EOF
  chmod +x "${dir}/hostname"
}

make_activation_fixture() {
  local fixture_dir="$1"
  local smoke_mode="$2"

  mkdir -p "${fixture_dir}"
  cp "${GM_ACTIVATE_SRC}" "${fixture_dir}/gm-activate"
  cp "${GM_LOGIN_SRC}" "${fixture_dir}/gm-login"
  chmod +x "${fixture_dir}/gm-activate"
  chmod +x "${fixture_dir}/gm-login"

  cat >"${fixture_dir}/gm-install-check" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'install check passed\n'
EOF
  chmod +x "${fixture_dir}/gm-install-check"

  cat >"${fixture_dir}/gm-self-update" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_SELF_UPDATE_LOG}"
printf 'self-update %s\n' "${1:-}"
EOF
  chmod +x "${fixture_dir}/gm-self-update"

  if [[ "${smoke_mode}" == "success" ]]; then
    cat >"${fixture_dir}/gm-smoke" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'smoke ok\n'
EOF
  else
    cat >"${fixture_dir}/gm-smoke" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl: (22) The requested URL returned error: 402\n' >&2
printf '{"error":"INSUFFICIENT_FUNDS"}\n' >&2
exit 22
EOF
  fi
  chmod +x "${fixture_dir}/gm-smoke"

  cat >"${fixture_dir}/gm-register-agent" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: >"${TEST_REGISTER_CALLED}"
printf 'registered\n'
EOF
  chmod +x "${fixture_dir}/gm-register-agent"

  cat >"${fixture_dir}/gm-startup-preflight" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: >"${TEST_SYNC_CALLED}"
printf '%s\n' "$*" >>"${TEST_STARTUP_LOG}"
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      out="$2"
      shift 2
      ;;
    *) shift ;;
  esac
done
if [[ -n "$out" ]]; then
  mkdir -p "$(dirname "$out")"
  printf '{"schemaVersion":"graymatter-startup-preflight/v1","status":"%s"}\n' "${TEST_STARTUP_STATUS:-READY}" >"$out"
fi
printf 'GrayMatter startup preflight\nstatus=%s\n' "${TEST_STARTUP_STATUS:-READY}"
EOF
  chmod +x "${fixture_dir}/gm-startup-preflight"
}

run_activate() {
  local smoke_mode="$1"
  local startup_status="${2:-READY}"
  local temp_root
  local fake_bin
  local fixture_dir

  temp_root="$(mktemp -d)"
  fake_bin="${temp_root}/bin"
  fixture_dir="${temp_root}/scripts"
  mkdir -p "${fake_bin}"

  make_fake_bin "${fake_bin}"
  make_activation_fixture "${fixture_dir}" "${smoke_mode}"

  export TEST_SECURITY_LOG="${temp_root}/security.log"
  export TEST_SELF_UPDATE_LOG="${temp_root}/self-update.log"
  export TEST_REGISTER_CALLED="${temp_root}/register.called"
  export TEST_SYNC_CALLED="${temp_root}/sync.called"
  export TEST_STARTUP_LOG="${temp_root}/startup.log"
  export TEST_STARTUP_STATUS="${startup_status}"

  local output
  local status=0
  set +e
  output="$(
    PATH="${fake_bin}:/usr/bin:/bin" \
    GRAYMATTER_USERNAME="valor-codex" \
    GRAYMATTER_PASSWORD="secret" \
    GRAYMATTER_STATE_DIR="${temp_root}/.graymatter" \
    GRAYMATTER_WORKSPACE_KEY="OmegaTest" \
    OPENCLAW_AGENT_NAME="valor-codex" \
    OPENCLAW_AGENT_ROLE="job-automation" \
    "${fixture_dir}/gm-activate" 2>&1
  )"
  status=$?
  set -e

  printf '%s\n' "${status}"
  printf '%s\n' "${temp_root}"
  printf '%s' "${output}"
}

test_activate_stores_runtime_keychain_service() {
  local result
  local status
  local temp_root
  local output

  result="$(run_activate success)"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"
  temp_root="$(printf '%s\n' "${result}" | sed -n '2p')"
  output="$(printf '%s\n' "${result}" | tail -n +3)"

  [[ "${status}" == "0" ]] || fail "gm-activate should succeed in the happy path"

  local security_log
  security_log="$(cat "${temp_root}/security.log")"
  local self_update_log
  self_update_log="$(cat "${temp_root}/self-update.log")"
  assert_contains "${self_update_log}" "force" "gm-activate should force self-update during activation by default"
  assert_contains "${security_log}" "-s VALKYR_AUTH" "gm-activate should store the token under the VALKYR_AUTH keychain service"
  assert_contains "${output}" "GrayMatter activation complete" "gm-activate should report completion in the happy path"
  local startup_log
  startup_log="$(cat "${temp_root}/startup.log")"
  assert_contains "${startup_log}" "--workspace-key OmegaTest" "gm-activate should scope the startup preflight to the workspace"
  if [[ "${startup_log}" == *"--allow-memory-degraded"* ]]; then
    fail "gm-activate should not weaken invariant startup checks in the happy path"
  fi
}

test_activate_continues_when_smoke_query_is_credit_gated() {
  local result
  local status
  local temp_root
  local output

  result="$(run_activate insufficient-funds)"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"
  temp_root="$(printf '%s\n' "${result}" | sed -n '2p')"
  output="$(printf '%s\n' "${result}" | tail -n +3)"

  [[ "${status}" == "0" ]] || fail "gm-activate should continue when gm-smoke fails with insufficient funds"
  assert_file_exists "${temp_root}/register.called" "gm-activate should still register the agent when query credits are unavailable"
  assert_file_exists "${temp_root}/sync.called" "gm-activate should still run the startup preflight when query credits are unavailable"
  assert_file_exists "${temp_root}/.graymatter/activation-degraded.json" "gm-activate should write degraded pester state"
  assert_contains "${output}" "continuing in degraded mode" "gm-activate should explain the degraded activation state"
  assert_contains "${output}" "not optional" "gm-activate should pester about restoring full memory"
  assert_contains "$(cat "${temp_root}/startup.log")" "--allow-memory-degraded" "credit-gated activation should explicitly record degraded invariant retrieval"
}

test_activate_surfaces_degraded_capabilities() {
  local result
  local status
  local output

  result="$(run_activate success DEGRADED)"
  status="$(printf '%s\n' "${result}" | sed -n '1p')"
  output="$(printf '%s\n' "${result}" | tail -n +3)"

  [[ "${status}" == "0" ]] || fail "gm-activate should remain usable with explicit degraded capability discovery"
  assert_contains "${output}" "ready with capability limits" "gm-activate should surface degraded capability discovery"
  if [[ "${output}" == *"GrayMatter activation complete"* ]]; then
    fail "gm-activate must not report fully complete when capability discovery is degraded"
  fi
}

test_activate_stores_runtime_keychain_service
test_activate_continues_when_smoke_query_is_credit_gated
test_activate_surfaces_degraded_capabilities

printf 'PASS: gm_activate_test.sh\n'
