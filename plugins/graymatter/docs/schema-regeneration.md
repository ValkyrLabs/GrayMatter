# GrayMatter schema regeneration

GrayMatter Lite is generated from OpenAPI YAML through ThorAPI. The editable
source is `openapi/bundles/*.yaml`; generated Java, TypeScript, composed YAML,
and JSON are disposable output.

## Commands

```bash
./vaix generate
./vaix build
./vaix run
```

Use the fail-fast end-to-end workflow before committing a schema change:

```bash
./vaix regenerate
```

`./vaix` resolves a Java 17+ runtime and Maven privately under `.vaix/runtime`
when suitable system tools are unavailable. ThorAPI is pinned by
`THORAPI_VERSION` (default `1.0.3-SNAPSHOT`).

## Authoritative inputs

- `openapi/bundles/00-graymatter-core.yaml` defines the reusable GrayMatter
  domain and local compatibility operations.
- `openapi/extensions/customer-support.yaml` is the acceptance example, not a
  second core source of truth.
- `tools/schema-pipeline/` owns strict ordering, conflict detection, ThorAPI
  validation/enhancement, deterministic output, and YAML-to-JSON derivation.
- `openapi/generator/spring.yaml` selects ThorAPI's Spring supporting files.
- `openapi/generator/patches/` contains small, versioned compatibility patches
  for defects in the pinned public ThorAPI templates. Remove each patch when
  the corresponding upstream fix is released.

The older schema files inside `templates/graymatter-light-bootstrap/` are a
legacy Docker/bootstrap compatibility snapshot. They are not schema-authoring
inputs to `./vaix generate` and must not receive domain edits. The canonical
workflow overwrites every bundle/runtime OpenAPI copy from the composed YAML
and its derived JSON.

## Add an application domain

Create a standalone OpenAPI 3.0 YAML document with `info`, `paths`, and
`components.schemas`, then compose it without changing GrayMatter core:

```bash
./vaix generate --extension ./path/to/application-domain.yaml
./vaix build
./vaix run
```

Multiple `--extension` options are applied in command order after the
lexically ordered core bundles. Schema names and paths are globally unique;
duplicates fail with both owning files named. Use this working example:

```bash
./vaix generate --example-extension
```

ThorAPI adds generated audit, ownership, identifier, CRUD, repository,
service, controller, and client behavior. Do not author generated `id` or audit
properties. Mark request/response-only component schemas with
`x-thorapi-nonCrud: true`. Give persistent objects an
`x-thorapi-table-name`. Define object-shaped fields as named component schemas;
do not hide persistent structure in free-form inline objects.

The output bundle contains:

- `openapi/api.hbs.yaml`: composed YAML before ThorAPI enhancement;
- `openapi/api-out.yaml`: enhanced canonical runtime contract;
- `openapi/api-out.json`: JSON derived from that enhanced YAML;
- `openapi/generation-manifest.json`: deterministic input hashes and health;
- `local-server/generated/spring/`: generated JPA models, repositories,
  services, controllers, DTOs, and Spring support;
- `generated/typescript/`: generated TypeScript models and Redux Query client.

## Ownership boundary

Edit schemas, the schema pipeline, generator configuration, or the versioned
template patches. Never edit files beneath a generated output directory.

The source under
`templates/graymatter-light-bootstrap/local-server/src/main/java/.../localserver`
is handwritten. It owns local Basic authentication, starter data,
KnowledgePack archive handling, MCP-compatible routes, dashboard behavior, and
adapters around the generated contract. Generation clears only the exact
generated Spring and TypeScript directories, so these extensions survive.

The default `./vaix run` process uses the handwritten local-server entrypoint
while compiling and packaging the complete generated surface. The acceptance
test also boots ThorAPI's generated application entrypoint to prove an added
domain's generated controllers and repositories are runnable.

## Failure rules

Generation fails for malformed OpenAPI documents, duplicate schema/path
ownership, ThorAPI rule errors, unhealthy path injection, missing core
schemas/paths, missing generator artifacts, failed template patches, or
nondeterministic output. `./vaix build` performs a Maven clean before compile,
so deleted generated classes cannot survive in `target/` and mask drift.

Run the focused acceptance test with:

```bash
tests/schema_regeneration_test.sh
```

It generates twice and compares hashes, rejects a conflicting extension,
builds generated Java and TypeScript, starts the authenticated local runtime,
writes a memory, verifies the served contract, then starts the expanded
ThorAPI application and reads both `GrayMatter` and `CustomerCase` resources.

## MCP and verification

After `./vaix up`, the dashboard is at `http://localhost:8787`, HTTP MCP is at
`http://localhost:3333/mcp`, and credentials are available only on request:

```bash
./vaix credentials
./vaix doctor
```

The `x-graymatter-mcp-contract` extension in the canonical core schema maps MCP
memory tools to their HTTP operations.

## Public ThorAPI follow-ups

The pinned ThorAPI release still needs upstream fixes for:

1. `BundleAssembler` discards top-level extensions/security/externalDocs and
   component sections other than schemas/security schemes.
2. CRUD path injection ignores `x-thorapi-nonCrud` without a guarded include.
3. Java Spring delegates can emit duplicate `@Transactional` annotations.
4. Generated repositories unnecessarily extend `Serializable`; on newer JDKs
   Spring Data attempts to parse it as a repository fragment.
5. Generated `ThorApplication` scans `OpenApiGeneratorApplication` and
   registers controllers/delegates twice.
6. The generated Spring POM omits the ThorAPI runtime dependency.
7. DTO models marked `x-thorapi-nonCrud` still receive JPA entity annotations,
   creating unnecessary tables and reserved-word portability hazards.
8. ThorAPI's CLI can terminate inside validation instead of returning a
   structured exception; this pipeline pre-validates to preserve diagnostics.
9. OpenAPI Generator on Java 26 warns about reflective mutation of final
   template-definition fields, which a future JDK will block by default.

The local compatibility patches are deliberately narrow. Schema omissions are
fixed in canonical YAML, never hidden in generated source.
