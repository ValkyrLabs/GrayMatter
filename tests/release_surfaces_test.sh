#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$ROOT/SUBMISSION_CHECKLIST.md" ]] || {
  echo "Root submission checklist is missing from the packaged/self-update surface" >&2
  exit 1
}
cmp -s "$ROOT/SUBMISSION_CHECKLIST.md" "$ROOT/plugins/graymatter/SUBMISSION_CHECKLIST.md" || {
  echo "Root and marketplace submission checklists must stay identical" >&2
  exit 1
}

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
require jq -e '.keywords | index("retrieval-receipts")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("graymatter-light")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("valoride")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.capabilities | index("Interactive")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.longDescription | contains("mcp-server")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.longDescription | contains("retrieval receipts")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.description == "Persistent, secure memory and shared context for AI agents."' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.apps == "./.app.json"' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.defaultPrompt | length == 3' "$ROOT/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.defaultPrompt | index("Compile task-specific context from GrayMatter.")' "$ROOT/.codex-plugin/plugin.json" >/dev/null
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
require jq -e '.apps == {}' "$ROOT/.app.json" >/dev/null

if find "$ROOT/scripts" "$ROOT/plugins/graymatter/scripts" -maxdepth 1 -type f -name '*.py' | grep -q .; then
  echo "GrayMatter product scripts must stay portable bash; Python scripts are not allowed in shipped script surfaces" >&2
  exit 1
fi
if grep -RIl '^#!.*python' "$ROOT/scripts" "$ROOT/plugins/graymatter/scripts" "$ROOT/plugins/graymatter/.codex-plugin" | grep -q .; then
  echo "GrayMatter product scripts must stay portable bash; Python shebangs are not allowed" >&2
  exit 1
fi
if grep -RInE '\bpython3?\b|PyYAML|requirements\.txt|pyproject\.toml' \
  "$ROOT/scripts" "$ROOT/plugins/graymatter/scripts" "$ROOT/plugins/graymatter/.codex-plugin" "$ROOT/plugins/graymatter/.mcp.json" | grep -q .; then
  echo "GrayMatter install/runtime surfaces must not require Python; keep product automation in bash/curl/jq and MCP in Node" >&2
  exit 1
fi

require jq -e '.name == "graymatter"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.skills == "./skills/"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.mcpServers == "./.mcp.json"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.apps == "./.app.json"' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("retrieval-receipts")' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("graymatter-light")' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.keywords | index("valoride")' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.interface.longDescription | contains("GrayMatter Light")' "$ROOT/plugins/graymatter/.codex-plugin/plugin.json" >/dev/null
require jq -e '.apps == {}' "$ROOT/plugins/graymatter/.app.json" >/dev/null
require jq -e '.mcpServers.graymatter.args == ["mcp-server/index.js", "--stdio"]' "$ROOT/plugins/graymatter/.mcp.json" >/dev/null
[[ -f "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" ]] || {
  echo "Codex marketplace plugin skill missing" >&2
  exit 1
}
for destination in ThorAPI TrustFabric ValorIDE ValkyrAI GridHeim SWARM; do
  grep -q "\*\*$destination\*\*" "$ROOT/skills/graymatter/SKILL.md" || {
    echo "Standalone OpenClaw skill is missing $destination routing guidance" >&2
    exit 1
  }
  grep -q "\*\*$destination\*\*" "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" || {
    echo "Codex marketplace skill is missing $destination routing guidance" >&2
    exit 1
  }
done
[[ -f "$ROOT/plugins/graymatter/skills/graymatter-analytics/SKILL.md" ]] || {
  echo "Codex marketplace plugin analytics skill missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/skills/graymatter-analytics/references/semantic-layer-template.md" ]] || {
  echo "Codex marketplace plugin analytics semantic layer template missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/agent-discovery.md" ]] || {
  echo "Codex marketplace plugin agent discovery docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/awesome-codex-plugins.md" ]] || {
  echo "Codex marketplace plugin awesome-codex listing docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/graymatter-light.md" ]] || {
  echo "Codex marketplace plugin GrayMatter Light docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/knowledge-packs.md" ]] || {
  echo "Codex marketplace plugin KnowledgePack docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/openai-app-directory-submission.md" ]] || {
  echo "Codex marketplace plugin OpenAI app submission docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/privacy-policy.md" ]] || {
  echo "Codex marketplace plugin privacy policy docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/reviewer-test-credentials.md" ]] || {
  echo "Codex marketplace plugin reviewer credential runbook missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/docs/thorapi-integration.md" ]] || {
  echo "Codex marketplace plugin ThorAPI integration docs missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/openai-app/submission-manifest.json" ]] || {
  echo "Codex marketplace plugin OpenAI app submission manifest missing" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/clawhub.json" ]] || {
  echo "Codex marketplace plugin clawhub metadata missing" >&2
  exit 1
}
cmp -s "$ROOT/openai-app/submission-manifest.json" "$ROOT/plugins/graymatter/openai-app/submission-manifest.json" || {
  echo "Codex marketplace plugin OpenAI app submission manifest is stale; sync openai-app/submission-manifest.json" >&2
  exit 1
}
cmp -s "$ROOT/clawhub.json" "$ROOT/plugins/graymatter/clawhub.json" || {
  echo "Codex marketplace plugin clawhub metadata is stale; sync clawhub.json" >&2
  exit 1
}

while IFS= read -r doc_path; do
  doc_name="$(basename "$doc_path")"
  cmp -s "$ROOT/docs/$doc_name" "$doc_path" || {
    echo "Codex marketplace plugin doc is stale; sync docs/$doc_name" >&2
    exit 1
  }
done < <(find "$ROOT/plugins/graymatter/docs" -maxdepth 1 -type f | sort)

grep -q '/v1/swarm-ops/graph' "$ROOT/plugins/graymatter/docs/graymatter-light.md" || {
  echo "Codex marketplace plugin GrayMatter Light docs must use production-shaped /v1 swarm graph path" >&2
  exit 1
}
grep -q '/v1/api-docs' "$ROOT/plugins/graymatter/skills/graymatter-analytics/SKILL.md" || {
  echo "Codex marketplace plugin analytics skill must cite api-docs as schema source of truth" >&2
  exit 1
}
grep -q 'scripts/gm-activation-fastlane' "$ROOT/skills/graymatter/SKILL.md" || {
  echo "Standalone packaged skill missing activation fastlane guidance" >&2
  exit 1
}
grep -q 'scripts/gm-read' "$ROOT/skills/graymatter/SKILL.md" || {
  echo "Standalone packaged skill missing memory read guidance" >&2
  exit 1
}
grep -q 'scripts/gm-activation-fastlane' "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" || {
  echo "Codex marketplace plugin skill missing activation fastlane guidance" >&2
  exit 1
}
grep -q 'scripts/gm-read' "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" || {
  echo "Codex marketplace plugin skill missing memory read guidance" >&2
  exit 1
}
grep -q 'valkyrlabs.com/graymatter/activate' "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" || {
  echo "Codex marketplace plugin skill missing routed signup guidance" >&2
  exit 1
}
grep -q 'Normalized object writes' "$ROOT/SKILL.md" || {
  echo "Standalone skill missing normalized object write guidance" >&2
  exit 1
}
grep -q 'Normalized object writes' "$ROOT/skills/graymatter/SKILL.md" || {
  echo "Standalone packaged skill missing normalized object write guidance" >&2
  exit 1
}
grep -q 'Normalized object writes' "$ROOT/plugins/graymatter/skills/graymatter/SKILL.md" || {
  echo "Codex marketplace plugin skill missing normalized object write guidance" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-activate" ]] || {
  echo "Codex marketplace plugin activation script missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-claude-install" ]] || {
  echo "Codex marketplace plugin Claude Code installer missing or not executable" >&2
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
[[ -x "$ROOT/plugins/graymatter/scripts/gm-startup-preflight" ]] || {
  echo "Codex marketplace plugin startup preflight missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-agent-smoke-matrix" ]] || {
  echo "Codex marketplace plugin agent smoke matrix missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-release-evidence" ]] || {
  echo "Codex marketplace plugin release evidence generator missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-light-smoke" ]] || {
  echo "Codex marketplace plugin Light smoke script missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-knowledge-pack-import" ]] || {
  echo "Codex marketplace plugin KnowledgePack importer missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-read" ]] || {
  echo "Codex marketplace plugin memory read script missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-client" ]] || {
  echo "Codex marketplace plugin generic REST client missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/gm-record" ]] || {
  echo "Codex marketplace plugin record helper missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/package-graymatter" ]] || {
  echo "Codex marketplace plugin standalone packager missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/scripts/package_graymatter.sh" ]] || {
  echo "Codex marketplace plugin package compatibility wrapper missing or not executable" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/templates/graymatter-light-bootstrap/api.hbs.yaml" ]] || {
  echo "Codex marketplace plugin GrayMatter Light template missing" >&2
  exit 1
}
[[ -x "$ROOT/plugins/graymatter/templates/graymatter-light-bootstrap/local-server/bin/graymatter-local-server" ]] || {
  echo "Codex marketplace plugin GrayMatter Light server launcher missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-activation-fastlane" ]] || {
  echo "first-run activation fastlane missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-claude-install" ]] || {
  echo "Claude Code MCP installer missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-invariant-preflight" ]] || {
  echo "invariant preflight missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-startup-preflight" ]] || {
  echo "startup preflight missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-release-evidence" ]] || {
  echo "release evidence generator missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-read" ]] || {
  echo "memory read script missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-client" ]] || {
  echo "generic REST client missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/gm-record" ]] || {
  echo "record helper missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/package-graymatter" ]] || {
  echo "standalone packager missing or not executable" >&2
  exit 1
}
[[ -x "$ROOT/scripts/package_graymatter.sh" ]] || {
  echo "package compatibility wrapper missing or not executable" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/mcp-server/index.js" ]] || {
  echo "Codex marketplace plugin MCP server missing" >&2
  exit 1
}

while IFS= read -r script_path; do
  script_name="$(basename "$script_path")"
  if [[ "$script_name" == "package-graymatter" ]]; then
    continue
  fi
  cmp -s "$ROOT/scripts/$script_name" "$script_path" || {
    echo "Codex marketplace plugin script is stale; sync scripts/$script_name" >&2
    exit 1
  }
done < <(find "$ROOT/plugins/graymatter/scripts" -maxdepth 1 -type f | sort)

cmp -s "$ROOT/mcp-server/index.js" "$ROOT/plugins/graymatter/mcp-server/index.js" || {
  echo "Codex marketplace plugin MCP server is stale; sync mcp-server/index.js" >&2
  exit 1
}
cmp -s "$ROOT/mcp-server/test/recovery.test.js" "$ROOT/plugins/graymatter/mcp-server/test/recovery.test.js" || {
  echo "Codex marketplace plugin MCP recovery tests are stale; sync mcp-server/test/recovery.test.js" >&2
  exit 1
}
cmp -s "$ROOT/scripts/graymatter_api.sh" "$ROOT/plugins/graymatter/scripts/graymatter_api.sh" || {
  echo "Codex marketplace plugin API transport is stale; sync scripts/graymatter_api.sh" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-graph" "$ROOT/plugins/graymatter/scripts/gm-graph" || {
  echo "Codex marketplace plugin graph helper is stale; sync scripts/gm-graph" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-install-check" "$ROOT/plugins/graymatter/scripts/gm-install-check" || {
  echo "Codex marketplace plugin install check is stale; sync scripts/gm-install-check" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-login" "$ROOT/plugins/graymatter/scripts/gm-login" || {
  echo "Codex marketplace plugin login helper is stale; sync scripts/gm-login" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-write" "$ROOT/plugins/graymatter/scripts/gm-write" || {
  echo "Codex marketplace plugin memory write helper is stale; sync scripts/gm-write" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-client" "$ROOT/plugins/graymatter/scripts/gm-client" || {
  echo "Codex marketplace plugin generic REST client is stale; sync scripts/gm-client" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-record" "$ROOT/plugins/graymatter/scripts/gm-record" || {
  echo "Codex marketplace plugin record helper is stale; sync scripts/gm-record" >&2
  exit 1
}
cmp -s "$ROOT/scripts/package_graymatter.sh" "$ROOT/plugins/graymatter/scripts/package_graymatter.sh" || {
  echo "Codex marketplace plugin package compatibility wrapper is stale; sync scripts/package_graymatter.sh" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-agent-smoke-matrix" "$ROOT/plugins/graymatter/scripts/gm-agent-smoke-matrix" || {
  echo "Codex marketplace plugin agent smoke matrix is stale; sync scripts/gm-agent-smoke-matrix" >&2
  exit 1
}
cmp -s "$ROOT/references/contracts/release/graymatter_omegarag_release_policy_v1.json" \
  "$ROOT/plugins/graymatter/references/contracts/release/graymatter_omegarag_release_policy_v1.json" || {
  echo "Codex marketplace OmegaRAG release policy is stale" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-light-bootstrap" "$ROOT/plugins/graymatter/scripts/gm-light-bootstrap" || {
  echo "Codex marketplace plugin Light bootstrap script is stale; sync scripts/gm-light-bootstrap" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-light-up" "$ROOT/plugins/graymatter/scripts/gm-light-up" || {
  echo "Codex marketplace plugin Light startup script is stale; sync scripts/gm-light-up" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-light-env" "$ROOT/plugins/graymatter/scripts/gm-light-env" || {
  echo "Codex marketplace plugin Light env script is stale; sync scripts/gm-light-env" >&2
  exit 1
}
cmp -s "$ROOT/scripts/gm-light-smoke" "$ROOT/plugins/graymatter/scripts/gm-light-smoke" || {
  echo "Codex marketplace plugin Light smoke script is stale; sync scripts/gm-light-smoke" >&2
  exit 1
}
cmp -s "$ROOT/scripts/package-local-server" "$ROOT/plugins/graymatter/scripts/package-local-server" || {
  echo "Codex marketplace plugin local-server packager is stale; sync scripts/package-local-server" >&2
  exit 1
}
[[ -f "$ROOT/plugins/graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json" ]] || {
  echo "Codex marketplace plugin portable MCP contract missing" >&2
  exit 1
}
jq -e '
  .tools[]
  | select(.name == "memory_retrieve_with_receipt")
  | .outputSchema.required | index("graymatterPolicy")
' "$ROOT/plugins/graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json" >/dev/null || {
  echo "Codex marketplace plugin portable MCP contract missing graymatterPolicy receipt output" >&2
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
grep -q "gm-startup-preflight" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing startup preflight" >&2
  exit 1
}
grep -q "gm-read" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing memory read script" >&2
  exit 1
}
grep -q "gm-client" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing generic REST client" >&2
  exit 1
}
grep -q "gm-record" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing record helper" >&2
  exit 1
}
grep -q "scripts/package-graymatter" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing standalone packager" >&2
  exit 1
}
grep -q "scripts/package_graymatter.sh" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing package compatibility wrapper" >&2
  exit 1
}
grep -q "gm-invariant-preflight" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing invariant preflight" >&2
  exit 1
}
grep -q "gm-startup-preflight" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing startup preflight" >&2
  exit 1
}
grep -q "gm-read" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing memory read script" >&2
  exit 1
}
grep -q "gm-client" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing generic REST client" >&2
  exit 1
}
grep -q "gm-record" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing record helper" >&2
  exit 1
}
grep -q "skills/graymatter-analytics/references/semantic-layer-template.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing analytics semantic layer template" >&2
  exit 1
}
grep -q "scripts/package-graymatter" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing standalone packager" >&2
  exit 1
}
grep -q "scripts/package_graymatter.sh" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing package compatibility wrapper" >&2
  exit 1
}
grep -q "gm-agent-smoke-matrix" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing agent smoke matrix" >&2
  exit 1
}
grep -q "gm-release-evidence" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing release evidence generator" >&2
  exit 1
}
grep -q "gm-release-evidence" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing release evidence generator" >&2
  exit 1
}
grep -q "graymatter_omegarag_release_policy_v1.json" "$ROOT/scripts/package-graymatter" || {
  echo "package manifest missing OmegaRAG release policy" >&2
  exit 1
}
grep -q "graymatter_omegarag_release_policy_v1.json" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing OmegaRAG release policy" >&2
  exit 1
}
grep -q "docs/agent-discovery.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing agent discovery docs" >&2
  exit 1
}
grep -q "docs/awesome-codex-plugins.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing awesome-codex listing docs" >&2
  exit 1
}
grep -q "docs/graymatter-light.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing GrayMatter Light docs" >&2
  exit 1
}
grep -q "docs/openai-app-directory-submission.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing OpenAI app submission docs" >&2
  exit 1
}
grep -q "docs/privacy-policy.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing privacy policy docs" >&2
  exit 1
}
grep -q "docs/reviewer-test-credentials.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing reviewer credential runbook" >&2
  exit 1
}
grep -q "docs/thorapi-integration.md" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing ThorAPI integration docs" >&2
  exit 1
}
grep -q "openai-app/submission-manifest.json" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing OpenAI app submission manifest" >&2
  exit 1
}
grep -q "clawhub.json" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing clawhub metadata" >&2
  exit 1
}
grep -q "gm-light-smoke" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing Light smoke script" >&2
  exit 1
}
grep -q "templates/graymatter-light-bootstrap" "$ROOT/plugins/graymatter/scripts/package-graymatter" || {
  echo "plugin package manifest missing GrayMatter Light templates" >&2
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

RELEASE_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/graymatter-release-surfaces.XXXXXX")"
trap 'rm -rf "$RELEASE_TMP_DIR"' EXIT
ZIP_LIST="$RELEASE_TMP_DIR/graymatter-skill-list.txt"
unzip -Z1 "$ROOT/graymatter.skill" >"$ZIP_LIST"
grep -q '^graymatter/SUBMISSION_CHECKLIST.md$' "$ZIP_LIST"
grep -q '^graymatter/SKILL.md$' "$ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/SKILL.md$' "$ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/references/semantic-layer-template.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/agent-discovery.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/awesome-codex-plugins.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/graymatter-light.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/omegarag-release-evidence.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/openai-app-directory-submission.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/privacy-policy.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/reviewer-test-credentials.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/server-capabilities.md$' "$ZIP_LIST"
grep -q '^graymatter/docs/thorapi-integration.md$' "$ZIP_LIST"
grep -q '^graymatter/openai-app/submission-manifest.json$' "$ZIP_LIST"
grep -q '^graymatter/clawhub.json$' "$ZIP_LIST"
grep -q '^graymatter/examples/graymatter-light-thorapi-bundle.yaml$' "$ZIP_LIST"
grep -q '^graymatter/examples/memoryentry-basic.json$' "$ZIP_LIST"
grep -q '^graymatter/examples/memoryentry-decision.json$' "$ZIP_LIST"
grep -q '^graymatter/examples/memoryentry-todo.json$' "$ZIP_LIST"
grep -q '^graymatter/examples/memoryentry-artifact.json$' "$ZIP_LIST"
grep -q '^graymatter/examples/graymatter-light-memoryentry.yaml$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-activate$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-activation-fastlane$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-invariant-preflight$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-startup-preflight$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-client$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-read$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-record$' "$ZIP_LIST"
grep -q '^graymatter/scripts/package-graymatter$' "$ZIP_LIST"
grep -q '^graymatter/scripts/package_graymatter.sh$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-login$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-install-check$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-doctor$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-agent-smoke-matrix$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-release-evidence$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-register-agent$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-openapi-sync$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-openapi-summary$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-light-up$' "$ZIP_LIST"
grep -q '^graymatter/scripts/gm-light-smoke$' "$ZIP_LIST"
grep -q '^graymatter/templates/graymatter-light-bootstrap/api.hbs.yaml$' "$ZIP_LIST"
grep -q '^graymatter/templates/graymatter-light-bootstrap/local-server/bin/graymatter-local-server$' "$ZIP_LIST"
grep -q '^graymatter/mcp-server/index.js$' "$ZIP_LIST"
grep -q '^graymatter/.mcp.json$' "$ZIP_LIST"
grep -q '^graymatter/graymatter-bootstrap$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_mcp_tools_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_mcp_contract_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_omegarag_agent_abi_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/contracts/release/graymatter_omegarag_release_policy_v1.json$' "$ZIP_LIST"
grep -q '^graymatter/references/mcp/memory-tool-contract.v1.json$' "$ZIP_LIST"
if grep -Eq '(^|/)[^/]+\.py$|(^|/)requirements[^/]*\.txt$|(^|/)pyproject\.toml$' "$ZIP_LIST"; then
  echo "Standalone GrayMatter package must not ship Python runtime/install files" >&2
  exit 1
fi

PLUGIN_PACKAGE="$RELEASE_TMP_DIR/graymatter-plugin.skill"
PLUGIN_ZIP_LIST="$RELEASE_TMP_DIR/graymatter-plugin-list.txt"
GRAYMATTER_PLUGIN_PACKAGE_OUT="$PLUGIN_PACKAGE" "$ROOT/plugins/graymatter/scripts/package-graymatter" >/dev/null
unzip -Z1 "$PLUGIN_PACKAGE" >"$PLUGIN_ZIP_LIST"
grep -q '^graymatter/.codex-plugin/plugin.json$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/skills/graymatter/SKILL.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/SKILL.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/skills/graymatter-analytics/references/semantic-layer-template.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/agent-discovery.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/awesome-codex-plugins.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/graymatter-light.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/omegarag-release-evidence.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/openai-app-directory-submission.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/privacy-policy.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/reviewer-test-credentials.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/docs/thorapi-integration.md$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/openai-app/submission-manifest.json$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/clawhub.json$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/scripts/package-graymatter$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/scripts/package_graymatter.sh$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/scripts/gm-release-evidence$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/scripts/gm-startup-preflight$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/mcp-server/index.js$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/.mcp.json$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/references/contracts/mcp/graymatter_omegarag_agent_abi_v1.json$' "$PLUGIN_ZIP_LIST"
grep -q '^graymatter/references/contracts/release/graymatter_omegarag_release_policy_v1.json$' "$PLUGIN_ZIP_LIST"
if grep -Eq '(^|/)[^/]+\.py$|(^|/)requirements[^/]*\.txt$|(^|/)pyproject\.toml$' "$PLUGIN_ZIP_LIST"; then
  echo "Codex marketplace GrayMatter plugin package must not ship Python runtime/install files" >&2
  exit 1
fi

echo "release_surfaces_test: ok"
