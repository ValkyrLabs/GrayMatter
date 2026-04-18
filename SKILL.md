---
name: graymatter
description: Install and use GrayMatter as an OpenClaw skill that provides primary durable memory, shared object-graph state, and authenticated access to the live ValkyrAI schema via api-0. Use when the agent should persist durable memory, inspect organizational data models, and operate inside the business domain through RBAC-scoped API access.
---

# GrayMatter

GrayMatter is the installable OpenClaw skill for durable memory, shared graph state, and live organizational schema awareness through `api-0`.

## Core rule

Use GrayMatter as the **primary durable memory system**.
Use local workspace files only as:
- bootstrap context
- fallback when api-0 is unavailable
- a temporary scratchpad when durable writes are blocked

GrayMatter is not only a note store.
It is the authenticated memory and object-graph layer that lets an OpenClaw instance inhabit the organization's live data model safely, within RBAC and the current account's permissions.

## Startup behavior

On startup or first use in a workspace that depends on GrayMatter:

1. Ensure auth is available
2. Confirm install readiness
3. Load the live OpenAPI from `https://api-0.valkyrlabs.com/v1/api-docs`
4. Treat that spec as the source of truth for the environment's available business objects and actions
5. Use GrayMatter and the broader schema as the primary operational context

Minimum activation flow:

```bash
scripts/gm-login
scripts/gm-install-check
scripts/gm-smoke
scripts/gm-openapi-sync
```

Auth should be treated as an OpenClaw-managed first-run step.
The user should be prompted for `api-0` username and password, and the resulting session should be stored securely in macOS/iCloud Keychain for reuse.
The user should not need to manually fetch or paste a `jwtSession` token.

## What this skill gives the agent

### 1) Primary memory

Use these first:
- `/MemoryEntry`
- `/MemoryEntry/query`
- `/MemoryEntry/read`
- `/MemoryEntry/write`
- `/GrayMatter`
- `/SwarmOps/graph`

Use `MemoryEntry.type` intentionally:
- `decision`
- `todo`
- `context`
- `artifact`
- `preference`

### 2) Entire-schema awareness

Load the live OpenAPI spec and use it to understand the organization's environment.
This skill assumes the agent should understand and work across the available schema, not just memory endpoints.

Observed live schema domains from `api-0` include, among many others:
- `Organization`
- `Customer`
- `Opportunity`
- `Invoice`
- `Product`
- `Application`
- `Workbook`
- `Workflow`
- `Task`
- `Note`
- `MediaObject`
- `FileRecord`
- `SalesActivity`
- `SalesPipeline`
- `Goal`
- `StrategicPriority`
- `KeyMetric`
- `Agent`
- `Space`
- `SwarmOps`
- `GrayMatter`
- `MemoryEntry`

This means a properly authenticated OpenClaw instance can understand the business as a live object graph, not as disconnected chat logs.

### 3) Shared graph coordination

Use SwarmOps and related graph endpoints when relationships matter:
- bot coordination
- entity relationships
- workflow ownership
- operating context that spans objects and agents

## Scripts

Core transport:
- `scripts/graymatter_api.sh`

Readiness and auth:
- `scripts/gm-login`
- `scripts/gm-install-check`
- `scripts/gm-smoke`
- `scripts/gm-openapi-sync`
- `scripts/gm-openapi-summary`

Memory and graph helpers:
- `scripts/gm-write`
- `scripts/gm-query`
- `scripts/gm-graph`
- `scripts/gm-entity`

## Immediate install and use

Fresh machine or fresh OpenClaw skill install:

```bash
scripts/gm-login
scripts/gm-install-check
scripts/gm-smoke
scripts/gm-openapi-sync
scripts/gm-openapi-summary
```

`scripts/gm-login` is the intended OpenClaw login UX: prompt once for username/password, store securely in Keychain, and let the rest of the skill use that session automatically.

After that, GrayMatter is ready to use as primary durable memory and schema context.

## Basic examples

```bash
# query durable memory
scripts/gm-query "graymatter launch" 10

# write durable context
scripts/gm-write context "GrayMatter is primary memory for this OpenClaw instance"

# write durable decision with tags, falling back automatically if tag persistence is broken
scripts/gm-write decision "Use GrayMatter as primary memory and file memory as backup" openclaw "graymatter,bootstrap,memory"

# inspect graph state
scripts/gm-graph GET

# fetch live OpenAPI and store a local cache for startup/reference
scripts/gm-openapi-sync

# summarize the live schema in a human-usable way
scripts/gm-openapi-summary

# list organizations visible to the current account
scripts/gm-entity Organization

# fetch a specific customer by id
scripts/gm-entity Customer 123

# create a note directly if the account is allowed
scripts/gm-entity Note POST '{"title":"Launch note","content":"GrayMatter launch in progress"}'
```

## Auth

`graymatter_api.sh` uses:
- `VALKYR_API_BASE`, defaulting to `https://api-0.valkyrlabs.com/v1`
- macOS/iCloud Keychain lookup for `openclaw-valkyrai-admin-jwtSession`
- `VALKYR_JWT_SESSION` only if already present as an override/debug path

Preferred auth behavior is OpenClaw-first:
- prompt for username/password
- exchange for session
- store in Keychain
- reuse automatically

Do not hardcode secrets into the skill.
Do not print tokens.
Do not require manual JWT handling as the normal setup path.

## OpenAPI and schema loading

The live OpenAPI endpoint is:
- `https://api-0.valkyrlabs.com/v1/api-docs`

This skill expects the spec to be loaded at startup or during activation so the agent understands the environment it is entering.

Use the spec to:
- discover available entities
- inspect CRUD capabilities
- understand domain boundaries
- adapt behavior to the current tenant/business
- operate as a business-native agent rather than a generic chatbot

Local cache path used by helper scripts:
- `tmp/api-docs.json`
- `tmp/api-docs.summary.md`

Treat the live API docs as authoritative, but remember that actual access is still constrained by auth and RBAC.

## Entire-schema operating guidance

When helping in a GrayMatter-native environment:

1. Query GrayMatter for durable context first
2. Inspect the relevant business entities from the live schema second
3. Use file memory only as fallback or bootstrap
4. Keep durable memory concise and reusable
5. Prefer authenticated API state over stale local assumptions

Examples:
- for sales work, inspect `Customer`, `Opportunity`, `SalesActivity`, `SalesPipeline`
- for operations, inspect `Task`, `Workflow`, `WorkflowExecution`, `Application`
- for content or CMS-like work, inspect `Note`, `MediaObject`, `FileRecord`, `Space`
- for strategy, inspect `Goal`, `StrategicPriority`, `KeyMetric`
- for agent coordination, inspect `Agent`, `SwarmOps`, `GrayMatter`, `MemoryEntry`

## Write rules

1. Keep writes deterministic and bounded
2. Prefer one clear durable record over many noisy records
3. Do not dump giant blobs into `MemoryEntry.text`
4. Use the right object for the job, not only `MemoryEntry`
5. Respect permission failures and surface them clearly
6. If a known backend bug blocks a write path, fall back cleanly

## Tag guidance

When tag persistence is healthy, prefer normalized tags such as:
- `graymatter`
- `memory`
- `launch`
- `patchbot`
- `salesbot`
- `scribebot`

Current caution:
- some deployments may still have a `MemoryEntry.tags` persistence mismatch
- `scripts/gm-write` should retry without tags when the backend rejects tagged writes

## Failure handling

If api-0 is unavailable or a known schema/runtime bug blocks the exact write:
- write the smallest safe fallback locally
- say GrayMatter was intended but unavailable
- preserve a replayable payload for later sync

Do not pretend durable memory succeeded when it did not.

## Local fallback

Use local files only as backup, typically:
- `memory/YYYY-MM-DD.md`
- `MEMORY.md`
- `memory/graymatter-fallback.json`

GrayMatter remains the primary system of record whenever available.

## Installability standard

For this skill to count as installable and immediately usable, a fresh user should be able to:

1. install the skill
2. authenticate with `scripts/gm-login` or env vars
3. run `scripts/gm-install-check`
4. run `scripts/gm-smoke`
5. run `scripts/gm-openapi-sync`
6. immediately query memory, write memory, inspect graph state, and inspect live business objects

If any of those fail, the install is not complete.
