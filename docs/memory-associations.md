# Durable memory associations

Private `memory_link({fromId, toId, relation})` records a directed association
between two currently readable memories. It reports `linked` only after a
backend commit and an authenticated read of the same receipt. This is record
navigation: a label such as `supersedes` does not change temporal truth,
authorize an action, or make either endpoint evidence for an answer.

## Protocol

The versioned [wire contract](../references/mcp/memory-association.v1.json)
defines three owning operations:

| Operation | Path | Result |
| --- | --- | --- |
| Capability | `GET /graymatter/memory/associations/capabilities` | Exact version, semantics, limits and verified cascade policy |
| Record | `POST /graymatter/memory/associations` | `201` for a new association; `200` for the original receipt on replay |
| Read | `GET /graymatter/memory/associations/{associationRef}` | Current authorized receipt, or an unavailable result |

The request has exactly three fields. IDs use the complete UUID form; self
associations are rejected. A label contains 1–128 Unicode code points and at
most 512 UTF-8 bytes. Case and Unicode normalization are preserved. Controls,
unpaired surrogates and leading or trailing Unicode whitespace are rejected.
Malformed UTF-8, duplicate JSON fields, caller-supplied ownership and extra
fields are rejected before normal generated DTO binding.

The public tuple digest is SHA-256 over the version, canonical lowercase
endpoint UUIDs and exact relation. Each UTF-8 field has a four-byte big-endian
length prefix. The [shared vectors](../tests/memory-associations/tuple-vectors.json)
exercise Unicode, direction, case, framing and invalid inputs.

Retries by the same owner in the same source scope and endpoint incarnation
return the original association ID, hash and timestamp. Updating memory text
preserves the association. Forgetting either endpoint physically cascades to
all incident associations, including those recorded by another owner. A
recreated endpoint does not restore an old receipt. Reads and retries recheck
both endpoint permissions; the stored association grants no access.

## Ownership and placement

`MemoryAssociation` is a normal ThorAPI entity with generated audit, ownership,
repository and service behavior. Its schema is marked server-managed to omit
generic CRUD routes while preserving generated persistence. Request and response
schemas are non-CRUD DTOs. Schema-authored output whitelists prevent inherited
audit fields from appearing in the portable wire receipts.

Handwritten owning adapters enforce the portable protocol and current endpoint
access. They lock endpoints in a consistent order and use the persisted source
incarnations for the private write key. Reads refresh the association after
locking its endpoints, so a cascading deletion cannot survive in a stale JPA
managed object. Physical metadata checks require the actual mapped namespace,
two exact endpoint foreign keys with `ON DELETE CASCADE`, and a complete unique
write-key constraint. Missing or misleading constraints deny readiness.

The MCP adapter pins one backend origin and credential context for capability,
write and readback. It sends the write once, without redirects, automatic
authentication replay or fallback transport. A lost response remains
unverified; an explicit retry can recover the committed original receipt.
Older backends return a bounded unsupported result without a write.

## Verification and limits

The generated Lite artifact passes 75 Java tests, file-backed restart and
concurrent replay checks, and all shared protocol vectors. The same final JAR
runs on actual Java 17 and Java 21. A populated legacy file-backed database
upgrades to that JAR while preserving its original memories, source hashes and
receipt audit and hydration; new associations then survive another restart. The private MCP suites pass 259 source and
246 packaged-mirror tests; an actual stdio client verifies the generated Lite
server, correction and cascade deletion. Inspect the commands, hashes and
fixture boundaries in the repository directory `tests/memory-associations/`.

The local ValkyrAI source patch passed all 119 selected canonical AspectJ
tests and was applied with 26 matching file postimages. Native Spring/H2 checks
covered committed readback, real member grants and revocation, incident cascade,
concurrent replay, managed-main placement, and stale-row rejection. The exact UTC
receipt timestamps pass the unchanged MCP verifier in offline transcript replay.
The work also repaired tenant source flush placement and moved payer resolution
into the canonical core billing boundary. Billing and tenant persistence retain separate transaction
boundaries: a tenant commit failure can leave the stable write debit recorded,
and a retry must reuse it without a second debit. This protocol does not claim
an atomic cross-database fee-and-association commit.

These are local source and disposable-database observations. Cloud qualification
uses H2 in MySQL mode and does not include a separate Cloud JVM restart. Hosted
deployment, production-dialect performance, graph-assisted retrieval accuracy,
and comparative advantage require separate evidence. KnowledgePack association
export and import remain separate work. The current archive stores memories and
content.

## Association recall in Lite

Set `includeAssociations` to `true` on a fresh context or receipt request. Use
the same option when refreshing that receipt. The server takes up to eight
independently ranked anchors whose bodies cover the query terms. It examines
up to 64 directed outgoing associations and can add up to eight independently
relevant neighbors below the original selection cutoff. A neighbor needs
positive query relevance from its body and must pass the original filters.
Existing anchors keep their scores and positions. Bifrost applies the same
source budget and conflict rules to the combined set.

The receipt reports `associationPolicyVersion`, `associationRefs` and
`associationTruncated`. References bind the exact association, anchor and
neighbor revisions without emitting relation labels. The scan applies endpoint
ownership before counting edges. Recompression retains the original proof and
refresh runs the original query against current data. Edits, deletion and
permission loss can stale a graph receipt and block hydration. Earlier Lite
versions can inspect the historical receipt and require a new search before use.

The exact regenerated Java 17 artifact found complete answer evidence in six
of nine frozen cases. The prior artifact found it in four. Required abstentions
rose from two of four to four of four. Association-disabled results matched the
baseline in all 14 cases. The linked-detail median rose from 6.59 to 18.00 ms
and the delivered context grew from 197 to 295 UTF-8 bytes in the sequential
local run. The fixture measured selected evidence and policy decisions at the
retrieval layer. The matched observations are in the repository at
`benchmarks/association-recall/matched-release-observed.json`.


### Retrieval with a narrow source filter

Lite loads vector index rows for the matching source IDs when a filter keeps
at most half of the owner's memories. Each read includes the owner and batches
up to 512 IDs. The original source filter, ranking and receipt proof still
govern which evidence the agent receives. Source bodies still load across the
owner's history.

The local pressure fixture used 6,001 outside-scope rows and three selected
source rows. Filtered medians fell from 55.21 to 42.18 ms in the first pair and
from 44.87 to 32.79 ms in reverse order. All context and association projections
matched across the measured trials. Unfiltered timings varied between the
pairs. The control used the prior code with the same 291 runtime libraries as
the candidate. The repository evidence is at
`benchmarks/association-recall/filtered-index-observed.json`.

## Association recall in ValkyrAI

The owning retrieval receipt, retrieval-context, Omega and ContextPage compile
requests accept the same opt-in. The Omega Retrieval and Omega ContextPage
workflow modules forward it through their normal configuration. They return
bounded lineage and policy metadata. SkillOptics rechecks every selected source
before using a page for routing. Its historical route receipt exposes the page
ID, and the owning page endpoint resolves current evidence.

ThorAPI persists a private commitment to the bounded candidate pool, selected
memory revisions, current associations and receipt fields. Reads recheck it
under the server-resolved tenant and principal. A new eligible edge inside the
original pool stales the old receipt. Run a fresh search to discover evidence
outside that pool. Governed receipt and page reads bypass the API response cache
so each request reaches the currentness check. Governed artifact types stay out
of generic graph traversal and semantic cache replay.

The applied ValkyrAI patch passed 427 selected tests in the canonical build.
A repeat with sealed Maven dependencies passed 426, including the native
association recall, revocation, cache, and concurrent correction checks.
Its ordinary keyword search returned an empty receipt in the upgrade fixture
before migration, despite a readable source in the correct tenant. The focused
upgrade passed on the same sealed compiled runtime. Installed-source
regeneration matched the tested owning routes, models and migration resources.
The repository directory `tests/memory-associations/recall/` records the local
Spring/H2 evidence.

A later pooled-connection test reproduced the empty keyword result. The
provider switched schemas before its search transaction began, and the query
borrowed a different connection. Starting a short transaction before placement
fixed the reproduction. The graph provider used the same ordering and now has
the same repair in the owning checkout. The isolated canonical build passed all 30 provider
and pooled placement tests. Hosted and production-dialect qualification are
separate.

ValkyrAI stores `includeAssociations` on the durable
Omega run. A Rune can opt in, and a resumed worker uses the persisted flag.
Omitting it or setting it to false preserves the existing retry fingerprint.
The worker resolves its operation scope and starts short tenant transactions
before schema placement for run state, policy reads and trajectory writes.

The combined isolated build passed 572 selected tests. The native H2 fixture
forced a real retry, observed the opt-in on both attempts, obtained a receipt,
and denied both raw administrator mutation and inspection after source access
was revoked. The fixture used the existing DEEP mode with a 3,000 ms budget.
A confirmation under the corrected TCP profile passed all five native tests
against the same compiled files and dependency JARs. The installer verified all
28 qualified source files in the owning checkout. Its two regenerated run models
matched the tested generation after normalizing randomized OpenAPI example UUIDs.
[Canonical observation](../tests/memory-associations/recall/cloud-async-observed.json) · [Installation record](../tests/memory-associations/cloud-recall-continuation-installation.json)
