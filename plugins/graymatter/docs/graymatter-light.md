# GrayMatter Light

## Intent

GrayMatter Light is the offline/local version of GrayMatter.

It exists for:
- demos
- local development
- resilient fallback
- easy experimentation with durable memory before wiring into api-0

Light mode is not the primary production experience.
For real OpenClaw deployments, the default path is GrayMatter Cloud with interactive username/password login and secure Keychain-backed session reuse.

## Current scope

Light mode is intentionally small. It gives developers and reviewers a local `MemoryEntry` surface that behaves like the production memory path where that matters, without requiring hosted auth.

Include:
- minimal `MemoryEntry` schema
- create
- get by id
- basic query
- optional update
- signed KnowledgePack import in the downloadable Java Local Server
- owner-scoped H2 retention of the complete portable graph and archive

Do not include in the generated ThorAPI/Docker subset:
- custom KnowledgePack import (use the downloadable Java Local Server)
- general-purpose mutable graph operations
- wide entity surface
- complex auth
- production-only integrations

## MemoryEntry model

```yaml
MemoryEntry:
  type: object
  properties:
    id:
      type: string
      format: uuid
    type:
      type: string
    text:
      type: string
    sourceChannel:
      type: string
    createdDate:
      type: string
      format: date-time
    modifiedDate:
      type: string
      format: date-time
```

## Why ThorAPI

ThorAPI gives Light mode:
- a schema-driven contract
- code generation alignment with the main platform style
- easier migration from local mode to cloud mode
- fewer hand-rolled one-off decisions

## Delivery shape

Available now:
- a documented Light-mode contract
- a starter ThorAPI bundle/spec example
- a local JSON-store smoke-test script for write/query validation

Runtime path:
- keep the api-0-shaped local service runnable with `scripts/gm-light-up`
- keep sample data and smoke-test commands aligned with the generated spec

Upgrade path:
- align payloads and migration paths with production GrayMatter

## Ideal developer experience

A developer should be able to:
1. clone the repo
2. start GrayMatter Light locally
3. write a decision or todo
4. query it back
5. later switch to Cloud mode with minimal changes to payload shape and workflow

## Included starter assets

This repo now includes:
- `examples/graymatter-light-thorapi-bundle.yaml` as a minimal local bundle surface
- `scripts/gm-light-json-smoke` as a JSON-file fallback smoke test for the local payload shape
- `scripts/gm-knowledge-pack-import` for signed `.gmkp` import into the downloadable Java Local Server
- `scripts/gm-light-bootstrap` to generate the app-factory bundle and local server source
- `scripts/gm-light-up` to start the actual ThorAPI-backed Light instance with Docker Compose
- `scripts/gm-light-env` to point normal GrayMatter skill scripts at the running Light instance
- `scripts/gm-light-smoke` to prove local write/query/health and print MCP-ready setup
- `scripts/package-local-server` to produce `dist/graymatter-local-server-latest.tar.gz`

`gm-light-up` creates the api.hbs.yaml template at `.graymatter-light/api.hbs.yaml`, rendered `.graymatter-light/api.yaml`, `docker-compose.yaml`, and `dashboard/index.html`, then runs the ThorAPI image with `THORAPI_TEMPLATE=/app/api.hbs.yaml` and `THORAPI_SPEC=/app/api.yaml`. The default image is `ghcr.io/valkyrlabs/thorapi:latest`; use `--image` or `THORAPI_IMAGE` when running a private, pinned, or locally built ThorAPI image. The generated contract is a subset of the real ValkyrAI api-0 contract: `/v1/MemoryEntry/write`, `/v1/MemoryEntry/query`, `/v1/MemoryEntry/read`, `/v1/MemoryEntry/{id}`, `/v1/memory/status`, `/v1/graymatter/stats`, `/v1/graymatter/activation/bridge`, `/v1/swarm-ops/graph`, and `/v1/api-docs`. The `.graymatter-light/.graymatter-light-env` file sets `VALKYR_API_BASE=http://localhost:8080/v1` and `GRAYMATTER_LIGHT_MODE=true`, so `gm-write`, `gm-query`, lower-level `graymatter_api.sh`, and the standalone MCP server connect to the running local instance instead of hosted api-0.

The generated local server archive remains the downloadable Spring Boot path. It includes local Basic auth, `Principal`, `UserPreferences`, `MemoryEntry`, signed KnowledgePack import and graph retention, a minimal `/v1/Workbook` API, a Valkyr Labs-branded dashboard, an activation bridge, and local `/v1/swarm-ops/graph` state. The generated `application-bundle/` records the api-0-compatible Light contract and built-in local assets.

## KnowledgePack import

Use the downloadable Java Local Server on port `8787` to load a `.gmkp`
archive produced by the GrayMatter homepage:

```bash
export GRAYMATTER_LIGHT_PUBLIC_BASE=http://localhost:8787
export GRAYMATTER_LIGHT_USERNAME=admin
read -rsp "GrayMatter Light password: " GRAYMATTER_LIGHT_PASSWORD
export GRAYMATTER_LIGHT_PASSWORD
scripts/gm-knowledge-pack-import ./my-pack.gmkp
```

The importer verifies ZIP safety and resource limits, manifest format/counts,
SHA-256 content integrity, and the Ed25519 manifest signature. It rejects
portable ownership, principal, tenant, ACL, and permission fields, assigns the
pack to the authenticated local principal, retains the complete archive and
graph in H2, and projects imported `MemoryEntry` objects into owner-scoped
local search. Embeddings are marked `regenerate-on-import`; source ACLs are
never transplanted.

The self-contained signature proves archive integrity, not a marketplace
publisher identity. Light therefore exposes `trustModel` and
`identityAssurance` explicitly. See [KnowledgePacks](knowledge-packs.md) for
the archive contract, API, trust boundary, limits, lifecycle, and verification
checklist.

## Local-to-full bridge

The light dashboard includes a `Promote / Synchronize` control. It calls `POST /v1/graymatter/activation/bridge/event` and returns a prepared handoff payload with:
- local bundle identity
- ThorAPI FEBE generation mode
- MemoryEntry and Workbook counts
- target `https://valkyrlabs.com`
- hosted API base `https://api-0.valkyrlabs.com/v1`
- required auth guidance through `VALKYR_AUTH_TOKEN` or hosted login

This button prepares synchronization; it does not pretend hosted sync completed without authenticated access to the mothership.

## Swarm Protocol status

Light mode now exposes the local node through `GET /v1/swarm-ops/graph`. The response advertises `graymatter-swarm-v0.1`, the local light-node id, SwarmOps-compatible graph shape, and the endpoints that connect the bundle to memory, workbooks, activation, and dashboard state.

## Recommendation

Keep Light small and dependable. It is the low-friction entry point for explaining, testing, and trusting GrayMatter before moving to Cloud mode.
