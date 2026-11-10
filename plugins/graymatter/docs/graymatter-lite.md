# GrayMatter Lite

GrayMatter Lite is the single-user or single-workspace open-source distribution
of GrayMatter. It is designed for useful daily memory, not just evaluation.

## Product boundary

Lite includes:

- the canonical ThorAPI source contract at
  `openapi/bundles/00-graymatter-core.yaml`;
- the `./vaix` source builder and user-local toolchain bootstrap;
- the Spring Boot/H2 local server and embedded sign-in dashboard;
- one local principal and basic profile preferences;
- MemoryEntry write, list, hybrid query, and read APIs;
- an H2-backed local vector projection, BM25 keyword ranking, and receipt-backed
  Bifrost context compression over owned memories;
- signed KnowledgePack import, graph/archive retention, and portable export;
- a vetted starter KnowledgePack stored in H2 on first launch;
- the GrayMatter MCP server;
- local/hosted named profiles and read-only blended CLI/MCP retrieval;
- the local SWARM status and promotion bridge;
- Docker, tests, public docs, and community support.

Legacy scripts and environment variables keep the word `LIGHT` for backward
compatibility. They still target the GrayMatter Lite product.

## Source installation

```bash
git clone https://github.com/ValkyrLabs/GrayMatter.git
cd GrayMatter
./vaix setup
```

The builder accepts Java 17 or newer. If Java, Maven, or Node 20+ is missing,
it downloads a user-local toolchain beneath `.vaix/runtime`. It does not use
Homebrew, apt, sudo, or a global installer.

The setup command:

1. copies the standalone Lite bootstrap assets into `.graymatter-lite` when
   the local application has not been created yet;
2. builds the Spring/H2 application using public Maven dependencies;
3. creates a mode-`0600` local credential file;
4. registers the `graymatter-lite-local` profile without activating it over an
   existing hosted profile;
5. starts the dashboard/backend on port `8787` and HTTP MCP on port `3333`;
6. leaves durable H2 state under `.graymatter-lite/data` unless
   `GRAYMATTER_DATA_DIR` overrides it.

Run `./vaix credentials` for the local sign-in and `./vaix doctor` for a live
readiness proof.

Setup verifies the running services without requiring a hosted account or the
private ThorAPI generator. Run `./vaix test` for the full developer suite and
`./vaix generate` for explicit schema generation; those generator operations
require an available ThorAPI distribution. Generation composes the canonical
YAML into `api.hbs.yaml` before producing the generated Spring and TypeScript
surfaces. Existing local credentials, H2 data, and application sources are
preserved when setup is repeated.

## Docker installation

```bash
export GRAYMATTER_ADMIN_PASSWORD='choose-a-strong-local-password'
docker compose -f deploy/docker-compose.lite.yml up --build
```

The backend image is built from the committed local-server source. The MCP
image is built from `mcp-server/`. The `graymatter-lite-data` volume retains H2
state across container replacement.

## One backend profile, multiple client profiles

Lite intentionally contains one local principal/workspace. The plugin client
can still route between that local profile and one or more hosted accounts:

```bash
printf '%s\n' "$GRAYMATTER_ADMIN_PASSWORD" | \
  scripts/gm-profile add-local local \
    --api-base http://localhost:8787/v1 --password-stdin

scripts/gm-profile add cloud --from-current
scripts/gm-profile use local
scripts/gm-profile blend local cloud
scripts/gm-query "what are the release invariants?"
```

Blended mode is a federation of independent reads, not a tenant merge. Each
result includes its profile and account fingerprint. Partial failures are
isolated. POST `/MemoryEntry/query`, GET, and HEAD are the only federated
transport operations; every write or unsupported action is blocked. Select one
profile before mutating data or calling a non-federated MCP tool. In blended
mode the MCP memory query/read/health tools return the same profile-labeled
federated envelope as the CLI.

## Local authentication

Lite checks the current account, enabled flag, password verifier and roles on
every authenticated request. For repeated valid Basic credentials it can
reuse a successful password comparison for 60 seconds. The process keeps at
most 128 keyed proof digests. A password-verifier change immediately requires
a new comparison, and disabling or deleting the account immediately denies
the next request. Browser session cookies do not authorize later API requests.

Unknown accounts, failed checks, and passwords exceeding 72 UTF-8 bytes use
the underlying BCrypt path each time. Existing long-password verification
semantics are preserved. The proofs expire for use after 60 seconds and are
bounded in memory until eviction or process exit. Account administration and
the current source permissions still govern every operation.

## Starter KnowledgePack

The committed source pack contains support/setup/product memories for:

- GrayMatter and GrayMatter Lite;
- Valkyr SWARM installation, activation, mothership commands, and approval
  gates;
- ValkyrAI/api-0 ownership boundaries;
- ThorAPI/VAIX source generation and RBAC/ACL invariants.

Startup converts the source records to a signed `self-contained-v1` archive and
imports it through the same validator used for uploaded `.gmkp` files. The
resulting KnowledgePack, graph, archive, and searchable MemoryEntry rows are
stored in H2. The fixed source pack ID and content digest make startup
idempotent.

Disable it only for a deliberately empty fixture:

```bash
GRAYMATTER_STARTER_KNOWLEDGE_PACK_ENABLED=false ./vaix run
```

## Import and export

The dashboard can import any supported signed `.gmkp` and export all memory
visible to the local principal. API equivalents:

```bash
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" \
  -F 'file=@./pack.gmkp;type=application/vnd.valkyrlabs.graymatter-knowledge-pack+zip' \
  http://localhost:8787/v1/knowledge-packs/import

curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" \
  -o graymatter-lite-memory.gmkp \
  http://localhost:8787/v1/knowledge-packs/export
```

Exports omit local principal, ownership, tenant, ACL, permission, and credential
fields. Import reassigns data to the authenticated local principal and requires
embeddings to regenerate locally.

For a full H2 backup, stop the service and archive `.graymatter-lite/data`, or
use the packaged launcher's `--export-data` command. KnowledgePack export is the
preferred portable memory format; H2 backup is the exact local recovery format.

## Local models and MCP

The backend does not choose an LLM. Local models use the MCP server as their
memory tool boundary. See [local-models.md](local-models.md).

### Hybrid memory search

`POST /v1/MemoryEntry/query` now uses hybrid retrieval by default and keeps its
existing `results` response shape. `POST /v1/memory/semantic-index/search`
exposes score and index-profile details. Set `retrievalMode` to `KEYWORD`,
`VECTOR`, `HYBRID`, `SCHEMA_FILTERED`, or `RECENCY_BIASED`; `type`, `source`,
and `tags` are exact filters within the
authenticated local principal. `POST /v1/memory/reindex` rebuilds this
principal's H2 index and removes stale index rows. Existing memories backfill
when queried; KnowledgePack imports regenerate the portable vector projection
locally. `{"dryRun":true}` estimates a reindex without writing. Lite rejects
source-specific generated-domain reindex requests. Embeddings from an imported
archive are never trusted.

The MCP `filters` object accepts only `type`, `source`/`sourceChannel`, and
`tags`. Unsupported filters fail with HTTP 400 so a narrow request cannot
silently become a broad search.

The default `feature-hash-384-v1` vectors work without a model or network.
They can find related spellings, but are **not** a semantic language model.
In offline `HYBRID` and `SCHEMA_FILTERED` searches, Lite ranks exact-word
matches with BM25 first, then fills remaining slots with verified word or
trigram neighbors. A configured semantic model still contributes its own
ranking when available.
For semantic embeddings from a local model, install Ollama and a local embedding
model, then set:

```bash
GRAYMATTER_EMBEDDING_PROVIDER=ollama
GRAYMATTER_EMBEDDING_OLLAMA_MODEL=nomic-embed-text
```

The server calls only Ollama's loopback `/api/embed` endpoint. Run
`POST /v1/memory/reindex` after switching models. If the local model is down,
the search response reports `semanticDegraded: true` and uses feature hashes;
the durable memory stays available. `/v1/memory/capabilities` reports the
configured profiles without sending a test embedding request. The portable
Java/H2 scan is intended for personal memory scale; there is no ANN engine in
Lite.

### Correcting and forgetting a local memory

Read `GET /v1/graymatter/memory/{id}` to obtain the exact owned snapshot and
its `sourceHash`. The private Lite MCP tools also accept the hash returned by
`memory_get`. Supply the hash from the revision the user reviewed.

| Operation | Request and result |
| --- | --- |
| `POST /v1/graymatter/memory/{id}/revise` or `lite_memory_revise` | Supply `expectedSourceHash` and replacement `text`, `tags`, or both. The response contains the corrected record and its current hash. An empty tags array clears the tags. |
| `POST /v1/graymatter/memory/{id}/forget` or `lite_memory_forget` | Supply `expectedSourceHash` and `confirmed: true` for that exact record. HTTP 204 acknowledges removal of its local source and search index. |

A competing change returns HTTP 412. Read the current version before
reapplying a correction or confirming deletion. Returning to an earlier
text creates a new revision. The hash binds the source fields and, after a
correction, a fresh random revision value. Submitting the identical values at the current
revision leaves its hash valid. A missing or inaccessible record returns 404.
Individual mutation of an imported signed KnowledgePack row returns 409.
Previously delivered text and exported copies have their own lifecycles.

These private MCP tools are available on an authenticated single loopback
Lite profile. On the wire the memory ID is in the path. For an MCP call add
`id` to the arguments.

### Bifrost context for agents

`POST /v1/graymatter/retrieval-context` and
`POST /v1/graymatter-retrieval-receipts` search owned memories, prioritize
decisions and unresolved evidence, select query-aware excerpts, redact common
credential patterns, and return a citation-ready context with a durable
content-free receipt. The context budget is 128–16,000. The compiler bounds
UTF-8 output bytes by that budget, a conservative model-independent token
ceiling. Canonical `MemoryEntry` text is not changed by compression.

Receipts store source IDs and SHA-256 hashes, not source text. Inspect one with
`GET /v1/graymatter-retrieval-receipts/{id}`. Recompress with
`POST /v1/graymatter/retrieval-context/{id}/recompress` using the same query,
an optional `tokenBudget`, and optional `protectedRefs` or
`evictedRefs`. Protected refs carry into child contexts and cannot be evicted.
`POST /v1/graymatter/retrieval-context/{id}/fork` creates an independently
addressable child with the same source rechecks. A usable result has a
`contextPageRef` that an agent can carry through a handoff. An exact source can
be hydrated through
`GET /v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}?maxTokens=1000`.
Every inspection, recompression, and hydration rechecks current ownership and
source hash; changed or removed memories cannot be replayed from old context.
With `bifrost-lite-context/v4`, use the compiled text when the server returns
`OK`, `ALLOW_ANSWER` and `ANSWER`. This decision describes the selected
source set. It does not measure whether every relevant fact was retrieved.
The raw search respects `topK`. When compiling context, Lite also checks for
an explicitly marked conflict below that cutoff, under the same principal and
filters. If an otherwise eligible marked source contains every query word in
its text, Lite retains one such source in the receipt and withholds the page.
The diagnostic source count can therefore exceed `topK` by one.

Two notes can also give different values without either author marking a
conflict. For a query such as “Telemetry window”, two bare settings in the
same scope saying “Telemetry window is Monday.” and “Telemetry window is
Friday.” leave it unclear whether both days apply. Lite asks for
clarification and records the two source IDs in `ambiguousRefs`. It neither
chooses the more recent note nor treats either author as wrong. This check
covers a narrow form of weekday setting in untagged, standalone notes sharing
a type and source channel. A complete result set containing an explicit
two-day weekly schedule for that setting can account for both assignments.
If the agent drops that supporting source, the narrowed receipt still
withholds the context. The rule does not infer exclusivity,
resolve dated corrections or detect arbitrary disagreements in prose.

Before using a receipt for a new action, inspect it or repeat the search with
`POST /v1/graymatter/retrieval-context/{id}/refresh`. The private MCP
equivalent is `lite_context_refresh`. Supply the original query, filters,
retrieval mode, result limit, budget and protected IDs. Delivery may omit
text by setting `includeText: false`. A fresh result identifies the original
with `parentReceiptId` and reports `sourceSelection: FRESH_SEARCH`.
Changing the discovery scope returns 409. Start a new search for a different
scope or for a historical receipt whose original settings were never recorded.

Inspection and hydration check the membership and revision of all memories
eligible under the original owner, type, source and tag filters. A newly
added dispute can stale an earlier positive receipt even when its original
passage still exists. A fixed-source fork inherits that check. A change
elsewhere in the same filter scope can also stale the receipt even when a
fresh search returns the same answer. A tighter source filter reduces these
retries. The snapshot records hashes and source references. Inspection reads
the owner's candidate metadata, which has a cost for large memory stores.

| Receipt status | What the agent should do |
| --- | --- |
| `PARTIAL_COVERAGE` | Inspect `truncatedRefs` and `omittedRefs`. Recompress the same sources with a larger budget, up to 16,000. If the configured semantic provider degraded, retrieve again after it recovers. |
| `CONFLICTING_CONTEXT` | Inspect `conflictRefs` through the owned memory read API and clarify the explicitly marked conflict. Recompiling or forking still evaluates those sources. |
| `AMBIGUOUS_WEEKDAY` | Ask whether multiple days apply to this setting. Inspect the source IDs in the Lite receipt's `ambiguousRefs`; these are separate from explicitly disputed sources. |
| `NO_RESULTS` | Revise the query or filters. |
| `STALE_CONTEXT` or `RETRY_REQUIRED` | Retrieve a fresh context. Older receipts lacking the recorded decision can still be inspected. |

A withheld response supplies the diagnostic `receiptId` and reason. Its
context, usable page pointer and context hash are empty, the item list is empty,
and its delivered token estimate is zero. A receipt inspection separates the
original `recordedRetrievalStatus` from the current `retrievalStatus` after
source rechecks. Receipt hydration requires current, complete evidence.
If an agent requests a smaller excerpt, read its `truncated` flag: it remains
true even when the budget cannot fit a truncation marker. The `sourceHash`
identifies the original record. It does not imply the excerpt contains
the whole source.
An explicit eviction from a complete parent sets `sourceSetNarrowed` on
the child and its descendants and withholds the narrowed context. Use a fresh
retrieval to establish a new candidate set. Recompression of a withheld parent
can grow the budget while preserving its sources. For the offline vector
profile, GrayMatter verifies the original word and trigram overlap before
accepting a hit that depends entirely on hashed features.
Clients matching `SUFFICIENT_CONTEXT` or `ANSWER_WITH_CITATIONS` should
use the policy fields above. Inspect an older receipt for history; retrieve
fresh context under the current policy before reusing its sources.

These APIs cover Lite's agentic-memory boundary. They do not include hosted
ValkyrAI workflows, SkillOptics evaluation, or generated-domain retrieval.

## SWARM integration

Lite exposes local SWARM status but does not create a parallel remote command
implementation. Install [ValkyrSWARM](https://github.com/ValkyrLabs/ValkyrSWARM)
for authenticated registration, heartbeats, exact-target remote commands,
progress, and terminal receipts. The GrayMatter starter pack includes the
supported installation and safety guidance.

## Troubleshooting

```bash
./vaix doctor
tail -f .vaix/graymatter-lite.log
tail -f .vaix/graymatter-mcp.log
./vaix stop
```

If setup fails, run `./vaix build` to isolate a dependency or compilation
problem, then `./vaix up` and `./vaix doctor` to verify the services. For explicit
schema generation, run `./vaix generate` and `./vaix test` separately. Do not
delete the H2 data directory to fix a build failure.

For help, see [SUPPORT.md](../SUPPORT.md). For vulnerabilities, follow
[SECURITY.md](../SECURITY.md).
