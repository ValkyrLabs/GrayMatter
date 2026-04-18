# GrayMatter

> ClawHub draft metadata
>
> - **Slug:** `graymatter`
> - **Name:** `GrayMatter`
> - **Version:** `0.1.0`
> - **Tags:** `memory,durable-memory,multi-agent,graph,valkyr,latest`
> - **Suggested changelog:** `Initial public release with install-check, smoke-test, tagged-write fallback, and multi-agent guidance`

GrayMatter is the durable memory layer for Valkyr-style agentic systems.

This repo now covers two modes:
- **GrayMatter Cloud**: production-backed memory and graph operations through `api-0`
- **GrayMatter Light**: an offline/local ThorAPI-powered concept centered on a minimal `MemoryEntry` model for demos, local dev, and resilient fallback paths

## Why this exists

Most agent systems can talk, but they do not remember well.
GrayMatter is the layer for durable, reusable context:
- decisions
- todos
- reusable context
- artifacts
- preferences
- graph-linked operational state

The goal is not chat history. The goal is durable operating memory.

## Repo structure

- `SKILL.md` — OpenClaw AgentSkill instructions
- `scripts/graymatter_api.sh` — raw API transport for production mode
- `scripts/gm-write` — helper to write a `MemoryEntry`
- `scripts/gm-query` — helper to query memory
- `scripts/gm-graph` — helper for graph endpoints
- `scripts/gm-install-check` — prerequisite and auth readiness check
- `scripts/gm-smoke` — one-command smoke test for auth, write, and query
- `docs/architecture.md` — mode split, data model, and operating model
- `docs/thorapi-integration.md` — how GrayMatter connects to ThorAPI
- `docs/graymatter-light.md` — offline/local light-mode plan
- `examples/memoryentry-basic.json` — minimal production payload example
- `examples/graymatter-light-memoryentry.yaml` — starter ThorAPI bundle sketch for local mode
- `graymatter.skill` — packaged distributable AgentSkill

## Quickstart

### Production mode

Use api-0 for durable shared memory and graph operations.

```bash
scripts/gm-write decision "Use api-0 GrayMatter as primary durable memory"
scripts/gm-query "graymatter" 10
scripts/gm-graph GET
```

Auth sources:
- `VALKYR_JWT_SESSION`
- macOS Keychain lookup for `openclaw-valkyrai-admin-jwtSession`

Base URL default:
- `https://api-0.valkyrlabs.com/v1`

## Customer-ready setup recipe

If you want a second OpenClaw instance, bot, or customer deployment to use GrayMatter, **making this repo public is not enough by itself**. Public repo access shares the code, not the credentials or runtime wiring.

A working GrayMatter setup requires all of the following:

1. **Install the GrayMatter skill/repo** on the target machine
2. **Provide valid auth** for the GrayMatter backend
3. **Ensure network access** to the GrayMatter API
4. **Tell the agent to use GrayMatter** for durable memory and handoffs
5. **Verify read/write success** with a smoke test

### Minimum requirements

The target machine needs:
- `bash`
- `curl`
- `jq`
- access to this repo/skill
- access to the GrayMatter backend, usually `https://api-0.valkyrlabs.com/v1`
- a valid JWT session token for ValkyrAI/api-0

The core scripts in this repo are thin wrappers around authenticated API calls:
- `scripts/graymatter_api.sh`
- `scripts/gm-write`
- `scripts/gm-query`
- `scripts/gm-graph`

If auth is missing, `graymatter_api.sh` fails immediately.

### Auth configuration

GrayMatter production mode expects one of these:

1. `VALKYR_JWT_SESSION` environment variable, recommended for servers and non-macOS installs
2. macOS Keychain secret named `openclaw-valkyrai-admin-jwtSession`

Optional override:
- `VALKYR_API_BASE` if you are not using the default production API base

Example:

```bash
export VALKYR_API_BASE="https://api-0.valkyrlabs.com/v1"
export VALKYR_JWT_SESSION="<your-jwt-session-token>"
```

### 5-minute setup for a second OpenClaw instance

1. **Clone or install GrayMatter** on the new machine
2. **Install dependencies** if missing:
   ```bash
   brew install jq
   ```
   (`curl` is usually already present)
3. **Set credentials**:
   - export `VALKYR_JWT_SESSION`, or
   - store the token in macOS Keychain under `openclaw-valkyrai-admin-jwtSession`
4. **Run the install/readiness check**:
   ```bash
   scripts/gm-install-check
   ```
5. **Run the one-command smoke test**:
   ```bash
   scripts/gm-smoke
   ```
6. **Update the agent instructions** so the OpenClaw instance knows to use GrayMatter as its durable shared memory layer

### OpenClaw operator checklist

For a new OpenClaw instance named `valor`, the repeatable recipe is:

- install OpenClaw
- install or copy in the GrayMatter skill/repo
- configure `VALKYR_JWT_SESSION`
- optionally configure `VALKYR_API_BASE`
- make sure the instance can reach api-0
- give the agent an instruction such as:
  - "Use GrayMatter as the primary durable memory and shared handoff layer"
- verify with `gm-install-check` and `gm-smoke`

### What is not enough

These steps **alone** are not enough:
- making the repo public
- telling another agent to "install the skill"
- inviting another Discord bot into the same server

Those steps distribute code or presence, but they do **not** provide:
- backend credentials
- API connectivity
- memory conventions
- successful read/write verification

### Recommended customer handoff language

Use this wording when giving the setup to another operator or customer:

> Install the GrayMatter skill, set `VALKYR_JWT_SESSION`, confirm access to `VALKYR_API_BASE`, then run `scripts/gm-install-check` and `scripts/gm-smoke` to verify the instance can use durable memory successfully. Repo access alone is not sufficient.

### Multi-agent note

If multiple OpenClaw instances share the same GrayMatter backend, they can coordinate through shared durable memory without needing direct bot-to-bot Discord chatter.

Recommended practice:
- give each agent a distinct identity
- write durable decisions and handoffs to GrayMatter
- use Discord for human interaction, not as the primary machine memory layer

## Installation paths

GrayMatter can be delivered in two practical ways:

### Sample customer OpenClaw config snippet

Use this as a minimal environment-oriented pattern for a customer or second instance:

```yaml
# example only, adapt to your OpenClaw config layout
agent:
  name: valor

env:
  VALKYR_API_BASE: https://api-0.valkyrlabs.com/v1
  VALKYR_JWT_SESSION: ${VALKYR_JWT_SESSION}

instructions: |
  Use GrayMatter as the primary durable memory and shared handoff layer.
  Persist durable decisions, todos, reusable context, and artifacts to GrayMatter.
```

If the deployment uses macOS Keychain instead of env vars, omit `VALKYR_JWT_SESSION` from config and install the secret locally.

### ClawHub publish command

When ready to publish from this repo folder:

```bash
clawhub publish ./GrayMatter \
  --slug graymatter \
  --name "GrayMatter" \
  --version 0.1.0 \
  --tags memory,durable-memory,multi-agent,graph,valkyr,latest \
  --changelog "Initial public release with install-check, smoke-test, tagged-write fallback, and multi-agent guidance"
```

If you want to validate auth first:

```bash
clawhub whoami
```

After publishing, recommend verifying with:

```bash
clawhub inspect graymatter
```

### Option 1: copy or clone the repo

Use this when you want the full repo, docs, examples, and scripts.

### Option 2: import the packaged skill

Use `graymatter.skill` when you want the minimal distributable AgentSkill payload.

Important:
- the packaged skill contains the agent instructions and helper scripts
- it does not contain your credentials
- importing the skill is still not enough unless auth and API access are configured

## Troubleshooting

### `VALKYR_JWT_SESSION is required`

Cause:
- no environment token is set, and no matching macOS Keychain secret was found

Fix:
- export `VALKYR_JWT_SESSION`, or
- add Keychain secret `openclaw-valkyrai-admin-jwtSession`

### `curl: command not found` or `jq: command not found`

Cause:
- machine is missing required CLI dependencies

Fix:
- install `curl` and `jq`

Example on macOS:
```bash
brew install jq
```

### tagged write fails

Cause:
- known backend `MemoryEntry.tags` persistence mismatch

Fix:
- use `scripts/gm-write` and let it retry automatically without tags
- do not block durable writes on the tag bug

### smoke test write succeeds but later coordination is messy

Cause:
- multiple agents are writing without stable conventions

Fix:
- use distinct agent identities
- standardize durable write style
- follow `references/multi-agent-conventions.md`

## Drop-in skill improvements included now

This repo now includes a few practical quality-of-life upgrades for repeatable deployment:
- `scripts/gm-install-check` for dependency and auth readiness checks
- `scripts/gm-smoke` for a single-command live readiness test
- `scripts/package_graymatter.py` for deterministic validation and packaging
- automatic fallback in `scripts/gm-write` when tagged writes fail because of the known backend tag persistence issue
- customer-ready setup instructions in this README
- clearer operator guidance in `SKILL.md`
- reference docs for public release and multi-agent conventions

### Light mode

GrayMatter Light is the local/offline track.

Target shape:
- ThorAPI-powered
- minimal `MemoryEntry` entity
- basic create/get/query flow
- easy local boot for demos, tests, and offline resilience

This mode is documented in `docs/graymatter-light.md`.

## Operating model

### GrayMatter Cloud

Use this when you need:
- shared durable memory across agents
- production graph state
- authenticated writes to api-0
- coordination across sessions, bots, or workflows

### GrayMatter Light

Use this when you need:
- local demos
- offline development
- a tiny memory service with minimal moving parts
- a fallback path when production dependencies are unavailable

## ThorAPI relationship

GrayMatter should be easy to explain as a ThorAPI-shaped system, not a mystery box.

Current relationship:
- production GrayMatter capabilities are exposed through ValkyrAI/api-0 endpoints
- ThorAPI is the codegen and schema engine that can power a local/light memory service
- the light mode should use a tiny ThorAPI bundle or spec with a basic `MemoryEntry` model

See:
- `docs/thorapi-integration.md`
- `examples/graymatter-light-memoryentry.yaml`

## Known limitation

Some deployments currently have a `MemoryEntry.tags` persistence mismatch on the backend.

Practical rule:
- if tagged writes fail, write the durable fact first without tags
- treat tag normalization/schema repair as a backend fix, not a reason to abandon GrayMatter

## Quality bar

This repo is meant to grow into a serious foundation repo, not a one-off helper dump.

That means:
- clear mode separation
- tight docs
- explicit ThorAPI cross-linking
- minimal but real examples
- easy upgrade path from local memory to production memory

## Next upgrades

- add a tiny local ThorAPI bundle and runnable sample for GrayMatter Light
- add a simple smoke-test script for write/query flows
- add richer examples for decisions, todos, and artifacts
- add install notes for the packaged skill in OpenClaw environments
