# GrayMatter and ThorAPI

## Relationship

ThorAPI is the generator and schema engine. GrayMatter is the durable memory product and operating layer for agents.

In the production OpenClaw flow, GrayMatter should also be the first-class authenticated context layer:
- user signs in with api-0 username/password
- OpenClaw stores the resulting session securely in macOS/iCloud Keychain
- GrayMatter then loads live schema context from the OpenAPI and operates inside that environment

In practice:
- ValkyrAI production endpoints expose GrayMatter capabilities through api-0
- ThorAPI provides the schema-driven path to generate and evolve a local/light version cleanly

## Why cross-link them

Without ThorAPI, GrayMatter can look like a set of endpoints and helper scripts. With ThorAPI, the local path becomes a generated, spec-driven memory system with a clean evolution path into the hosted product.

## Relevant ThorAPI notes

ThorAPI supports an OpenAPI templating and bundle assembly workflow.
Important pieces in the current ValkyrAI tree include:
- `ValkyrAI/thorapi/src/main/resources/openapi/api.yaml`
- `ValkyrAI/thorapi/src/main/resources/openapi/api.hbs.yaml`
- `ValkyrAI/thorapi/src/main/resources/openapi/bundles/`

Bundle assembly can be enabled so bundle-generated components merge into the assembled spec before enhancement/generation.

## GrayMatter Lite approach

GrayMatter Lite is generated from the canonical domain in
`openapi/bundles/00-graymatter-core.yaml`. `./vaix generate` composes optional
application YAML extensions, runs ThorAPI enhancement/code generation, and
derives runtime JSON from the enhanced YAML.

The generated bundle keeps the ThorAPI inputs and outputs explicit:
- `openapi/api.hbs.yaml` is the composed pre-enhancement output
- `openapi/api-out.yaml` is ThorAPI's enhanced runtime contract
- `openapi/api-out.json` is derived from that enhanced YAML
- generated Spring and TypeScript trees are disposable outputs

`scripts/gm-light-bootstrap` and `scripts/gm-light-up` remain compatibility
surfaces for older packaged installations. Their checked-in template snapshot
is not a schema-authoring input.

## Light v1 surface

Models:
- `MemoryEntry`

Fields:
- `id`
- `type`
- `text`
- `sourceChannel`
- `createdDate`
- `modifiedDate`

Required MCP-backed paths:
- `POST /v1/MemoryEntry/write`
- `GET /v1/MemoryEntry/{id}`
- `POST /v1/MemoryEntry/query`
- `GET /v1/swarm-ops/graph`
- `GET /v1/api-docs`
- optional `PATCH /v1/MemoryEntry/{id}`

## Practical cross-links for this repo

This repo should keep ThorAPI concepts explicit:
- architecture docs should explain that Light mode is ThorAPI-powered
- examples should include a starter `MemoryEntry` spec/bundle sketch
- local launch docs should state exactly which ThorAPI inputs generate the running instance
- generated specs should keep the MCP contract mapping visible through `x-graymatter-mcp-contract`

## Why this is the right split

Cloud mode solves shared durable memory.
Light mode solves developer adoption, demos, offline fallback, and local trust-building.
ThorAPI is the bridge that keeps Light mode principled instead of becoming a random sidecar implementation.
