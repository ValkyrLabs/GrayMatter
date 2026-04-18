---
name: graymatter
description: Use GrayMatter durable memory and graph through api-0 for authenticated reads and writes to MemoryEntry and SwarmOps graph. Use when storing durable decisions, todos, context, artifacts, or querying shared graph/memory state for ValkyrAI and swarm workflows.
---

# GrayMatter

Use GrayMatter through the production API on api-0.

If you need release or deployment guidance beyond the core workflow, read:
- `references/public-release-checklist.md` before publishing or handing the skill to customers
- `references/multi-agent-conventions.md` when multiple agents will share the same GrayMatter backend

## Core rule

Prefer GrayMatter for durable machine-readable memory and graph state.
Use local workspace files only as bootstrap or fallback when api-0 is unavailable or a known backend bug blocks the exact write path.

## Endpoints

Default base:
- `https://api-0.valkyrlabs.com/v1`

Primary paths:
- `/MemoryEntry`
- `/MemoryEntry/query`
- `/MemoryEntry/{id}`
- `/SwarmOps/graph`

## Scripts

Core transport:
- `scripts/graymatter_api.sh`

Helpers:
- `scripts/gm-write`
- `scripts/gm-query`
- `scripts/gm-graph`
- `scripts/gm-install-check`
- `scripts/gm-smoke`

Basic examples:

```bash
# query memory
scripts/gm-query "graymatter" 10

# create durable context
scripts/gm-write context "example durable memory"

# create durable decision
scripts/gm-write decision "Use api-0 GrayMatter as primary durable memory"

# create durable memory with tags, with automatic fallback if tag persistence is broken
scripts/gm-write context "launch handoff" discord "launch,graymatter"

# patch a memory entry directly
scripts/graymatter_api.sh PATCH /MemoryEntry/<id> '{"text":"updated text"}'

# read graph
scripts/gm-graph GET

# install/readiness check for dependencies + auth
scripts/gm-install-check

# smoke test auth + write + query
scripts/gm-smoke
```

## MemoryEntry guidance

Use `MemoryEntry.type` intentionally:
- `decision` for durable choices
- `todo` for actionable follow-ups
- `context` for reusable background state
- `artifact` for durable output references
- `preference` for stable user or system preferences

Prefer short, explicit text that can be reused later.
Do not dump giant blobs into `text` when a smaller durable summary would work better.

## Tag guidance

When tag persistence is healthy, prefer normalized tags for routing and retrieval.
Use stable tag names such as:
- `scribebot-marketing-skill`
- `patchbot`
- `salesbot`
- `launch`
- `graymatter`

Current caution:
- Some deployments may still have a `MemoryEntry.tags` persistence mismatch.
- `scripts/gm-write` now retries automatically without tags when the backend rejects tagged writes.
- Track the backend fix separately instead of blocking all memory use.

## Write rules

1. Keep writes deterministic and bounded.
2. Do not log or echo tokens.
3. Prefer one clean durable write over many noisy writes.
4. Use `sourceChannel` or equivalent source fields when available.
5. If a write fails because of the known tag relation bug, fall back to an untagged write and note the limitation.

## Auth

`graymatter_api.sh` uses:
- `VALKYR_API_BASE`, defaulting to api-0
- `VALKYR_JWT_SESSION` if already present
- macOS Keychain lookup for `openclaw-valkyrai-admin-jwtSession` if unset

Do not hardcode secrets into the skill.

## When to persist

Persist when you create or learn something durable, including:
- important decisions
- cross-agent coordination state
- launch plans or operating context worth reusing
- todo items that should survive the session
- reusable execution notes

Do not persist every transient thought or noisy debug trace.

## Failure handling

If api-0 is unavailable or returns a known schema/runtime error:
- save the smallest safe durable summary locally if needed
- report that GrayMatter was intended but blocked
- keep the write payload available for retry after the backend fix

## Drop-in setup check

For a new machine or customer deployment:
1. Install the skill/repo
2. Set `VALKYR_JWT_SESSION` or the macOS Keychain secret
3. Run `scripts/gm-install-check`
4. Run `scripts/gm-smoke`
5. Treat a successful smoke test as the minimum bar before relying on shared memory
