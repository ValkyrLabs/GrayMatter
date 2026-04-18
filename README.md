# GrayMatter

GrayMatter is the durable memory layer for Valkyr-style agentic systems.

It supports two operating modes:
- **GrayMatter Cloud** for production-backed memory and graph operations through `api-0`
- **GrayMatter Light** for local and offline workflows built around a minimal `MemoryEntry` model

GrayMatter is designed for OpenClaw operators and agent systems that need durable shared memory for decisions, todos, reusable context, artifacts, preferences, and graph-linked operational state.

## Repository contents

- `SKILL.md` — OpenClaw AgentSkill instructions
- `graymatter.skill` — packaged distributable AgentSkill
- `scripts/graymatter_api.sh` — authenticated production API transport
- `scripts/gm-write` — write a `MemoryEntry`
- `scripts/gm-query` — query `MemoryEntry` records
- `scripts/gm-graph` — interact with graph endpoints
- `scripts/gm-login` — interactive login helper that retrieves `jwtSession`
- `scripts/gm-install-check` — dependency and auth readiness check
- `scripts/gm-smoke` — production write/query smoke test
- `scripts/gm-light-smoke` — local GrayMatter Light write/query smoke test
- `scripts/package_graymatter.py` — deterministic validation and packaging
- `docs/architecture.md` — architecture and operating model
- `docs/thorapi-integration.md` — ThorAPI relationship and bundle direction
- `docs/graymatter-light.md` — local and offline Light-mode notes
- `examples/memoryentry-basic.json` — minimal production payload example
- `examples/memoryentry-decision.json` — decision example
- `examples/memoryentry-todo.json` — todo example
- `examples/memoryentry-artifact.json` — artifact example
- `examples/graymatter-light-memoryentry.yaml` — starter Light-mode schema sketch
- `examples/graymatter-light-thorapi-bundle.yaml` — tiny ThorAPI-shaped bundle sample
- `references/public-release-checklist.md` — release checklist
- `references/multi-agent-conventions.md` — naming and write-style conventions for multi-agent deployments
- `clawhub.json` — ClawHub publishing metadata

## Quick start

### One-shot install and use

If you want an OpenClaw instance or other agentic system to adopt GrayMatter, the canonical flow is:

1. Install GrayMatter
2. Run `scripts/gm-login` and complete login, or set `VALKYR_JWT_SESSION` manually
3. Run `scripts/gm-install-check`
4. Run `scripts/gm-smoke`
5. Use GrayMatter as the durable memory and handoff layer

### Production mode

Use api-0 for durable shared memory and graph operations.

```bash
scripts/gm-write decision "Use GrayMatter as the primary durable memory layer"
scripts/gm-query "GrayMatter" 10
scripts/gm-graph GET
```

Default API base:
- `https://api-0.valkyrlabs.com/v1`

Auth sources:
- `VALKYR_JWT_SESSION`
- macOS Keychain secret `openclaw-valkyrai-admin-jwtSession`

### Local Light mode

Run the local smoke test to exercise a minimal write/query loop backed by a JSON store.

```bash
scripts/gm-light-smoke
```

## Agentic system installation

GrayMatter is designed for agentic systems, especially OpenClaw deployments and Claude Code style coding-agent environments.

GrayMatter can be used either from the full repository or from the packaged `graymatter.skill` artifact.

### Requirements

- `bash`
- `curl`
- `jq`
- access to the GrayMatter backend for Cloud mode
- a valid JWT session token for ValkyrAI/api-0 when using Cloud mode

### Environment configuration

Production mode expects one of the following:
- `VALKYR_JWT_SESSION` environment variable
- macOS Keychain secret `openclaw-valkyrai-admin-jwtSession`

Optional override:
- `VALKYR_API_BASE`
- `GRAYMATTER_LOGIN_PATH`, if the login endpoint differs from `/auth/login`

Simplest path:

```bash
eval "$(scripts/gm-login)"
```

This prompts for username and password, calls the login endpoint, retrieves `jwtSession`, and exports the required environment variables for the current shell.

Manual example:

```bash
export VALKYR_API_BASE="https://api-0.valkyrlabs.com/v1"
export VALKYR_JWT_SESSION="<your-jwt-session-token>"
```

### Installation flow

1. Clone the repository or import `graymatter.skill`
2. Install dependencies if needed
3. Run login or configure auth manually
4. Run the readiness check:
   ```bash
   scripts/gm-install-check
   ```
5. Run the production smoke test:
   ```bash
   scripts/gm-smoke
   ```
6. Instruct the agent to use GrayMatter for durable decisions, todos, context, artifacts, and handoffs

### Fresh-install validation steps

Use these exact steps on a fresh OpenClaw machine or test instance.

#### Repo-based install

```bash
git clone https://github.com/ValkyrLabs/GrayMatter.git
cd GrayMatter
brew install jq
eval "$(scripts/gm-login)"
scripts/gm-install-check
scripts/gm-smoke
scripts/gm-query "GrayMatter smoke test" 5
```

Expected result:
- `gm-install-check` reports dependency and auth success
- `gm-smoke` writes and queries a test `MemoryEntry`
- `gm-query` returns the smoke-test entry

#### Packaged-skill install

1. Import or place `graymatter.skill` into the target OpenClaw skills directory
2. Confirm the installed skill resolves to `graymatter/`
3. Run:
   ```bash
   eval "$(scripts/gm-login)"
   ```
4. From the installed skill directory, run:
   ```bash
   scripts/gm-install-check
   scripts/gm-smoke
   scripts/gm-query "GrayMatter smoke test" 5
   ```

Expected result:
- the installed skill can complete dependency, auth, write, and query validation

### OpenClaw config snippet

```yaml
agent:
  name: valor

env:
  VALKYR_API_BASE: https://api-0.valkyrlabs.com/v1
  VALKYR_JWT_SESSION: ${VALKYR_JWT_SESSION}

instructions: |
  Use GrayMatter as the primary durable memory and shared handoff layer.
  Persist durable decisions, todos, reusable context, and artifacts to GrayMatter.
```

If the deployment uses macOS Keychain instead of environment variables, omit `VALKYR_JWT_SESSION` from config and install the secret locally.

### Claude Code and coding-agent instructions

For Claude Code or similar coding-agent systems, provide the repository and these operating instructions:

```text
Use GrayMatter as the durable shared memory layer for this environment.
Persist durable decisions, todos, reusable context, artifacts, and handoff state to GrayMatter.
Before relying on GrayMatter, run scripts/gm-install-check and scripts/gm-smoke.
If tagged writes fail, use scripts/gm-write and allow the automatic untagged fallback.
Use chat or terminal output for ephemeral discussion, and GrayMatter for durable machine-readable memory.
```

Claude Code or similar agents also need:
- access to the GrayMatter repo or installed skill files
- `bash`, `curl`, and `jq`
- `scripts/gm-login`, `VALKYR_JWT_SESSION`, or the macOS Keychain secret
- network access to `VALKYR_API_BASE`

### Packaged skill notes

When using `graymatter.skill` in an OpenClaw environment:
- import or place the package in the target skills location
- ensure the installed skill resolves to the `graymatter/` folder name
- run `scripts/gm-login` or configure `VALKYR_JWT_SESSION` and optional `VALKYR_API_BASE` on the deployment machine
- run `scripts/gm-install-check`
- run `scripts/gm-smoke`

The skill package contains the instructions and helper scripts. Credentials remain external to the package.

## Multi-agent usage

If multiple OpenClaw agents share the same GrayMatter backend, use GrayMatter as the durable coordination layer.

Recommended practice:
- assign each agent a distinct identity
- write durable decisions and handoffs to GrayMatter
- use chat surfaces for human interaction rather than as the primary machine memory layer
- follow `references/multi-agent-conventions.md`

## Examples

### MemoryEntry examples

- `examples/memoryentry-basic.json`
- `examples/memoryentry-decision.json`
- `examples/memoryentry-todo.json`
- `examples/memoryentry-artifact.json`

### GrayMatter Light starter assets

- `examples/graymatter-light-memoryentry.yaml`
- `examples/graymatter-light-thorapi-bundle.yaml`

These assets provide a small ThorAPI-shaped starting point for local durable memory experiments.

## Troubleshooting

### `VALKYR_JWT_SESSION is required`

No environment token is set and no matching macOS Keychain secret was found.

Fix:
- export `VALKYR_JWT_SESSION`, or
- add Keychain secret `openclaw-valkyrai-admin-jwtSession`

### `curl: command not found` or `jq: command not found`

Required CLI dependencies are missing.

Fix:
- install `curl` and `jq`

Example on macOS:

```bash
brew install jq
```

### Tagged write fails

Some deployments currently have a `MemoryEntry.tags` persistence mismatch on the backend.

Fix:
- use `scripts/gm-write`
- the script automatically retries without tags when the backend rejects tagged writes

### Smoke test passes but coordination is still noisy

Multiple agents are writing without stable conventions.

Fix:
- assign stable agent identities
- standardize durable write style
- follow `references/multi-agent-conventions.md`

## Packaging and release

Rebuild and validate the packaged skill with:

```bash
python3 scripts/package_graymatter.py
```

ClawHub metadata is stored in `clawhub.json`.

Example publish command:

```bash
clawhub publish ./GrayMatter \
  --slug graymatter \
  --name "GrayMatter" \
  --version 0.1.0 \
  --tags memory,durable-memory,multi-agent,graph,valkyr,latest \
  --changelog "Initial public release with install-check, smoke-test, tagged-write fallback, and multi-agent guidance"
```

Recommended verification commands:

```bash
clawhub whoami
clawhub inspect graymatter
```

## Architecture

### GrayMatter Cloud

Use Cloud mode when you need:
- shared durable memory across agents
- production graph state
- authenticated writes to api-0
- coordination across sessions, bots, or workflows

### GrayMatter Light

Use Light mode when you need:
- local demos
- offline development
- a minimal memory surface with low setup overhead
- a fallback path when production dependencies are unavailable

GrayMatter Light is intentionally small. It is a proving ground for local development, not a replacement for Cloud mode.

## ThorAPI relationship

GrayMatter Cloud is exposed through ValkyrAI/api-0 endpoints.
GrayMatter Light is the local and offline track, shaped to align with ThorAPI-style schema and bundle workflows.

See:
- `docs/thorapi-integration.md`
- `docs/graymatter-light.md`
- `examples/graymatter-light-thorapi-bundle.yaml`
