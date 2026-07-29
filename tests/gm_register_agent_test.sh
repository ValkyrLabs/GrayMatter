#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SRC="${ROOT}/scripts/gm-register-agent"

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

assert_jq() {
  local json="$1"
  local filter="$2"
  local message="$3"
  if ! jq -e "$filter" <<<"$json" >/dev/null; then
    fail "$message"
  fi
}

temp_root="$(mktemp -d)"
script_dir="${temp_root}/scripts"
mkdir -p "${script_dir}"

cp "${SCRIPT_SRC}" "${script_dir}/gm-register-agent"
chmod +x "${script_dir}/gm-register-agent"

cat >"${script_dir}/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'method=%s\npath=%s\nbody=%s\n' "$1" "$2" "$3" >"${TEST_API_LOG}"
EOF
chmod +x "${script_dir}/graymatter_api.sh"

export TEST_API_LOG="${temp_root}/api.log"
export GRAYMATTER_PLUGIN_VERSION="0.3.1-test"

"${script_dir}/gm-register-agent" "codex-test-instance" "Codex" "coding-agent"

log="$(cat "${TEST_API_LOG}")"
body="$(sed -n 's/^body=//p' "${TEST_API_LOG}")"
metadata="$(jq -r '.metadata' <<<"$body")"
assert_contains "${log}" "method=POST" "gm-register-agent should POST to the agent registration endpoint"
assert_contains "${log}" "path=/swarm-ops/register" "gm-register-agent should use the SwarmOps registration route"
assert_contains "${log}" '"instanceId":"codex-test-instance"' "gm-register-agent should include the instance id"
assert_jq "${body}" '.metadata | type == "string"' "gm-register-agent should JSON-encode metadata as a string for api-0"
assert_jq "${metadata}" '.name == "Codex"' "gm-register-agent should identify the agent runtime"
assert_jq "${metadata}" '.role == "coding-agent"' "gm-register-agent should include the agent role"
assert_jq "${metadata}" '.primaryMemory == "GrayMatter"' "gm-register-agent should advertise GrayMatter as the memory layer"
assert_jq "${metadata}" '.version == "0.3.1-test"' "gm-register-agent should advertise its installed plugin version"

export GRAYMATTER_SWARM_ID="codex-env-instance"
export GRAYMATTER_AGENT_NAME="Env Codex"
export GRAYMATTER_AGENT_ROLE="env-agent"

"${script_dir}/gm-register-agent"

body="$(sed -n 's/^body=//p' "${TEST_API_LOG}")"
metadata="$(jq -r '.metadata' <<<"$body")"
assert_contains "${body}" '"instanceId":"codex-env-instance"' "gm-register-agent should accept GRAYMATTER_SWARM_ID"
assert_jq "${metadata}" '.name == "Env Codex"' "gm-register-agent should accept GRAYMATTER_AGENT_NAME"
assert_jq "${metadata}" '.role == "env-agent"' "gm-register-agent should accept GRAYMATTER_AGENT_ROLE"

printf 'PASS: gm_register_agent_test.sh\n'
