# PRD: GrayMatter Suite Hardening and Consumer Integration

Status: Latest P0/P1 hardening verified; release automation follow-ups remain
Owner: Valkyr Labs product engineering
Source repos analyzed: GrayMatter `main`, ValkyrAI `rc-6`, ValorIDE `rc-6`
Last updated: 2026-06-28

## Summary

GrayMatter is the exclusive primary durable memory and live object-graph context layer for agentic Valkyr systems. It must work reliably as:

- the installable Codex/OpenClaw plugin and MCP server
- the hosted api-0 memory, retrieval, receipt, schema, and graph surface
- the GrayMatter Light local/offline memory runtime
- the backend memory substrate for SageChat, ValkyrAI workflows, ExecModules, SkillOptics, TurboVec, Bifrost, and Valor/ValorIDE
- the invariant source for safe agentic operation across Codex, OpenClaw, Claude, and ValorIDE

The product goal is not merely durable notes. GrayMatter must retrieve binding operating rules, security constraints, project decisions, workflows, graph entities, and user/business truth before agents plan or act, then write new durable facts back through normalized schema fields and relationships.

## Current State

### GrayMatter

GrayMatter ships three release surfaces:

- Codex plugin under `.codex-plugin`, `.mcp.json`, `skills/`, `mcp-server/`, and `plugins/graymatter`
- standalone OpenClaw skill archive `graymatter.skill`
- local GrayMatter Light runtime and ThorAPI bootstrap templates

The MCP server exposes memory read/write/query, retrieval receipts, invariant preflight, graph/entity tools, schema summary, status, and activation helpers. The shell scripts provide login, activation, install checks, smoke tests, OpenAPI sync, invariant preflight, replay, and Light mode.

Observed gap fixed in this pass: root runtime fixes from `main` had not been mirrored into `plugins/graymatter`, so a fresh Codex marketplace install could ship stale MCP/API behavior. Release tests now guard the mirrored MCP server, recovery tests, and API transport script.

### ValkyrAI

ValkyrAI is the production api-0 backend and schema authority. Its README establishes binding engineering rules:

- use `./vaix` for generation, builds, and tests
- never hand-edit generated ThorAPI backend, client, RTK Query, or UI output
- fix generated behavior in `api.hbs.yaml`, OpenAPI inputs, mustache templates, security/aspect layers, or thin `@Primary` delegate overrides
- preserve generated CRUD/list/QBE/ACL paths for generated objects
- redeclare `@PreAuthorize` when overriding generated delegates

The live api-0 OpenAPI currently exposes MemoryEntry, GrayMatter, retrieval receipts, semantic memory operations, context-page operations, trust/proof endpoints, SkillOpt route receipts, SwarmOps, Workflow, ExecModule, Project, ContentData, KeyMetric, StrategicPriority, and broad business graph objects. GrayMatter install status after OpenAPI sync reports memory, graph, strategic, and KPI layers ready.

Observed gaps fixed in this pass:

- MemoryEntry writes with normalized tags could attach a transient `Tag` entity and fail during Hibernate flush. The custom memory service now persists newly created and stale-replacement tags before attaching them to MemoryEntry relationships, with duplicate-name recovery for concurrent tag creation.
- SageChat/Valor durable profile memory previously depended on MemoryEntry alone. The explicit memory path now also writes typed `UserPreference` graph entries with `preferenceType=chatmemory`, so user identity, preferred name, assistant style, and explicit remembered facts are available through the graph. Persona-mode remains typed as `preferenceType=persona-mode` in the UserPreferences flow.
- SageChat/Valor context assembly now uses retrieval receipts through `RetrievalReceiptRuntimeService` and `RetrievalContextAssembler`, including receipt IDs, policy-gated context, retrieval status, answer policy, warnings, and required actions in system context.
- Workflow MCP execution now rejects high-risk command/script/system-operation inputs unless the request carries a GrayMatter policy, invariant, retrieval receipt, ContextPage, or SkillOpt receipt reference.
- EventLog persistence now feeds receipt-backed workflow/build/execution outcomes into SkillOptics as a best-effort learning loop, without letting SkillOptics failures break EventLog saves.

### ValorIDE

ValorIDE already contains a meaningful GrayMatter consumer implementation:

- `GrayMatterClient` for api-0 discovery, MemoryEntry query/write, Project operations, tenant headers, and error classification
- `GrayMatterSessionService` for capability discovery and recovery state
- `GrayMatterContextProvider` for read-before-prompt context with invariant-biased query, timeout, token budget, scope ordering, redaction, and formatting
- `GrayMatterMemoryService` and queue storage for retryable pending writes

Observed gaps fixed/verified in this pass:

- ValorIDE context injection now prefers GrayMatter policy/retrieval receipt signals when available so prompt context can obey answer policy, freshness, coverage, conflict, and recommended-action state. Raw `MemoryEntry/query` remains a fallback/list path.
- Insufficient-credit and account-balance prompts were verified across the webview UI path that should route users to buy/recharge credits before retrying hosted operations.

## Problem

Agentic systems that can edit code, run commands, publish services, mutate workflows, and coordinate swarms must not start from amnesia. The current suite has the right primitives, but quality depends on every release surface and consumer using them consistently.

Failure modes to eliminate:

- stale plugin mirror or cache installs
- missing executable bits on tests/scripts
- docs/listings diverging from plugin manifests
- context reads that bypass retrieval receipts and policy signals
- consumer writes that flatten provenance into text instead of metadata/tags/relationships
- generated-code fixes made in generated output instead of canonical ThorAPI inputs
- local fallback queues becoming silent memory stores instead of temporary replay buffers
- graph and workflow consumers treating MemoryEntry as the only source of truth
- unsafe agentic operations proceeding without invariant preflight

## Goals

1. Make fresh GrayMatter plugin installs deterministic, current, and self-validating.
2. Make invariant preflight mandatory and easy across Codex, OpenClaw, Claude, ValorIDE, and SageChat.
3. Promote retrieval receipts as the default answer-from-memory path.
4. Keep MemoryEntry concise while storing scope/provenance in `sourceChannel`, tags, metadata, and explicit graph relationships.
5. Preserve ThorAPI/generated-code boundaries in ValkyrAI and any generated consumer clients.
6. Exercise install, auth, memory, graph, schema, retrieval, Light mode, and plugin release surfaces in CI.
7. Give ValorIDE/SageChat/workflows a shared policy-aware context fabric, not isolated memory helpers.
8. Surface degraded states clearly: unauthenticated, quota, forbidden, unavailable, stale schema, partial retrieval, low confidence.

## Non-Goals

- Replacing ValkyrAI generated services with hand-written service layers.
- Turning GrayMatter Light into a full production object-graph clone.
- Storing secrets, raw tokens, or direct personal/payment identifiers in memory entries.
- Treating local fallback files as durable source of truth after successful replay.
- Bypassing RBAC/ACL for better recall.

## Product Requirements

### P0: Install and Release Integrity

- A fresh Codex marketplace install must use the current checked-out GrayMatter source.
- Only one active GrayMatter marketplace/plugin path should be enabled for Codex.
- Stale cache copies should be quarantined or removed from active cache discovery.
- `plugins/graymatter` must not drift from root runtime files that ship in the plugin.
- Plugin manifest, docs listing, packaged archive, skill docs, MCP contracts, and install scripts must be consistency-tested.
- All shell tests intended for direct execution must be executable in git.

Acceptance:

- `codex` config points `marketplaces.graymatter.source` at the intended marketplace source.
- installed cache contains a single active `graymatter/graymatter/<version>` path.
- `gm-install-check`, `gm-status`, `gm-smoke`, `gm-register-agent`, `gm-openapi-sync`, and MCP tests pass from the installed cache.
- strict `for t in tests/*.sh; do "$t"; done` passes.

### P0: Mandatory Invariant Preflight

- Every agent surface must run GrayMatter invariant preflight before planning, code edits, generated-surface changes, security-sensitive actions, workflow mutations, or production-affecting operations.
- Query terms must include workspace/product keywords plus `invariant`, `decision`, `methodology`, `security`, `RBAC`, `ACL`, `ThorAPI`, `AspectJ`, generated-code, and named products.
- Returned binding decisions must be applied before action.
- If live retrieval degrades, consumers must disclose degraded retrieval and fall back only to direct reads, known IDs, or local bootstrap context.

Acceptance:

- Codex/OpenClaw skill docs and MCP tool descriptions state the invariant preflight rule.
- ValorIDE runtime prompt/context provider runs invariant-biased retrieval before ordinary remembered context.
- CI covers `gm-invariant-preflight` and MCP `graymatter_invariant_preflight`.

### P0: Memory Write Contract

- `MemoryEntry.text` stores the durable human fact only.
- `sourceChannel` carries stable surface scope.
- metadata/tags carry source surface, workspace, chat/session, automation, runtime, user, task, provenance, and dedupe hints.
- API-owned audit and ownership fields are never sent by clients.
- `ContentData.contentData` is not used as a metadata junk drawer.
- Fallback writes are replay queues and are deleted after successful sync.

Acceptance:

- `gm_memory_scope_test` proves scope is not injected into text.
- MCP tests prove memory tools derive `sourceChannel` from Codex metadata.
- ValorIDE pending-write queue sanitizes sensitive metadata and persists only retryable failures.

### P1: Retrieval Receipts Everywhere

- Consumers should prefer `memory_retrieve_with_receipt` or `/graymatter-retrieval-receipts` for prompt context and memory-backed answers.
- Raw `MemoryEntry/query` remains allowed for direct list/search, smoke tests, and fallback.
- Consumers must obey `answerPolicy`, `retrievalStatus`, stale/partial/conflicting context flags, and `recommendedAction`.
- Prompt context should include receipt IDs internally for audit and debugging.

Acceptance:

- ValorIDE `GrayMatterContextProvider` can use retrieval receipts when backend capability discovery reports support.
- SageChat and workflow LLM adapters use receipt-aware context assembly for memory-backed answers.
- Tests cover low-confidence/stale/conflicting retrieval behavior.

### P1: Consumer Context Injection

- ValorIDE and SageChat should query project, organization, and user scopes before prompt construction.
- Invariant entries sort before ordinary memories.
- Context blocks are capped by token budget and redact bearer tokens/JWTs.
- GrayMatter read timeouts must not block first-token user experience.
- Context telemetry must record latency/status/counts without memory content.

Acceptance:

- ValorIDE has tests for prompt composition with GrayMatter context enabled, disabled, timeout, and quota states.
- SageChat has equivalent context assembly tests.

### P1: Graph and Workflow Integration

- MemoryEntry is not the whole graph. Project, Workflow, WorkflowExecution, ExecModule, Agent, Swarm, ContentData, FileRecord, Task, Goal, KeyMetric, and StrategicPriority records should be used when they are the better typed object.
- Workflow and ExecModule outputs should write artifacts/context through normalized fields and relationships.
- SwarmOps remains the coordination channel for agent registration, commands, graph, and status.

Acceptance:

- Workflow modules emit MemoryEntry summaries plus typed graph links for durable outputs.
- ExecModule security policies can read GrayMatter invariants before local/system operations.
- GrayMatter graph/entity MCP tools can list/read/create permitted objects through live schema.

### P1: Safe Agentic Operation

- GrayMatter should store and retrieve threat constraints: forbidden URLs, unsafe commands, restricted file types, suspicious capsules, prompt-injection patterns, risky deployment operations, and source-specific trust rules.
- ValorIDE command/script runners should consult GrayMatter safety invariants before high-risk execution.
- Denied or cautioned actions should be auditable as MemoryEntry or EventLog records without exposing secrets.

Acceptance:

- ValorIDE command runner has policy hook points for GrayMatter safety context.
- Tests cover blocked/cautioned operations and no-token logging.

### P2: GrayMatter Light and Local Parity

- Light mode remains MemoryEntry-first and api-0-compatible where practical.
- Local server package must boot, expose `/api-docs`, support JSON smoke tests, and document Cloud upgrade semantics.
- Light should not pretend to provide full production graph/RBAC isolation.

Acceptance:

- package-local-server tests pass.
- Light bootstrap docs explain what is local-only versus Cloud authoritative.

## Technical Guardrails

- Use `./vaix` in ValkyrAI for generation/build/test. Do not bypass AspectJ/security weaving.
- Do not edit ValkyrAI generated files except to inspect or after regeneration.
- Fix generated behavior in `api.hbs.yaml`, OpenAPI inputs, mustache templates, security/aspect infrastructure, or thin overrides.
- Use RTK Query hooks/mutations for ThorAPI UI state unless the call is auth/bootstrap/external/probe-only.
- Keep GrayMatter scripts ergonomic wrappers; resilience belongs in shared client/plugin runtime where applicable.
- Use structured JSON parsing and OpenAPI/schema introspection instead of ad hoc string parsing for schema-sensitive work.

## Quality Gates

Required before release:

- strict GrayMatter shell suite
- MCP server `npm test`
- package archive verification
- installed-cache MCP test run
- `gm-install-check`
- `gm-smoke`
- `gm-register-agent`
- `gm-openapi-sync`
- `gm-status` all ready for auth, tenant schema, memory, graph, strategic, KPI
- ValkyrAI targeted `./vaix` tests for memory/retrieval/schema/security changes
- ValorIDE tests for GrayMatter client/session/context/pending queue/runtime prompt changes

## Immediate Findings From This Pass

Fixed:

- Marketplace install source refreshed from the current GrayMatter `main` checkout.
- Older `local/graymatter/0.2.0` cache quarantined out of active plugin cache discovery.
- Active installed cache refreshed from corrected `plugins/graymatter`.
- Plugin mirror updated for current MCP/API runtime fixes.
- Release-surface test now fails on stale mirrored MCP/API files.
- Stale memory-scope test updated to enforce structured metadata instead of inline text headers.
- Non-executable shell tests marked executable.
- Awesome Codex plugin listing updated to match the plugin manifest and now reports useful mismatch output.
- MemoryEntry Tag persistence hardened against stale/transient Tag identities and concurrent Tag creation.
- SageChat/Valor explicit profile memory writes now also upsert `UserPreference` graph memory records with `preferenceType=chatmemory`.
- Persona-mode preference writes remain covered as typed `UserPreference` graph records with `preferenceType=persona-mode`.
- ValorIDE GrayMatter context/session/client behavior and insufficient-credit account prompt paths verified with targeted tests.
- SageChat/Valor backend receipt-aware context assembly is verified by `LLMControllerJsonTest`, including policy-gated low-confidence retrieval context.
- Workflow MCP high-risk execution inputs now require a GrayMatter policy/context reference before execution.
- EventLog rows containing SkillOpt route receipt refs now record sanitized SkillOptics outcomes on successful EventLog saves.
- GrayMatter API transport credit/recovery test passed.
- GrayMatter MCP server recovery/auth/tool suite passed, including insufficient credits, missing starter credits, auth recovery, 403 read-only recovery, Apps SDK endpoints, hosted auth isolation, and schema/entity tools.
- GitHub Actions now runs the direct `tests/*.sh` shell sweep with `set -euo pipefail`, verifies shell tests are executable, and runs MCP server tests on Node 20.
- Release-surface tests now compare every plugin-shipped mirrored helper script, while preserving the intentionally plugin-relative `plugins/graymatter/scripts/package-graymatter` packager.
- Stale marketplace plugin copies of `gm-entity` and `gm-register-agent` were synchronized from the root source scripts.

Verified in latest wrap-up:

- GrayMatter focused shell tests: `gm_register_agent_test.sh`, `gm_entity_test.sh`, `gm_status_test.sh`, `gm_write_test.sh`.
- GrayMatter API transport shell test: `graymatter_api_test.sh`.
- GrayMatter MCP server: `npm test --prefix mcp-server`, 37 tests.
- GrayMatter direct shell sweep: `set -euo pipefail; for test_script in tests/*.sh; do "$test_script"; done` passed.
- ValkyrAI backend clean targeted run: `LLMControllerChatPersistenceTest`, `LLMControllerJsonTest`, `MemoryEntryServiceTest`, `UserPreferenceGraphMemoryServiceTest` passed, 79 tests total.
- ValkyrAI SkillOptics/EventLog/workflow policy run: `WorkflowMcpExecutionControllerSecurityTest`, `EventLogSkillOpticsMonitorServiceTest`, `EventLogSafetyAspectTest`, `SkillOptRuntimeServiceTest`, `LLMControllerJsonTest` passed, 44 tests total.
- ValkyrAI AspectJ lifecycle run: `EventLogSkillOpticsMonitorServiceTest`, `EventLogSafetyAspectTest`, `SkillOptRuntimeServiceTest`, `MavenLifecycleContractTest` passed, 26 tests total.
- ValkyrAI SageChat Jest: `SageChat.test.tsx` passed, 32 tests.
- ValkyrAI UserPreferences Jest: `UserPreferences.test.tsx`, `profilePersistence.test.ts` passed, 10 tests.
- ValorIDE extension Jest: `GrayMatterClient`, `GrayMatterSessionService`, `GrayMatterMemoryService`, `AgentContextAssembler` tests passed, 31 tests.
- ValorIDE webview Vitest: account-balance prompt, API error listener, system alerts, credits API, API error slice tests passed, 45 tests.

Still to do:

- Broaden the MCP workflow policy precondition into module-specific local/system operation gates if future ExecModules add direct shell, process, filesystem, deployment, or external runner execution.

## Cross-Repo Status Report

### Fixed in GrayMatter

- Plugin release mirror drift checks were tightened for shipped MCP/API runtime files.
- Plugin release mirror drift checks now cover every mirrored script shipped in `plugins/graymatter/scripts`, except the intentionally plugin-relative plugin packager.
- GitHub Actions CI now exercises direct shell-script execution and MCP server tests.
- Shell/API credit recovery was verified, including structured insufficient-credit recovery and safe deferred write behavior.
- MCP server recovery handling was verified for insufficient credits, missing starter credits, auth, and RBAC write denial.

Current dirty files in the GrayMatter repo belong to the plugin/install/release-test slice:

- `.gitignore`
- `.github/workflows/graymatter-ci.yml`
- `docs/prd-graymatter-suite-hardening.md`
- `scripts/gm-entity`
- `scripts/gm-register-agent`
- `plugins/graymatter/scripts/gm-entity`
- `plugins/graymatter/scripts/gm-register-agent`
- `tests/release_surfaces_test.sh`
- `tests/gm_register_agent_test.sh`
- `tests/gm_entity_test.sh`
- `artifacts/`

### Fixed in ValkyrAI

- `ValkyrAIMemoryEntryService` hardens MemoryEntry Tag persistence against stale/transient Tag flush failures.
- `UserPreferenceGraphMemoryService` adds typed `UserPreference` graph memory for `chatmemory` and `persona-mode`.
- `LLMController` writes explicit profile memory into both MemoryEntry and UserPreference graph memory, and uses receipt-aware GrayMatter context for SageChat/Valor LLM context.
- `EventLogSkillOpticsMonitorService` observes receipt-backed EventLog saves and records sanitized SkillOptics outcomes.
- `EventLogSafetyAspect` invokes the SkillOptics monitor after successful saves while preserving non-blocking EventLog behavior.
- `WorkflowMcpExecutionController` requires GrayMatter policy/retrieval/context references for high-risk MCP command/script/system-operation workflow inputs.

Current dirty files from this GrayMatter hardening slice in ValkyrAI:

- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/controller/LLMController.java`
- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/memory/ValkyrAIMemoryEntryService.java`
- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/memory/UserPreferenceGraphMemoryService.java`
- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/aspect/EventLogSafetyAspect.java`
- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/skillopt/EventLogSkillOpticsMonitorService.java`
- `valkyrai/src/main/java/com/valkyrlabs/valkyrai/mcp/WorkflowMcpExecutionController.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/controller/LLMControllerChatPersistenceTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/controller/LLMControllerJsonTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/memory/MemoryEntryServiceTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/memory/UserPreferenceGraphMemoryServiceTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/aspect/EventLogSafetyAspectTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/skillopt/EventLogSkillOpticsMonitorServiceTest.java`
- `valkyrai/src/test/java/com/valkyrlabs/valkyrai/mcp/WorkflowMcpExecutionControllerSecurityTest.java`

The ValkyrAI worktree contains many unrelated dirty files from other slices; they were not reverted or folded into this report.

### Verified in ValorIDE

- GrayMatter client/session/memory/context tests passed.
- Receipt-aware prompt context, policy gating, quota/unavailable/forbidden states, and account-balance UI recovery paths passed focused tests.

No new ValorIDE source edits were made in this final hardening slice. Existing dirty files in ValorIDE belong to prior local work and are intentionally left untouched.

## Rollout Plan

Phase 1: Install integrity and release gates

- Land the fixed plugin mirror, package archive, executable tests, listing sync, release-surface guards, CI strict shell sweep, and MCP tests.

Phase 2: Receipt-aware consumer context

- Upgrade ValorIDE context provider to prefer retrieval receipts.
- Port the same pattern into SageChat and workflow LLM adapters.
- Add degraded-state UX and telemetry.

Phase 3: Typed graph memory

- Normalize workflow/ExecModule artifacts into Project, ContentData, Task, Goal, WorkflowExecution, and graph links when live schema exposes them.
- Keep MemoryEntry as compact summary and retrieval anchor.

Phase 4: Agentic safety fabric

- Store and retrieve high-risk operation invariants.
- Wire ValorIDE/SageChat/Codex/OpenClaw command execution policy checks to GrayMatter.
- Add audit trails and redaction tests.

Phase 5: Product polish

- Memory browser/governance UI.
- Admin policy management.
- Route-quality dashboards for retrieval receipts, SkillOpt routing, and workflow memory usage.
- Light-to-Cloud migration UX.

## Success Metrics

- Fresh install success rate: 99%+ in clean Codex/OpenClaw environments.
- Invariant preflight latency: p95 under 3 seconds.
- Memory write success or queued-with-replay: 99%+.
- Retrieval receipt coverage for prompt context: 90%+ of memory-backed answers.
- Zero known generated-surface manual patches shipped without canonical source changes.
- Zero secrets observed in MemoryEntry text, fallback queues, telemetry, or logs.
