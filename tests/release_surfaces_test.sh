#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

require() {
  if ! "$@"; then
    echo "release surface check failed: $*" >&2
    exit 1
  fi
}

require jq -e '.name == "graymatter"' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.skills == "./skills/"' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.mcpServers == "./.mcp.json"' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("mcp")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.capabilities | index("Interactive")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.longDescription | contains("mcp-server")' "$ROOT/.codex-plugin/plugin.json" >/dev/null

require jq -e '.mcpServers.graymatter.command == "node"' "$ROOT/.mcp.json" >/dev/null
require jq -e '.mcpServers.graymatter.args == ["mcp-server/index.js", "--stdio"]' "$ROOT/.mcp.json" >/dev/null

require jq -e '.scripts.start == "node index.js"' "$ROOT/mcp-server/package.json" >/dev/null
require jq -e '.scripts.stdio == "node index.js --stdio"' "$ROOT/mcp-server/package.json" >/dev/null
require jq -e '.engines.node == ">=20"' "$ROOT/mcp-server/package.json" >/dev/null

for needle in OpenClaw scripts/gm-activate scripts/gm-login mcp-server/; do
  grep -q "$needle" "$ROOT/SKILL.md" || {
    echo "SKILL.md missing $needle" >&2
    exit 1
  }
done

for needle in "Ready-to-rock release surfaces" "MCP service" "Codex plugin" "Standalone OpenClaw skill"; do
  grep -q "$needle" "$ROOT/README.md" || {
    echo "README missing release surface: $needle" >&2
    exit 1
  }
done

ZIP_LIST="$(mktemp "${TMPDIR:-/tmp}/graymatter-skill-list.XXXXXX")"
trap 'rm -f "$ZIP_LIST"' EXIT
unzip -Z1 "$ROOT/graymatter.skill" >"$ZIP_LIST"
grep -q '^graymatter/SKILL.md$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-activate$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-light-up$' "$ZIP_LIST"
if grep -q '^graymatter/mcp-server/' "$ZIP_LIST"; then
  echo "standalone skill must stay skill-only" >&2
  exit 1
fi

echo "release_surfaces_test: ok"
