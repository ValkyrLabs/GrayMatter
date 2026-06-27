#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-light-up.XXXXXX")"
FAKE_BIN="$TMP_DIR/bin"
BUNDLE_DIR="$TMP_DIR/bundle"
PLUGIN_BUNDLE_DIR="$TMP_DIR/plugin-bundle"
DOCKER_LOG="$TMP_DIR/docker.log"
CURL_LOG="$TMP_DIR/curl.log"
PLUGIN_DOCKER_LOG="$TMP_DIR/plugin-docker.log"
PLUGIN_CURL_LOG="$TMP_DIR/plugin-curl.log"

trap 'rm -rf "$TMP_DIR" >/dev/null 2>&1 || true' EXIT
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'GRAYMATTER_LIGHT_PORT=%s THORAPI_IMAGE=%s docker %s\n' "${GRAYMATTER_LIGHT_PORT:-}" "${THORAPI_IMAGE:-}" "$*" >>"${TEST_DOCKER_LOG:?}"
if [[ "${1:-}" == "info" ]]; then
  exit 0
fi
if [[ "${1:-}" == "compose" ]]; then
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 2
EOF
chmod +x "$FAKE_BIN/docker"

cat >"$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"${TEST_CURL_LOG:?}"
case "$*" in
  *"/actuator/health"*) printf '{"status":"UP"}\n' ;;
  *) printf '{}\n' ;;
esac
EOF
chmod +x "$FAKE_BIN/curl"

export TEST_DOCKER_LOG="$DOCKER_LOG"
export TEST_CURL_LOG="$CURL_LOG"

PATH="$FAKE_BIN:/usr/bin:/bin" \
  "$ROOT/scripts/gm-light-up" \
  --bundle-dir "$BUNDLE_DIR" \
  --port 8899 \
  --image example/thorapi:test \
  --timeout 1 >"$TMP_DIR/output.txt"

[[ -f "$BUNDLE_DIR/api.hbs.yaml" ]]
[[ -f "$BUNDLE_DIR/api.yaml" ]]
[[ -f "$BUNDLE_DIR/dashboard/index.html" ]]
[[ -f "$BUNDLE_DIR/.graymatter-light-env" ]]

grep -q "docker info" "$DOCKER_LOG"
grep -q "GRAYMATTER_LIGHT_PORT=8899 THORAPI_IMAGE=example/thorapi:test docker compose -f $BUNDLE_DIR/docker-compose.yaml up -d" "$DOCKER_LOG"
grep -q "curl .*http://localhost:8899/actuator/health" "$CURL_LOG"
grep -q "export VALKYR_API_BASE='http://localhost:8899/v1'" "$BUNDLE_DIR/.graymatter-light-env"
grep -q "export THORAPI_IMAGE='example/thorapi:test'" "$BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_MODE='true'" "$BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_BUNDLE_DIR='$BUNDLE_DIR'" "$BUNDLE_DIR/.graymatter-light-env"
grep -q "{{server_url}}" "$BUNDLE_DIR/api.hbs.yaml"
grep -q "http://localhost:8899" "$BUNDLE_DIR/api.yaml"
if grep -q "{{server_url}}" "$BUNDLE_DIR/api.yaml"; then
  echo "Rendered api.yaml should not contain template placeholders" >&2
  exit 1
fi
grep -q "VALKYR_API_BASE=http://localhost:8899/v1" "$TMP_DIR/output.txt"

"$ROOT/scripts/gm-light-env" --bundle-dir "$BUNDLE_DIR" >"$TMP_DIR/env.out"
grep -q "export VALKYR_API_BASE='http://localhost:8899/v1'" "$TMP_DIR/env.out"

export TEST_DOCKER_LOG="$PLUGIN_DOCKER_LOG"
export TEST_CURL_LOG="$PLUGIN_CURL_LOG"

PATH="$FAKE_BIN:/usr/bin:/bin" \
  "$ROOT/plugins/graymatter/scripts/gm-light-up" \
  --bundle-dir "$PLUGIN_BUNDLE_DIR" \
  --port 8898 \
  --image example/thorapi:plugin-test \
  --timeout 1 >"$TMP_DIR/plugin-output.txt"

[[ -f "$PLUGIN_BUNDLE_DIR/api.hbs.yaml" ]]
[[ -f "$PLUGIN_BUNDLE_DIR/api.yaml" ]]
[[ -f "$PLUGIN_BUNDLE_DIR/dashboard/index.html" ]]
[[ -f "$PLUGIN_BUNDLE_DIR/.graymatter-light-env" ]]

grep -q "docker info" "$PLUGIN_DOCKER_LOG"
grep -q "GRAYMATTER_LIGHT_PORT=8898 THORAPI_IMAGE=example/thorapi:plugin-test docker compose -f $PLUGIN_BUNDLE_DIR/docker-compose.yaml up -d" "$PLUGIN_DOCKER_LOG"
grep -q "curl .*http://localhost:8898/actuator/health" "$PLUGIN_CURL_LOG"
grep -q "export VALKYR_API_BASE='http://localhost:8898/v1'" "$PLUGIN_BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_API_BASE='http://localhost:8898/v1'" "$PLUGIN_BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_PUBLIC_BASE='http://localhost:8898'" "$PLUGIN_BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_MODE='true'" "$PLUGIN_BUNDLE_DIR/.graymatter-light-env"
grep -q "export GRAYMATTER_LIGHT_BUNDLE_DIR='$PLUGIN_BUNDLE_DIR'" "$PLUGIN_BUNDLE_DIR/.graymatter-light-env"
grep -q "{{server_url}}" "$PLUGIN_BUNDLE_DIR/api.hbs.yaml"
grep -q "http://localhost:8898" "$PLUGIN_BUNDLE_DIR/api.yaml"
if grep -q "{{server_url}}" "$PLUGIN_BUNDLE_DIR/api.yaml"; then
  echo "Rendered plugin api.yaml should not contain template placeholders" >&2
  exit 1
fi
grep -q "VALKYR_API_BASE=http://localhost:8898/v1" "$TMP_DIR/plugin-output.txt"

"$ROOT/plugins/graymatter/scripts/gm-light-env" --bundle-dir "$PLUGIN_BUNDLE_DIR" >"$TMP_DIR/plugin-env.out"
grep -q "export VALKYR_API_BASE='http://localhost:8898/v1'" "$TMP_DIR/plugin-env.out"
grep -q "export GRAYMATTER_LIGHT_PUBLIC_BASE='http://localhost:8898'" "$TMP_DIR/plugin-env.out"

echo "gm_light_up_test: ok"
