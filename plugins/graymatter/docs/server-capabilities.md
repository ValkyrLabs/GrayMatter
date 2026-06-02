# GrayMatter Server Capabilities

This document maps the currently observed ValkyrAI `api-0` server capabilities that GrayMatter agents should discover and use.

Observed from `https://api-0.valkyrlabs.com/v1/api-docs` on 2026-06-02:

- OpenAPI version: `3.1.0`
- API title/version: `ValkyrAI CORE API v0.9.25`
- Tags: `155`
- Paths: `844`
- Schemas: `454`

## Primary Memory

GrayMatter is the primary durable memory layer. Agents should prefer these routes before falling back to local files:

- `/MemoryEntry`
- `/MemoryEntry/write`
- `/MemoryEntry/query`
- `/MemoryEntry/read`
- `/MemoryEntry/export`
- `/MemoryEntry/bootstrap`
- `/MemoryEntry/bootstrap/digest`
- `/MemoryEntry/usage`
- `/memory`
- `/memory/write`
- `/memory/query`
- `/memory/read`
- `/memory/search`
- `/memory/compact`
- `/memory/expand`
- `/memory/prune`
- `/memory/reindex`
- `/memory/status`
- `/memory/capabilities`
- `/memory/usage`

Memory entry types used by the skill and MCP tools:

- `decision`
- `todo`
- `context`
- `artifact`
- `preference`

## Retrieval, Receipts, And Answer Policy

Receipt-backed retrieval should be used when an agent intends to answer from memory:

- `/graymatter-retrieval-receipts`
- `/graymatter-retrieval-receipts/{receiptId}`
- `/graymatter/retrieval-context`
- `/graymatter/retrieval-context/{receiptId}`
- `/graymatter/retrieval-tools`
- `/graymatter/retrieval-benchmark`

The returned receipt/policy signals are operational, not decorative. Agents must inspect `answerPolicy`, `retrievalStatus`, `recommendedAction`, provenance, freshness, and coverage before answering confidently.

## Semantic And Indexed Memory

GrayMatter exposes semantic/vector/index operations:

- `/memory/semantic-health`
- `/memory/semantic-index`
- `/memory/semantic-index/search`
- `/memory/semantic-index/reindex`
- `/memory/semantic-search`
- `/memory/semantic-search/capability`
- `/MemoryEntry/semantic`
- `/MemoryEntry/semantic-search`
- `/MemoryEntry/semantic/capability`
- `/MemoryEntry/semantic-search/capability`
- `/graymatter/semantic-index/manifest`

Agents should use semantic search or receipt-backed retrieval for fuzzy recall, and direct entity reads for known object IDs.

## Object Graph And Business Schema

GrayMatter is not only note storage. It exposes the RBAC-visible ValkyrAI object graph:

- `/graymatter/object-graph/shape`
- `/swarm-ops/graph`
- `/SwarmOps/graph`
- `/lookup/entity/{entity}`
- `/lookup/{uuid}`
- `/api-docs`
- `/docs/fragments/minimal`
- `/docs/fragments/schemas/{schemaName}`
- `/docs/fragments/schema-partials/{objectType}`
- `/docs/fragments/workflow`
- `/docs/fragments/execmodules`

Important live domains include:

- `Organization`, `Customer`, `Opportunity`, `Invoice`, `SalesOrder`, `LineItem`
- `Product`, `ProductFeature`, `SubscriptionPlan`, `AccountBalance`, `UsageTransaction`
- `Application`, `Project`, `Build`, `HostInstance`, `Deployment`
- `Workbook`, `Sheet`, `Cell`, `Workflow`, `Task`, `Run`, `WorkflowExecution`
- `Note`, `ContentData`, `FileRecord`, `MediaObject`, `Space`, `SpaceMember`
- `Goal`, `StrategicPriority`, `KeyMetric`, `SalesActivity`, `SalesPipeline`
- `Agent`, `Swarm`, `SwarmOps`, `AgentEventTrigger`
- `McpServer`, `McpTool`, `McpResource`, `McpMarketplaceItem`

## Activation, Auth, Credits, And Recovery

Agents should treat auth and credit recovery as first-class flows:

- `/auth/login`
- `/auth/me`
- `/auth/signup`
- `/auth/account-plan`
- `/credits/me/balance/summary`
- `/graymatter/activation/bridge`
- `/graymatter/activation/bridge/event`
- `/graymatter/activation/bridge/retry`
- `/graymatter/control`
- `/graymatter/admin/control`

Operational rules:

- Run `scripts/gm-self-update maybe` on startup.
- Run `scripts/gm-activate` for clean login/bootstrap.
- Store reusable credentials and tokens in the OS keychain when available.
- Re-login automatically when a token is expired or api-0 returns a refreshable auth error.
- Queue replay-safe writes locally only when the durable server path is blocked.
- Run `scripts/gm-replay-deferred` after auth, credits, or connectivity are restored.

## MCP And Agent Tooling

GrayMatter MCP exposes direct tools for:

- Memory write/read/query
- Retrieval receipts
- GrayMatter status and capabilities
- Semantic search and reindex
- Object graph shape
- Retrieval tool catalog and retrieval context
- Activation bridge and MCP bundles
- Swarm graph
- Generic RBAC-scoped entity list/get/create
- Live OpenAPI schema summary

The generic entity tools are intentional: api-0 exposes a large business schema and the agent should operate against the current live schema rather than a stale hard-coded list.
