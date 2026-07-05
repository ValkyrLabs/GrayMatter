#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_SRC="${ROOT}/scripts/gm-claude-install"

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

make_fake_node() {
  local path="$1"
  cat >"$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-p" ]]; then
  printf '24\n'
  exit 0
fi
if [[ "${1:-}" == "-v" ]]; then
  printf 'v24.7.0\n'
  exit 0
fi
printf 'fake node invoked\n'
EOF
  chmod +x "$path"
}

make_fake_claude() {
  local path="$1"
  cat >"$path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${TEST_CLAUDE_LOG:?}"
if [[ "$*" == "mcp --help" ]]; then
  printf 'mcp help\n'
fi
EOF
  chmod +x "$path"
}

test_registers_graymatter_stdio_server_with_claude_code() {
  local temp_root
  local fake_node
  local fake_claude
  local output

  temp_root="$(mktemp -d)"
  fake_node="${temp_root}/node"
  fake_claude="${temp_root}/claude"
  export TEST_CLAUDE_LOG="${temp_root}/claude.log"
  make_fake_node "$fake_node"
  make_fake_claude "$fake_claude"

  output="$(
    GRAYMATTER_NODE="$fake_node" \
    CLAUDE_CODE_BIN="$fake_claude" \
    "${SCRIPT_SRC}" --skip-check 2>&1
  )"

  assert_contains "$output" "GrayMatter MCP server registered with Claude Code as graymatter (user scope)" \
    "gm-claude-install should report successful registration"

  local log
  log="$(cat "$TEST_CLAUDE_LOG")"
  assert_contains "$log" "mcp remove graymatter" "gm-claude-install should replace stale graymatter registrations"
  assert_contains "$log" "mcp add --env VALKYR_API_BASE=https://api-0.valkyrlabs.com/v1 GRAYMATTER_MCP_MODE=private-stdio --transport stdio --scope user graymatter -- ${fake_node} ${ROOT}/mcp-server/index.js --stdio" \
    "gm-claude-install should use Claude Code stdio syntax with server args after --"
  assert_contains "$log" "mcp get graymatter" "gm-claude-install should verify the registered server"
}

test_dry_run_prints_project_scoped_command() {
  local temp_root
  local fake_node
  local fake_claude
  local output

  temp_root="$(mktemp -d)"
  fake_node="${temp_root}/node"
  fake_claude="${temp_root}/claude"
  export TEST_CLAUDE_LOG="${temp_root}/claude.log"
  make_fake_node "$fake_node"
  make_fake_claude "$fake_claude"

  output="$(
    GRAYMATTER_NODE="$fake_node" \
    CLAUDE_CODE_BIN="$fake_claude" \
    "${SCRIPT_SRC}" --scope project --api-base "https://api.example.test/v1" --dry-run
  )"

  assert_contains "$output" "--scope project" "dry run should include the requested Claude MCP scope"
  assert_contains "$output" "VALKYR_API_BASE=https://api.example.test/v1" "dry run should include the requested API base"
  [[ ! -s "$TEST_CLAUDE_LOG" ]] || fail "dry run must not invoke Claude Code"
}

test_registers_graymatter_stdio_server_with_claude_code
test_dry_run_prints_project_scoped_command

printf 'PASS: gm_claude_install_test.sh\n'
