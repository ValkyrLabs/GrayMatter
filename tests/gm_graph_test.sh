#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

run_graph_contract() {
  local label="$1"
  local source_script="$2"
  local script_dir="$TMP_DIR/$label"

  mkdir -p "$script_dir"
  cp "$source_script" "$script_dir/gm-graph"
  chmod +x "$script_dir/gm-graph"

  cat >"$script_dir/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'method=%s\npath=%s\nbody=%s\n' "${1:-}" "${2:-}" "${3:-}" >"$(dirname "$0")/api-call.txt"
printf '{"ok":true}\n'
EOF
  chmod +x "$script_dir/graymatter_api.sh"

  "$script_dir/gm-graph" POST agents '{"agent":"codex"}' >/dev/null
  grep -q '^method=POST$' "$script_dir/api-call.txt"
  grep -q '^path=/swarm-ops/graph/agents$' "$script_dir/api-call.txt"
  grep -q '^body={"agent":"codex"}$' "$script_dir/api-call.txt"
}

run_graph_contract root "$ROOT_DIR/scripts/gm-graph"
run_graph_contract plugin "$ROOT_DIR/plugins/graymatter/scripts/gm-graph"

echo "gm_graph_test: ok"
