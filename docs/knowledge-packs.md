# GrayMatter KnowledgePacks

KnowledgePacks are portable, signed snapshots of a bounded GrayMatter object
graph. They let a creator assemble reusable agent knowledge in GrayMatter
Cloud, download it as one `.gmkp` archive, load it into the H2-backed
GrayMatter Light Local Server, and hand the product draft to
DigitalProductsPro for distribution or monetization.

## Product lifecycle

1. Open the GrayMatter homepage in ValkyrAI and select **Build a Distributable KnowledgePack**.
2. Choose the source memory, content, files, and relationships already visible through the current principal's generated ThorAPI ACLs.
3. Run the durable build workflow. The server snapshots only authorized records, redacts non-portable authority fields, writes the graph, computes its digest, and signs the manifest.
4. Download the generated `.gmkp` archive.
5. Import it into the downloadable GrayMatter Light Local Server from the dashboard or `scripts/gm-knowledge-pack-import`.
6. Search imported `MemoryEntry` projections through the normal owner-scoped memory API and inspect the complete portable object graph through the KnowledgePack API.
7. Return to the Cloud build and explicitly launch the DigitalProductsPro draft handoff when the pack is ready to publish. Building a pack does not silently publish or monetize it.

## Archive contract

The MIME type is
`application/vnd.valkyrlabs.graymatter-knowledge-pack+zip`; the filename
extension is `.gmkp`.

Every version `1.0` archive contains:

| Entry | Purpose |
| --- | --- |
| `manifest.json` | Pack identity, format version, record counts, digest, ACL import policy, and embedding policy |
| `objects.jsonl` | Portable graph objects, one JSON object per line |
| `edges.jsonl` | Portable relationships, one JSON object per line |
| `blobs/...` | Optional file bytes addressed by their archive paths |
| `signature.json` | Ed25519 signature and X.509-encoded public key for the exact manifest bytes |

The content digest is SHA-256 over these bytes in order:

1. exact `objects.jsonl` bytes;
2. exact `edges.jsonl` bytes;
3. for each blob path in lexical order, its UTF-8 path bytes followed by its exact file bytes.

The signature covers the exact `manifest.json` bytes. Reformatting the
manifest after signing invalidates the archive.

## Security and trust model

KnowledgePack portability never carries authorization authority.

- The Cloud builder may read only records allowed by generated ThorAPI RBAC and ACL enforcement.
- `owner`, `ownerId`, `principal`, `principalId`, tenant, organization, ACL, and permission fields are forbidden in imported portable records.
- `manifest.json` must set `aclImportPolicy` to `do-not-transplant`.
- GrayMatter Light assigns the import to the authenticated local `Principal`; every list, detail, graph, archive, and projected memory query is owner-scoped in SQL.
- A different local principal receives `404` for a pack it does not own, avoiding an ownership oracle.
- The importer rejects unexpected ZIP entries, duplicate paths, traversal paths, oversized archives, excessive expansion, too many entries, oversized JSONL records, count mismatches, invalid JSON, digest failures, and signature failures.
- The full archive, manifest, graph records, and signature are retained for auditability and re-download.

The version `1.0` signature is self-contained. It proves that the archive has
not changed since the holder of the included private key signed it. It does
not, by itself, prove that the key belongs to a named publisher. Consumers
must display `trustModel` and `identityAssurance`; marketplace publisher trust
binding is a separate assurance layer. The version `1.0` Light importer only
accepts `self-contained-v1` with
`unverified-until-publisher-trust-binding`; an archive cannot promote its own
publisher assurance by editing unsigned signature metadata.

## Embeddings and search

Embeddings are intentionally not transplanted because model, dimension,
normalization, and index contracts can differ between Cloud and Light.
`manifest.json` must set `embeddingPolicy` to `regenerate-on-import`.

GrayMatter Light currently makes imported knowledge searchable immediately by
projecting `MemoryEntry` objects into its existing H2 `memory_entry` table.
Those rows retain their KnowledgePack and source-object references and remain
subject to the existing principal-scoped repository query. Search text is
bounded to 16,000 characters; the unabridged JSONL record remains in the
KnowledgePack graph. A local vector index can regenerate embeddings from that
trusted local content without changing the archive format.

Non-memory objects and all relationships remain available through the graph
endpoint even when they do not have a dedicated Light table.

## Start the correct Light runtime

KnowledgePack import is implemented by the downloadable Java/Spring Boot
**GrayMatter Light Local Server**, whose default URL is
`http://localhost:8787`. Build its archive with:

```bash
scripts/package-local-server
tar -xzf dist/graymatter-local-server-latest.tar.gz
cd graymatter-local-server
export GRAYMATTER_ADMIN_USERNAME=admin
read -rsp "GrayMatter Light password: " GRAYMATTER_ADMIN_PASSWORD
export GRAYMATTER_ADMIN_PASSWORD
./bin/graymatter-local-server
```

The Docker/ThorAPI developer subset started by `scripts/gm-light-up` defaults
to port `8080` and remains the api-0-shaped memory contract harness. It does
not claim the custom Java KnowledgePack importer. Use the downloadable Local
Server on port `8787` for `.gmkp` import until that generated subset advertises
the KnowledgePack paths in its live `/v1/api-docs`.

## Import from the dashboard

Open `http://localhost:8787`, enter the same Basic-auth credentials used to
start the server, choose a `.gmkp` archive in **KnowledgePacks**, and select
**Verify & Import**. The dashboard shows integrity status, trust/identity
assurance, object and edge counts, and imported searchable memory count.

## Import from the CLI

```bash
export GRAYMATTER_LIGHT_PUBLIC_BASE=http://localhost:8787
export GRAYMATTER_LIGHT_USERNAME=admin
read -rsp "GrayMatter Light password: " GRAYMATTER_LIGHT_PASSWORD
export GRAYMATTER_LIGHT_PASSWORD
scripts/gm-knowledge-pack-import ./my-agent-knowledge.gmkp | jq
```

Equivalent API call:

```bash
curl --fail-with-body \
  -u "$GRAYMATTER_LIGHT_USERNAME:$GRAYMATTER_LIGHT_PASSWORD" \
  -F 'file=@./my-agent-knowledge.gmkp;type=application/vnd.valkyrlabs.graymatter-knowledge-pack+zip' \
  http://localhost:8787/v1/knowledge-packs/import
```

Reimporting the same source pack ID and content digest for the same principal
returns the existing local pack with `alreadyImported: true`.

## API surface

All paths require local Basic authentication.

| Method and path | Behavior |
| --- | --- |
| `POST /v1/knowledge-packs/import` | Verify and import one multipart `.gmkp` file |
| `GET /v1/knowledge-packs` | List packs owned by the authenticated principal |
| `GET /v1/knowledge-packs/{id}` | Read an owner-scoped summary |
| `GET /v1/knowledge-packs/{id}/graph` | Read retained portable objects and edges |
| `GET /v1/knowledge-packs/{id}/archive` | Download the original verified archive |
| `GET /v1/MemoryEntry?q=term` | Search local memory, including imported projections |
| `GET /v1/api-docs` | Inspect the Light server contract |

Examples:

```bash
curl -u "$GRAYMATTER_LIGHT_USERNAME:$GRAYMATTER_LIGHT_PASSWORD" \
  http://localhost:8787/v1/knowledge-packs | jq

curl -u "$GRAYMATTER_LIGHT_USERNAME:$GRAYMATTER_LIGHT_PASSWORD" \
  http://localhost:8787/v1/knowledge-packs/LOCAL_PACK_ID/graph | jq

curl -u "$GRAYMATTER_LIGHT_USERNAME:$GRAYMATTER_LIGHT_PASSWORD" \
  'http://localhost:8787/v1/MemoryEntry?q=agentic%20workflow' | jq
```

## Persistence model

H2 stores:

- one `knowledge_pack` row with local owner, source identity, integrity data, counts, trust metadata, exact manifest/graph/signature text, and the complete original archive;
- zero or more `memory_entry` projections linked to the local pack and source object ID.

The default database is file-backed under `GRAYMATTER_DATA_DIR`. Back up that
directory only while the application is stopped or with an H2-safe backup
procedure.

## Import bounds

- uploaded archive: 64 MiB maximum;
- total uncompressed bytes: 128 MiB maximum;
- ZIP entries: 5,000 maximum;
- objects or edges: 5,000 records per JSONL file;
- one JSONL record: 4 MiB maximum;
- multipart request: 65 MB maximum.

These are defensive local-runtime limits, not marketplace product limits.
Larger products should be split into coherent, independently versioned packs.

## Verification checklist

Before distributing a pack:

1. Import it into a clean Local Server data directory.
2. Confirm the import returns `INTEGRITY_VERIFIED`.
3. Query a distinctive memory phrase through `/v1/MemoryEntry`.
4. Inspect `/graph` and compare object/edge counts to the manifest.
5. Reimport and confirm idempotency.
6. Attempt access as a second principal and confirm the pack is not visible.
7. Record the content digest and publisher identity-assurance state alongside the DigitalProductsPro listing.

The Java integration suite automates integrity, indexing, idempotency,
authentication, forbidden-authority, and cross-principal isolation checks.
