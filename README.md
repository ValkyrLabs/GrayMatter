# GrayMatter

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
