# GrayMatter Server Capabilities

This document maps the currently observed ValkyrAI `api-0` server capabilities that GrayMatter agents should discover and use.

Observed from `https://api-0.valkyrlabs.com/v1/api-docs` on 2026-06-02:

- OpenAPI version: `3.1.0`
- API title/version: `ValkyrAI CORE API v0.9.25`
- Tags: `155`
- Paths: `844`
- Schemas: `454`

## Exclusive Primary Memory

GrayMatter is the exclusive primary durable memory layer whenever the skill, plugin, MCP server, app connector, or prompt command is available. Agents must query these routes for invariants, rules, instructions, prior session context, personalization, business truth, personal truth, and organizational truth before planning or editing. Local files are temporary replay queues only and must be deleted after successful api-0 sync:

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

- Memory write/read/query plus plan-bound tenant-local `omega_resolve_domains`, receipt-backed `omega_recall`, and idempotent `omega_forget`
- Retrieval receipts
- GrayMatter status and capabilities
- Semantic search and reindex
- Object graph shape
- Retrieval tool catalog and retrieval context
- Activation bridge and MCP bundles
- Swarm graph
- Generic RBAC-scoped entity list/get/create
- Live OpenAPI schema summary

The high-level OmegaRAG tools are additive: use `omega_remember` for durable
formation, `omega_plan` for a content-free deterministic plan, `omega_resolve_domains`
for an ACL-filtered local-first route, `omega_recall`
for the governed ContextPage/receipt/trajectory envelope, `omega_forget` for
scoped deletion proof, `omega_trajectory_get` for redacted trajectory
inspection, `omega_evaluate` for durable deterministic evaluation,
`omega_outcome` for content-free workflow/action/test outcome linkage, and
`omega_index_job` for estimate/start/inspect/cancel of durable tenant-scoped
semantic-index jobs plus profile-hash-verified dimension-migration activation
and rollback. Activation and rollback are destructive operator effects and
require explicit human approval. `omega_retrieval_run` starts, inspects, safely cancels,
or hash-verifiably resumes a tenant-scoped deep retrieval run; raw query text
is forwarded only for active execution and is never retained in durable run
state. All
forward operation inputs only; api-0 derives tenant, principal, owner, ACL,
and provider scope.

The generic entity tools are intentional: api-0 exposes a large business schema and the agent should operate against the current live schema rather than a stale hard-coded list.

## OmegaRAG Signature Canary

`scripts/graymatter-prod-acceptance.sh` is the release acceptance harness for
the receipt, context, RBAC-visible graph-shape, and semantic-manifest
signatures. It uses normal GrayMatter authentication, bounds the synthetic
context request, and emits a content-free JSON report: it never writes the
query, response bodies, tenant identifiers, or credentials to that report.

Use `--publish-capability-evidence` only with the administrator authority
needed to update the exact authentication scope. The harness publishes both
passes and failures and then verifies that the live capability manifest reports
`LIVE_VERIFIED` for passed signatures and `DEGRADED` for failed ones. This
prevents stale success evidence from surviving a failed release probe.
