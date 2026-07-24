#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-self-update"
LAUNCHER="$ROOT/scripts/gm-mcp-launcher"
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
install="$tmp/install"
state="$tmp/state"
release="$tmp/release"
install_id="gm-self-update-test"
mkdir -p "$install/scripts" "$install/.codex-plugin" "$release"
cp "$SCRIPT" "$install/scripts/gm-self-update"
cp "$LAUNCHER" "$install/scripts/gm-mcp-launcher"
cp "$ROOT/scripts/gm-schema-cache-lib" "$install/scripts/gm-schema-cache-lib"
chmod +x "$install/scripts/"*
printf '{"name":"graymatter","version":"0.3.1"}\n' >"$install/.codex-plugin/plugin.json"
printf '{"mcpServers":{"graymatter":{"command":"scripts/gm-mcp-launcher","args":["--stdio"]}}}\n' >"$install/.mcp.json"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmp/private.pem" 2>/dev/null
openssl rsa -in "$tmp/private.pem" -pubout -out "$tmp/public.pem" 2>/dev/null

make_release() {
  local version="$1"
  local marker="$2"
  local payload="$release/payload-$version"
  local artifact="$release/graymatter-$version.tar.gz"
  rm -rf "$payload"
  mkdir -p "$payload/graymatter/.codex-plugin" "$payload/graymatter/mcp-server" "$payload/graymatter/scripts"
  printf '{"name":"graymatter","version":"%s"}\n' "$version" >"$payload/graymatter/.codex-plugin/plugin.json"
  printf '{"mcpServers":{"graymatter":{"command":"scripts/gm-mcp-launcher","args":["--stdio"]}}}\n' >"$payload/graymatter/.mcp.json"
  printf 'process.stdout.write("%s\\n");\n' "$marker" >"$payload/graymatter/mcp-server/index.js"
  cp "$LAUNCHER" "$payload/graymatter/scripts/gm-mcp-launcher"
  cp "$SCRIPT" "$payload/graymatter/scripts/gm-self-update"
  cp "$ROOT/scripts/gm-schema-cache-lib" "$payload/graymatter/scripts/gm-schema-cache-lib"
  chmod +x "$payload/graymatter/scripts/"*
  tar -czf "$artifact" -C "$payload" graymatter
  sha="$(sha256sum "$artifact" | awk '{print $1}')"
  jq -n --arg version "$version" --arg url "file://$artifact" --arg sha "$sha" \
    --arg signature "file://$artifact.sig" \
    '{channel:"stable",version:$version,artifactUrl:$url,artifactSha256:$sha,artifactSignatureUrl:$signature}' >"$release/manifest.json"
  openssl dgst -sha256 -sign "$tmp/private.pem" -out "$release/manifest.sig" "$release/manifest.json"
  openssl dgst -sha256 -sign "$tmp/private.pem" -out "$artifact.sig" "$artifact"
  printf '%s\n' "$artifact"
}

artifact="$(make_release 0.3.2 upgraded)"
run_update() {
  GRAYMATTER_RELEASE_MANIFEST_URL="file://$release/manifest.json" \
  GRAYMATTER_RELEASE_MANIFEST_SIGNATURE_URL="file://$release/manifest.sig" \
  GRAYMATTER_RELEASE_PUBLIC_KEY_FILE="$tmp/public.pem" \
  GRAYMATTER_STATE_DIR="$state" \
  GRAYMATTER_INSTALLATIONS_DIR="$tmp/versions" \
  GRAYMATTER_INSTALL_ID="$install_id" \
  GRAYMATTER_SELF_UPDATE_STATE="$tmp/explicit-state.json" \
  "$install/scripts/gm-self-update" force
}

install_key="$(printf '%s' "$install|$install_id|stable" | sha256sum | awk '{print $1}')"
active_state="$state/update-active/$install_key.json"

run_update >"$tmp/update.out"
active="$(grep '^active_root=' "$tmp/update.out" | cut -d= -f2-)"
[[ -d "$active" ]] || fail "signed release should be staged in a versioned installation directory"
[[ "$(jq -r '.status' "$tmp/explicit-state.json")" == "updated" ]] || fail "successful signed update should record updated state"
[[ "$(cat "$install/.codex-plugin/plugin.json")" == '{"name":"graymatter","version":"0.3.1"}' ]] || fail "running install must not be rewritten in place"

artifact="$(make_release 0.3.3 broken-sha)"
jq --arg version 0.3.3 --arg url "file://$artifact" --arg signature "file://$artifact.sig" \
  '{channel:"stable",version:$version,artifactUrl:$url,artifactSha256:"0000000000000000000000000000000000000000000000000000000000000000",artifactSignatureUrl:$signature}' >"$release/manifest.json"
openssl dgst -sha256 -sign "$tmp/private.pem" -out "$release/manifest.sig" "$release/manifest.json"
set +e
run_update >"$tmp/failed.out" 2>"$tmp/failed.err"
failed_status=$?
set -e
[[ "$failed_status" -ne 0 ]] || fail "failed signature/content verification must fail"
[[ "$(jq -r '.status' "$tmp/explicit-state.json")" == "failed" ]] || fail "failed update must be surfaced in keyed state"
[[ "$(jq -r '.activeRoot' "$active_state")" == "$active" ]] || fail "failed update must preserve the active release for rollback"

artifact="$(make_release 0.3.3 upgraded-v3)"
run_update >"$tmp/update-v3.out"
active_v3="$(grep '^active_root=' "$tmp/update-v3.out" | cut -d= -f2-)"
[[ "$(jq -r '.previousRoot' "$active_state")" == "$active" ]] || fail "new release must preserve the previous version for rollback"

restart_output="$(
  GRAYMATTER_RELEASE_MANIFEST_URL="file://$release/manifest.json" \
  GRAYMATTER_RELEASE_MANIFEST_SIGNATURE_URL="file://$release/manifest.sig" \
  GRAYMATTER_RELEASE_PUBLIC_KEY_FILE="$tmp/public.pem" \
  GRAYMATTER_STATE_DIR="$state" \
  GRAYMATTER_INSTALLATIONS_DIR="$tmp/versions" \
  GRAYMATTER_INSTALL_ID="$install_id" \
  GRAYMATTER_SELF_UPDATE_STATE="$tmp/explicit-state.json" \
  GRAYMATTER_SKIP_STARTUP_AUTH=true \
  GRAYMATTER_SKIP_OPENAPI_SYNC=true \
  "$install/scripts/gm-mcp-launcher" --stdio
)"
[[ "$restart_output" == "upgraded-v3" ]] || fail "MCP launcher should restart onto the upgraded versioned installation"

rollback_output="$(GRAYMATTER_STATE_DIR="$state" GRAYMATTER_INSTALLATIONS_DIR="$tmp/versions" GRAYMATTER_INSTALL_ID="$install_id" GRAYMATTER_SELF_UPDATE_STATE="$tmp/explicit-state.json" "$install/scripts/gm-self-update" rollback)"
[[ "$rollback_output" == "active_root=$active" ]] || fail "rollback should atomically restore the prior version"

echo "gm_self_update_test.sh: PASS"
