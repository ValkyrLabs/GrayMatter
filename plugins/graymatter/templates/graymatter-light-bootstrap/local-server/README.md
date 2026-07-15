# GrayMatter Local Server

GrayMatter Local Server is a downloadable, executable starter for private agent memory.

It runs a minimum Spring Boot server on your machine with:

- RBAC-backed login through Spring Security
- `Principal` identity records
- `UserPreferences` for local user state
- `MemoryEntry` create/query APIs through `/v1/MemoryEntry/*`
- signed `.gmkp` KnowledgePack import, graph inspection, and archive retrieval through `/v1/knowledge-packs/*`
- Data Workbooks through the `/v1/Workbook` API
- an embedded Valkyr Labs-branded dashboard at `http://localhost:8787`
- a Cloud activation bridge at `/v1/graymatter/activation/bridge`
- a local GrayMatter SWARM v0.1 light-node adapter at `/v1/swarm-ops/graph`
- a ValkyrAI app-factory `application-bundle` with ThorAPI FEBE inputs
- H2 file storage under the user-local GrayMatter app data directory
- a Maven native profile for GraalVM/Spring Native builds

## Run

Set local admin credentials before launch:

```bash
export GRAYMATTER_ADMIN_USERNAME=admin
read -rsp "GrayMatter admin password: " GRAYMATTER_ADMIN_PASSWORD
export GRAYMATTER_ADMIN_PASSWORD
bin/graymatter-local-server
```

## Build from source

```bash
cd source
./mvnw package
```

If the archive includes `lib/graymatter-local-server.jar`, the launcher runs it directly.
Otherwise it builds from `source` with local Maven or the Maven wrapper.

## Promote / Synchronize

The dashboard button calls `POST /v1/graymatter/activation/bridge/event`.
This prepares a promotion payload and reports the local bundle, memory, workbook,
and Swarm Protocol state. It does not claim hosted synchronization completed
unless the operator supplies hosted auth such as `VALKYR_AUTH_TOKEN`.

## Import a KnowledgePack

Build and download a `.gmkp` archive from the GrayMatter homepage, then import
it from the dashboard or API:

```bash
curl --fail-with-body \
  -u "${GRAYMATTER_ADMIN_USERNAME:-admin}:$GRAYMATTER_ADMIN_PASSWORD" \
  -F 'file=@./my-pack.gmkp;type=application/vnd.valkyrlabs.graymatter-knowledge-pack+zip' \
  http://localhost:8787/v1/knowledge-packs/import
```

The importer fails closed unless all of the following pass:

- ZIP path, entry-count, compressed-size, and uncompressed-size bounds
- required `manifest.json`, `objects.jsonl`, `edges.jsonl`, and `signature.json` entries
- format `graymatter.knowledge-pack` version `1.0`
- SHA-256 content digest over graph records and ordered blobs
- Ed25519 signature over the exact `manifest.json` bytes
- manifest record/blob counts
- `do-not-transplant` ACL policy and absence of source owner, tenant, principal, ACL, or permission fields
- `regenerate-on-import` embedding policy

Successful imports are idempotent per local principal, source pack ID, and
content digest. The original archive and portable graph are retained in H2;
portable `MemoryEntry` records are projected into the existing owner-scoped
search API. Search excerpts are bounded to 16,000 characters while the full
record remains available from the graph endpoint.

```bash
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" http://localhost:8787/v1/knowledge-packs
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" http://localhost:8787/v1/knowledge-packs/LOCAL_ID/graph
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" 'http://localhost:8787/v1/MemoryEntry?q=search-term'
```

An archive's self-contained public key proves integrity and internal
consistency; it does not prove who published it. The API therefore preserves
the archive's `trustModel` and `identityAssurance` instead of overstating
publisher identity. A future marketplace trust binding can add publisher
assurance without weakening this local integrity gate. Version `1.0` accepts
only the explicit `self-contained-v1` / `unverified-until-publisher-trust-binding`
pair, so an archive cannot claim stronger publisher assurance for itself.

See `KNOWLEDGE_PACKS.md` in the downloadable distribution for the complete
cloud-to-Light-to-DigitalProductsPro lifecycle and archive contract.

Swarm Protocol status is exposed locally at:

```bash
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" http://localhost:8787/v1/swarm-ops/graph
```

## Native build

With GraalVM native-image installed:

```bash
cd source
./mvnw -Pnative native:compile
```
