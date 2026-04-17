# GrayMatter and ThorAPI

## Relationship

ThorAPI is the generator and schema engine.
GrayMatter is the durable memory product/system.

In practice:
- ValkyrAI production endpoints expose GrayMatter capabilities through api-0
- ThorAPI provides the schema-driven path to generate and evolve a local/light version cleanly

## Why cross-link them

Without ThorAPI, GrayMatter looks like a set of endpoints and helper scripts.
With ThorAPI, GrayMatter becomes legible as a generated, spec-driven memory system with a clean evolution path.

## Relevant ThorAPI notes

ThorAPI supports an OpenAPI templating and bundle assembly workflow.
Important pieces in the current ValkyrAI tree include:
- `ValkyrAI/thorapi/src/main/resources/openapi/api.yaml`
- `ValkyrAI/thorapi/src/main/resources/openapi/api.hbs.yaml`
- `ValkyrAI/thorapi/src/main/resources/openapi/bundles/`

Bundle assembly can be enabled so bundle-generated components merge into the assembled spec before enhancement/generation.

## Recommended GrayMatter Light approach

Build GrayMatter Light as a tiny ThorAPI-shaped surface with:
- one core model: `MemoryEntry`
- minimal CRUD
- one simple query path
- no graph requirement for v1

This should probably start as either:
- a dedicated ThorAPI bundle, or
- a small focused spec that ThorAPI can generate into a local runnable service

## Suggested v1 surface

Models:
- `MemoryEntry`

Fields:
- `id`
- `type`
- `text`
- `sourceChannel`
- `createdDate`
- `modifiedDate`

Paths:
- `POST /MemoryEntry`
- `GET /MemoryEntry/{id}`
- `POST /MemoryEntry/query`
- optional `PATCH /MemoryEntry/{id}`

## Practical cross-links for this repo

This repo should keep linking back to ThorAPI concepts explicitly:
- architecture docs should explain that Light mode is ThorAPI-powered
- examples should include a starter `MemoryEntry` spec/bundle sketch
- future local runnable sample should state exactly which ThorAPI inputs generate it

## Why this is the right split

Cloud mode solves shared durable memory.
Light mode solves developer adoption, demos, offline fallback, and local trust-building.
ThorAPI is the bridge that keeps Light mode principled instead of becoming a random sidecar implementation.
