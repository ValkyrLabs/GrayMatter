# GrayMatter architecture

## Overview

GrayMatter is the durable memory and RBAC-scoped object-graph layer for business-native agent workflows.

It separates into two practical operating modes:
- **Cloud** for shared production memory and graph state
- **Light** for local/offline `MemoryEntry`-first memory

That split is intentional. Cloud mode gives agents the live, authenticated business context they need in production; Light mode keeps the local path small enough to run, inspect, and trust quickly.

## Core concepts

### MemoryEntry

`MemoryEntry` is the base durable memory primitive.

Recommended durable types:
- `decision`
- `todo`
- `context`
- `artifact`
- `preference`

Design goal:
- short, explicit, reusable memory items
- not giant transcripts
- not vague chat residue
- easy to replay or migrate between Light and Cloud

### Graph state

Graph state is the RBAC-visible object layer exposed by the live ValkyrAI schema.
Use it when relations matter, not just isolated memory entries.

Examples:
- customers, opportunities, invoices, products, files, goals, and tasks
- workflow ownership
- bot coordination
- entity relationships
- operational state that links multiple objects

Recommended concurrency split:
- use `MemoryEntry` for compact facts, decisions, todos, artifacts, and handoffs
- use the broader schema as the object graph for business records, ownership, dependencies, and multi-object workflow coordination
- use SwarmOps specifically for agent registration, agentic tracking, and swarm coordination between agents

## Mode 1: GrayMatter Cloud

Backed by production ValkyrAI/api-0 endpoints.

Primary endpoints:
- `/MemoryEntry`
- `/MemoryEntry/query`
- `/graymatter-retrieval-receipts`

Primary object-graph source:
- live `api-0` OpenAPI schema, bounded by the authenticated account's RBAC

### Retrieval Receipts

Retrieval Receipts are the trust-aware memory lookup path. Raw `MemoryEntry/query` remains useful for direct search, but agents should use `/graymatter-retrieval-receipts` when they plan to answer from retrieved memory.

A receipt captures:
- what query and strategy were used
- which records were found
- score, freshness, source diversity, coverage, authority, completeness, and contradiction signals
- RBAC, tenant-scope, and redaction decisions
- `answerPolicy` and `recommendedAction`
- `receiptId` and `traceId` for answer/audit linkage

The MCP layer exposes this as `memory_retrieve_with_receipt`, `retrieval_receipt_get`, and `retrieval_receipt_query`. It does not reimplement scoring locally; it calls the ThorAPI receipt endpoint and returns the generated transaction object.

Use Cloud mode when you need:
- shared durable memory
- cross-agent coordination
- graph-backed operational state
- production auth and centralized persistence
- live schema awareness across the organization's available business objects

Default auth posture for Cloud mode:
- prompt the user once for api-0 username/password
- exchange for session
- store the session securely in macOS/iCloud Keychain
- reuse it automatically on later runs

Manual JWT handling is a fallback and debugging path, not the normal user experience.

## Mode 2: GrayMatter Light

A local/offline mode built around a minimal ThorAPI-powered `MemoryEntry` surface.

Target characteristics:
- minimal schema
- easy local startup
- no required external auth
- small demo/dev footprint
- straightforward upgrade path to cloud mode

Use Light mode when you need a local demo, offline development loop, or resilient fallback. Keep it centered on durable memory; do not expand it into a full copy of the production object graph.

## Design principles

1. **Memory first**
   Start with `MemoryEntry`. Do not overbuild graph complexity into the light path.

2. **Deterministic writes**
   Prefer short, structured, durable facts.

3. **Production and local parity where it matters**
   Keep the local model conceptually aligned with the cloud model so data and habits transfer cleanly.

4. **Graceful fallback**
   If cloud writes fail, keep a viable local/offline path.

5. **ThorAPI-native evolution**
   Use ThorAPI as the generator and schema backbone for the light path.

## Recommended repo direction

Current repo direction:
- keep the skill and shell helpers production-ready
- keep the mode split clear: hosted api-0 for Cloud, local ThorAPI for Light
- keep `gm-light-up` as the runnable GrayMatter Light local service
- keep the generated `api.hbs.yaml` template, rendered `api.yaml`, and MCP contract mapping in sync
- include query/create demos and migration notes from Light to Cloud
