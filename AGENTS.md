# GrayMatter repository instructions

The canonical GrayMatter domain is `openapi/bundles/00-graymatter-core.yaml`.
Read `docs/schema-regeneration.md` before changing schemas or generated APIs.

Use these repository entrypoints:

```bash
./vaix generate                         # core domain
./vaix generate --extension FILE        # core + application domain
./vaix generate --example-extension     # checked example
./vaix regenerate --example-extension   # generate + clean build + tests
./vaix run
./vaix doctor
```

Do not edit `local-server/generated/spring`, `generated/typescript`, composed
`api.hbs.yaml`, enhanced `api.yaml`, or derived OpenAPI JSON. Change canonical
YAML, pipeline code, or a reviewed versioned generator patch, then regenerate.
Preserve ThorAPI ownership, audit, ACL, RBAC, and secure-field behavior.

Handwritten local adapters live under
`templates/graymatter-light-bootstrap/local-server/src/main/java/.../localserver`
and must survive regeneration. The schema acceptance test is
`tests/schema_regeneration_test.sh`.
