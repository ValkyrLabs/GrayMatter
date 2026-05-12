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

## Scope for v1

Keep it intentionally small.

Include:
- minimal `MemoryEntry` schema
- create
- get by id
- basic query
- optional update

Do not include in v1:
- full graph operations
- wide entity surface
- complex auth
- production-only integrations

## Proposed model

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

## Suggested delivery shape

Phase 1:
- document the concept clearly
- include a starter ThorAPI bundle/spec example
- include a local JSON-store smoke-test script for write/query validation

Phase 2:
- provide a tiny runnable local service
- add sample data and smoke-test commands

Phase 3:
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
- `scripts/gm-light-smoke` as a runnable local write/query smoke test
- `scripts/gm-light-bootstrap` to generate the app-factory bundle and local server source
- `scripts/gm-light-up` to start the actual ThorAPI-backed Light instance with Docker Compose
- `scripts/gm-light-env` to point normal GrayMatter skill scripts at the running Light instance
- `scripts/package-local-server` to produce `dist/graymatter-local-server-latest.tar.gz`

`gm-light-up` creates `.graymatter-light/api.hbs.yaml`, a rendered `.graymatter-light/api.yaml`, `docker-compose.yaml`, and `dashboard/index.html`, then runs `ghcr.io/valkyrlabs/thorapi:latest` with `THORAPI_SPEC=/app/api.hbs.yaml`. The generated ThorAPI contract includes `Principal`, `UserPreferences`, `MemoryEntry`, and `Workbook` surfaces plus the Light control-panel endpoints. The `.graymatter-light/.graymatter-light-env` file sets `VALKYR_API_BASE` and `GRAYMATTER_LIGHT_MODE=true`, so `gm-write`, `gm-query`, and lower-level `graymatter_api.sh` connect to the running local instance instead of hosted api-0.

The generated local server archive remains the downloadable Spring Boot path. It includes RBAC-backed login, `Principal`, `UserPreferences`, `MemoryEntry`, a minimal Data Workbooks `/Workbook` API, a Valkyr Labs-branded dashboard, a mothership promotion bridge, and a local GrayMatter SWARM v0.1 adapter. The generated `application-bundle/` records the ValkyrAI app-factory template, ThorAPI FEBE OpenAPI contract, custom components, and built-in `rbac-core` / `data-workbooks` references.

## Local-to-full bridge

The light dashboard includes a `Promote / Synchronize` control. It calls `POST /api/graymatter/sync/mothership` and returns a prepared handoff payload with:
- local bundle identity
- ThorAPI FEBE generation mode
- MemoryEntry and Workbook counts
- target `https://valkyrlabs.com`
- hosted API base `https://api-0.valkyrlabs.com/v1`
- required auth guidance through `VALKYR_AUTH_TOKEN` or hosted login

This button prepares synchronization; it does not pretend hosted sync completed without authenticated access to the mothership.

## Swarm Protocol status

Light mode now exposes the local node through `GET /api/graymatter/swarm/protocol`. The response advertises `graymatter-swarm-v0.1`, the local light-node id, SwarmOps-compatible graph shape, and the endpoints that connect the bundle to memory, workbooks, promotion, and dashboard state.

## Recommendation

Yes, we should build this.
It is the right low-friction entry point and makes GrayMatter easier to explain, test, and trust.
