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
require jq -e '.plugins[] | select(.name == "graymatter") | .source.path == "./plugins/graymatter"' "$ROOT/.agents/plugins/marketplace.json" >/dev/null
require jq -e '.slug == "graymatter"' "$ROOT/clawhub.json" >/dev/null
require jq -e '.tags | index("openclaw-skill")' "$ROOT/clawhub.json" >/dev/null

PLUGIN_VERSION="$(jq -r '.version' "$ROOT/.codex-plugin/plugin.json")"
CLAW_HUB_VERSION="$(jq -r '.version' "$ROOT/clawhub.json")"
if [[ "$CLAW_HUB_VERSION" != "$PLUGIN_VERSION" ]]; then
  echo "clawhub.json version must match .codex-plugin/plugin.json (${CLAW_HUB_VERSION} != ${PLUGIN_VERSION})" >&2
  exit 1
fi

require jq -e '.mcpServers.graymatter.command == "node"' "$ROOT/.mcp.json" >/dev/null
require jq -e '.mcpServers.graymatter.args == ["mcp-server/index.js", "--stdio"]' "$ROOT/.mcp.json" >/dev/null

require jq -e '.name == "graymatter"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.skills == "./skills/"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.mcpServers == "./.mcp.json"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.mcpServers.graymatter.args == ["mcp-server/index.js", "--stdio"]' "$ROOT/plugins/graymatter/.mcp.json" >/dev/null
[[ -f "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" ]] || {
  echo "Codex marketplace plugin skill missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/skills/graymatter-analytics/SKILL.md" ]] || {
  echo "Codex marketplace plugin analytics skill missing" >&2
  exit 1
}
grep -q '/v1/api-docs' "$ROOT/plugins/graymatter/skills/graymatter-analytics/SKILL.md" || {
  echo "Codex marketplace plugin analytics skill must cite api-docs as schema source of truth" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-activate" ]] || {
  echo "Codex marketplace plugin activation script missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-activation-fastlane" ]] || {
  echo "Codex marketplace plugin activation fastlane missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-invariant-preflight" ]] || {
  echo "Codex marketplace plugin invariant preflight missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-activation-fastlane" ]] || {
  echo "first-run activation fastlane missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-invariant-preflight" ]] || {
  echo "invariant preflight missing or not executable" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/mcp-server/index.js" ]] || {
  echo "Codex marketplace plugin MCP server missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json" ]] || {
  echo "Codex marketplace plugin portable MCP contract missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/references/mcp/memory-tool-contract.v1.json" ]] || {
  echo "Codex marketplace plugin legacy MCP contract missing" >&2
  exit 1
}

require jq -e '.scripts.start == "node index.js"' "$ROOT/mcp-server/package.json" >/dev/null
require jq -e '.scripts.stdio == "node index.js --stdio"' "$ROOT/mcp-server/package.json" >/dev/null
require jq -e '.engines.node == ">=20"' "$ROOT/mcp-server/package.json" >/dev/null

for needle in OpenClaw scripts/gm-activate scripts/gm-login mcp-server/; do
  grep -q "$needle" "$ROOT/SKILL.md" || {
    echo "SKILL.md missing $needle" >&2
    exit 1
  }
done
for needle in "Mandatory invariant preflight" "scripts/gm-invariant-preflight" "graymatter_invariant_preflight"; do
  grep -q "$needle" "$ROOT/SKILL.md" || {
    echo "SKILL.md missing invariant surface: $needle" >&2
    exit 1
  }
done

for needle in "Release surfaces" "MCP service" "Codex plugin" "Standalone OpenClaw skill"; do
  grep -q "$needle" "$ROOT/README.md" || {
    echo "README missing release surface: $needle" >&2
    exit 1
  }
done
grep -q "gm-activation-fastlane" "$ROOT/README.md" || {
  echo "README missing first-run activation fastlane" >&2
  exit 1
}
grep -q "gm-activation-fastlane" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing first-run activation fastlane" >&2
  exit 1
}
grep -q "gm-invariant-preflight" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing invariant preflight" >&2
  exit 1
}
grep -q "gm-invariant-preflight" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing invariant preflight" >&2
  exit 1
}
grep -q "graymatter_invariant_preflight" "$ROOT/mcp-server/README.md" || {
  echo "MCP README missing invariant preflight tool" >&2
  exit 1
}
grep -q "graymatter_invariant_preflight" "$ROOT/plugins/graymatter/mcp-server/README.md" || {
  echo "plugin MCP README missing invariant preflight tool" >&2
  exit 1
}

ZIP_LIST="$(mktemp "${TMPDIR:-/tmp}/graymatter-skill-list.XXXXXX")"
trap 'rm -f "$ZIP_LIST"' EXIT
unzip -Z1 "$ROOT/graymatter.skill" >"$ZIP_LIST"
grep -q '^graymatter/SKILL.md$' "$ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/SKILL.md$' "$ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/references/semantic-layer-template.md$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-activate$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-activation-fastlane$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-invariant-preflight$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-login$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-install-check$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-doctor$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-register-agent$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-openapi-sync$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-openapi-summary$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-light-up$' "$ZIP_LIST"
grep -q '^graymatter/mcp-server/index.js$' "$ZIP_LIST"
grep -q '^graymatter/.mcp.json$' "$ZIP_LIST"
grep -q '^graymatter/graymatter-bootstrap$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_mcp_contract_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/mcp/memory-tool-contract.v1.json$' "$ZIP_LIST"

echo "release_surfaces_test: ok"
