#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-local-server-package.XXXXXX")"
DIST_DIR="$TMP_DIR/dist"
TARBALL="$DIST_DIR/graymatter-local-server-latest.tar.gz"
PLUGIN_DIST_DIR="$TMP_DIR/plugin-dist"
PLUGIN_TARBALL="$PLUGIN_DIST_DIR/graymatter-local-server-latest.tar.gz"
trap 'rm -rf "$TMP_DIR" >/dev/null 2>&1 || true' EXIT

assert_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing expected file: $1" >&2
    exit 1
  fi
}

assert_executable() {
  if [[ ! -x "$1" ]]; then
    echo "Expected executable file: $1" >&2
    exit 1
  fi
}

assert_contains() {
  local pattern="$1"
  local file="$2"
  if ! grep -q "$pattern" "$file"; then
    echo "Expected '$pattern' in $file" >&2
    exit 1
  fi
}

assert_not_contains() {
  local pattern="$1"
  local file="$2"
  if grep -q "$pattern" "$file"; then
    echo "Did not expect '$pattern' in $file" >&2
    exit 1
  fi
}

assert_manifest_entry() {
  local entry="$1"
  if ! grep -q "^$entry$" "$TMP_DIR/contents.txt"; then
    echo "Archive is missing expected entry: $entry" >&2
    exit 1
  fi
}

mkdir -p "$DIST_DIR"

GRAYMATTER_SKIP_SERVER_BUILD=true \
  "$ROOT/scripts/package-local-server" \
  --out-dir "$DIST_DIR" \
  --work-dir "$TMP_DIR/work" > /dev/null 2>"$TMP_DIR/package.stderr"

assert_file "$TARBALL"
assert_not_contains "argument for --compress is deprecated" "$TMP_DIR/package.stderr"

tar -tzf "$TARBALL" | sort > "$TMP_DIR/contents.txt"

assert_manifest_entry 'graymatter-local-server/README.md'
assert_manifest_entry 'graymatter-local-server/manifest.json'
assert_manifest_entry 'graymatter-local-server/application-bundle/template.json'
assert_manifest_entry 'graymatter-local-server/application-bundle/openapi.json'
assert_manifest_entry 'graymatter-local-server/application-bundle/components/graymatter-dashboard.yaml'
assert_manifest_entry 'graymatter-local-server/application-bundle/components/live-telemetry.yaml'
assert_manifest_entry 'graymatter-local-server/application-bundle/components/mothership-sync.yaml'
assert_manifest_entry 'graymatter-local-server/application-bundle/components/swarm-protocol.yaml'
assert_manifest_entry 'graymatter-local-server/application-bundle/valkyr-components/data-workbooks.yaml'
assert_manifest_entry 'graymatter-local-server/bin/graymatter-local-server'
assert_manifest_entry 'graymatter-local-server/source/pom.xml'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/GrayMatterLocalServerApplication.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/controller/LiveTelemetryController.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/controller/MothershipSyncController.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/controller/OpenApiController.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/controller/SwarmProtocolController.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/java/com/valkyrlabs/graymatter/localserver/controller/WorkbookController.java'
assert_manifest_entry 'graymatter-local-server/source/src/main/resources/openapi.json'
assert_manifest_entry 'graymatter-local-server/source/src/main/resources/static/index.html'

tar -xzf "$TARBALL" -C "$TMP_DIR"

assert_executable "$TMP_DIR/graymatter-local-server/bin/graymatter-local-server"
assert_contains '"artifactId": "graymatter-local-server"' "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains '"generationMode": "thorapi-febe"' "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains '"sourceTemplate": "graymatter-local"' "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains "MothershipPromotionBridge" "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains "SwarmProtocolBridge" "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains "LiveTelemetryPanel" "$TMP_DIR/graymatter-local-server/manifest.json"
assert_contains "GrayMatter Local Server" "$TMP_DIR/graymatter-local-server/README.md"
assert_contains "spring-boot-starter-parent" "$TMP_DIR/graymatter-local-server/source/pom.xml"
assert_contains "/v1/memory/status" "$TMP_DIR/graymatter-local-server/application-bundle/openapi.json"
assert_contains "/v1/graymatter/activation/bridge/event" "$TMP_DIR/graymatter-local-server/application-bundle/openapi.json"
assert_contains "/v1/swarm-ops/graph" "$TMP_DIR/graymatter-local-server/application-bundle/openapi.json"
assert_contains "/v1/Workbook" "$TMP_DIR/graymatter-local-server/application-bundle/openapi.json"
assert_contains "/v1/api-docs" "$TMP_DIR/graymatter-local-server/source/src/main/resources/openapi.json"
assert_contains "x-graymatter-mcp-contract" "$TMP_DIR/graymatter-local-server/source/src/main/resources/openapi.json"

mkdir -p "$PLUGIN_DIST_DIR"
GRAYMATTER_SKIP_SERVER_BUILD=true \
  GRAYMATTER_SKIP_RUNTIME_BUNDLE=true \
  "$ROOT/plugins/graymatter/scripts/package-local-server" \
  --out-dir "$PLUGIN_DIST_DIR" \
  --work-dir "$TMP_DIR/plugin-work" > /dev/null 2>"$TMP_DIR/plugin-package.stderr"

assert_file "$PLUGIN_TARBALL"
assert_not_contains "argument for --compress is deprecated" "$TMP_DIR/plugin-package.stderr"
tar -tzf "$PLUGIN_TARBALL" | sort > "$TMP_DIR/plugin-contents.txt"
grep -q '^graymatter-local-server/README.md$' "$TMP_DIR/plugin-contents.txt"
grep -q '^graymatter-local-server/manifest.json$' "$TMP_DIR/plugin-contents.txt"
grep -q '^graymatter-local-server/application-bundle/openapi.json$' "$TMP_DIR/plugin-contents.txt"
grep -q '^graymatter-local-server/bin/graymatter-local-server$' "$TMP_DIR/plugin-contents.txt"
grep -q '^graymatter-local-server/source/src/main/resources/openapi.json$' "$TMP_DIR/plugin-contents.txt"

echo "package_local_server_test: ok"
