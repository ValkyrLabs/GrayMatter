#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/graymatter-regeneration.XXXXXX")"
STATE_DIR="${TEST_ROOT}/state"
BUNDLE_DIR="${TEST_ROOT}/bundle"
SERVER_PID=""
GENERATED_SERVER_PID=""
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

[[ -x "$NODE_BIN" ]] || {
  echo "A working Node.js executable is required for schema acceptance" >&2
  exit 1
}

hash_files() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

free_port() {
  "$NODE_BIN" -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  '
}

cleanup() {
  local status="$?"
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$GENERATED_SERVER_PID" ]] && kill -0 "$GENERATED_SERVER_PID" 2>/dev/null; then
    kill "$GENERATED_SERVER_PID" 2>/dev/null || true
  fi
  if [[ "$status" -ne 0 ]]; then
    for log in "$TEST_ROOT/server.log" "$TEST_ROOT/generated-server.log"; do
      if [[ -s "$log" ]]; then
        echo "--- ${log##*/} ---" >&2
        tail -80 "$log" >&2
      fi
    done
  fi
  rm -rf "$TEST_ROOT"
  return "$status"
}
trap cleanup EXIT

run_generate() {
  VAIX_STATE_DIR="$STATE_DIR" GRAYMATTER_LITE_BUNDLE_DIR="$BUNDLE_DIR" \
    "$ROOT/vaix" generate --example-extension >/dev/null
}

run_generate

[[ "$(head -c 1 "$ROOT/openapi/bundles/00-graymatter-core.yaml")" != "{" ]]
[[ -f "$BUNDLE_DIR/openapi/generation-manifest.json" ]]
[[ -f "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/GrayMatter.java" ]]
[[ -f "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/CustomerCase.java" ]]
[[ -f "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/api/CustomerCaseRepository.java" ]]
[[ -f "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/CustomerCaseService.java" ]]
[[ -f "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/api/CustomerCaseApiController.java" ]]
[[ -f "$BUNDLE_DIR/generated/typescript/src/models/CustomerCase.ts" ]]
[[ -f "$BUNDLE_DIR/generated/typescript/redux/services/MemoryEntryService.tsx" ]]
grep -q 'DO NOT EDIT: GENERATED FILE' \
  "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/GrayMatter.java"

"$NODE_BIN" - "$BUNDLE_DIR/openapi/api-out.json" <<'JS'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const schemas = spec.components.schemas;
const paths = spec.paths;
const required = [
  "Principal", "Authority", "Role", "GrayMatter", "MemoryEntry",
  "MemoryRetentionPolicy", "UserPreference", "Workbook", "KnowledgePack",
  "CustomerCase", "CustomerCaseEvent",
];
const missing = required.filter(name => !Object.hasOwn(schemas, name)).sort();
assert.deepEqual(missing, [], `missing schemas: ${missing.join(", ")}`);
for (const path of ["/GrayMatter", "/MemoryEntry", "/CustomerCase", "/MemoryEntry/query",
  "/memory/semantic-index/search", "/graymatter/retrieval-context",
  "/graymatter-retrieval-receipts/{id}",
  "/graymatter/retrieval-context/{id}/hydrate/{memoryId}"]) {
  assert.ok(Object.hasOwn(paths, path), `missing path: ${path}`);
}
assert.ok(!Object.hasOwn(paths, "/CreateMemoryEntryRequest"));
assert.equal(spec["x-thorapi-generation-health"].status, "ok");
assert.equal(spec["x-graymatter-mcp-contract"].mappings.memory_put, "POST /MemoryEntry/write");
const generated = require("node:path").join(require("node:path").dirname(process.argv[2]), "../generated/typescript");
const tsconfig = JSON.parse(fs.readFileSync(require("node:path").join(generated, "tsconfig.json"), "utf8"));
assert.deepEqual(tsconfig.compilerOptions.paths["@thorapi/model"], ["./src/models/index.ts"]);
for (const source of ["src", "redux", "utils", "types"]) assert.ok(tsconfig.include.includes(source));
assert.ok(fs.existsSync(require("node:path").join(generated, "src/models/DataObject.ts")));
assert.ok(fs.existsSync(require("node:path").join(generated, "src/types/import-meta-env.d.ts")));
JS

first_hashes="$(hash_files \
  "$BUNDLE_DIR/openapi/api.hbs.yaml" \
  "$BUNDLE_DIR/openapi/api-out.yaml" \
  "$BUNDLE_DIR/openapi/api-out.json" \
  "$BUNDLE_DIR/openapi/generation-manifest.json" \
  "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/CustomerCase.java")"
run_generate
second_hashes="$(hash_files \
  "$BUNDLE_DIR/openapi/api.hbs.yaml" \
  "$BUNDLE_DIR/openapi/api-out.yaml" \
  "$BUNDLE_DIR/openapi/api-out.json" \
  "$BUNDLE_DIR/openapi/generation-manifest.json" \
  "$BUNDLE_DIR/local-server/generated/spring/src/main/java/com/valkyrlabs/graymatter/generated/model/CustomerCase.java")"
[[ "$first_hashes" == "$second_hashes" ]] || {
  echo "ThorAPI regeneration is not deterministic" >&2
  diff -u <(printf '%s\n' "$first_hashes") <(printf '%s\n' "$second_hashes") >&2 || true
  exit 1
}

cat >"$TEST_ROOT/conflict.yaml" <<'YAML'
openapi: 3.0.3
info: {title: conflicting extension, version: 1.0.0}
paths: {}
components:
  schemas:
    MemoryEntry:
      type: object
      properties:
        replacement: {type: string}
YAML
if VAIX_STATE_DIR="$STATE_DIR" GRAYMATTER_LITE_BUNDLE_DIR="$TEST_ROOT/conflict-bundle" \
  "$ROOT/vaix" generate --extension "$TEST_ROOT/conflict.yaml" \
  >"$TEST_ROOT/conflict.out" 2>&1; then
  echo "Conflicting extension unexpectedly generated" >&2
  exit 1
fi
grep -q "Conflicting schema 'MemoryEntry'" "$TEST_ROOT/conflict.out"

VAIX_STATE_DIR="$STATE_DIR" GRAYMATTER_LITE_BUNDLE_DIR="$BUNDLE_DIR" \
  "$ROOT/vaix" build >/dev/null

JAVA_BIN=""
if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
  JAVA_BIN="${JAVA_HOME}/bin/java"
elif [[ -x /usr/libexec/java_home ]]; then
  JAVA_BIN="$(/usr/libexec/java_home)/bin/java"
else
  JAVA_BIN="$(command -v java)"
fi
[[ -x "$JAVA_BIN" ]] || {
  echo "A working Java executable is required for the runtime acceptance check" >&2
  exit 1
}

PORT="$(free_port)"
SERVER_PORT="$PORT" \
GRAYMATTER_ADMIN_USERNAME=admin \
GRAYMATTER_ADMIN_PASSWORD='GrayMatter-Test-123' \
GRAYMATTER_DATA_DIR="$TEST_ROOT/data" \
"$JAVA_BIN" -jar "$BUNDLE_DIR/local-server/lib/graymatter-local-server.jar" \
  >"$TEST_ROOT/server.log" 2>&1 &
SERVER_PID="$!"

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/actuator/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "http://127.0.0.1:${PORT}/actuator/health" | grep -q '"status":"UP"'
curl -fsS -u 'admin:GrayMatter-Test-123' \
  "http://127.0.0.1:${PORT}/v1/memory/status" | grep -q '"memory.entries"'
curl -fsS -u 'admin:GrayMatter-Test-123' -H 'Content-Type: application/json' \
  -d '{"text":"regeneration acceptance memory","type":"context"}' \
  "http://127.0.0.1:${PORT}/v1/MemoryEntry/write" | grep -q 'regeneration acceptance memory'
curl -fsS -u 'admin:GrayMatter-Test-123' \
  "http://127.0.0.1:${PORT}/v1/api-docs" >"$TEST_ROOT/runtime-openapi.json"
"$NODE_BIN" - "$TEST_ROOT/runtime-openapi.json" <<'JS'
const fs = require("node:fs");
const assert = require("node:assert/strict");
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.ok(Object.hasOwn(spec.components.schemas, "CustomerCase"));
assert.ok(Object.hasOwn(spec.paths, "/CustomerCase"));
JS

kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""

GENERATED_PORT="$(free_port)"
"$JAVA_BIN" \
  -Dloader.main=com.valkyrlabs.graymatter.generated.api.ThorApplication \
  -Dserver.port="$GENERATED_PORT" \
  '-Dspring.datasource.url=jdbc:h2:mem:graymatter-generated;DB_CLOSE_DELAY=-1;NON_KEYWORDS=LIMIT,VALUE' \
  -cp "$BUNDLE_DIR/local-server/lib/graymatter-local-server.jar" \
  org.springframework.boot.loader.launch.PropertiesLauncher \
  >"$TEST_ROOT/generated-server.log" 2>&1 &
GENERATED_SERVER_PID="$!"

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${GENERATED_PORT}/v1/CustomerCase" \
      >"$TEST_ROOT/customer-cases.json" 2>/dev/null; then
    break
  fi
  sleep 1
done
grep -q '^\[\]$' "$TEST_ROOT/customer-cases.json"
curl -fsS "http://127.0.0.1:${GENERATED_PORT}/v1/GrayMatter" | grep -q '^\[\]$'

echo "schema_regeneration_test: ok"
