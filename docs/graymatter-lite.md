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
They improve fuzzy lexical recall but are **not** a semantic language model.
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
an optional smaller `tokenBudget`, and optional `protectedRefs` or
`evictedRefs`. Protected refs carry into child contexts and cannot be evicted.
`POST /v1/graymatter/retrieval-context/{id}/fork` creates an independently
addressable child with the same source rechecks. Each result has a
`contextPageRef` that an agent can carry through a handoff. An exact source can
be hydrated through
`GET /v1/graymatter/retrieval-context/{id}/hydrate/{memoryId}?maxTokens=1000`.
Every inspection, recompression, and hydration rechecks current ownership and
source hash; changed or removed memories cannot be replayed from old context.
The response `answerPolicy` tells an agent when evidence is insufficient.

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
