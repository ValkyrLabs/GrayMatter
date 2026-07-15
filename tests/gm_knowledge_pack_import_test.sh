#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-pack-import-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE="$TMP_DIR/portable.GmKp"
CALLS="$TMP_DIR/curl.calls"
touch "$ARCHIVE"

mkdir -p "$TMP_DIR/bin"
cat >"$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$GM_TEST_CURL_CALLS"
printf '{"integrityStatus":"INTEGRITY_VERIFIED"}\n'
EOF
chmod 755 "$TMP_DIR/bin/curl"

response="$(
  PATH="$TMP_DIR/bin:$PATH" \
  GM_TEST_CURL_CALLS="$CALLS" \
  GRAYMATTER_LIGHT_PASSWORD='test-password' \
  VALKYR_API_BASE='http://127.0.0.1:9876/v1' \
  "$ROOT/scripts/gm-knowledge-pack-import" "$ARCHIVE"
)"

jq -e '.integrityStatus == "INTEGRITY_VERIFIED"' <<<"$response" >/dev/null
grep -Fxq 'http://127.0.0.1:9876/v1/knowledge-packs/import' "$CALLS"
grep -Fxq -- '--form' "$CALLS"
grep -Fq "file=@${ARCHIVE};type=application/vnd.valkyrlabs.graymatter-knowledge-pack+zip" "$CALLS"

if GRAYMATTER_LIGHT_PASSWORD='test-password' \
  "$ROOT/scripts/gm-knowledge-pack-import" "$TMP_DIR/not-a-pack.zip" >/dev/null 2>&1; then
  echo "Expected non-.gmkp archive to fail" >&2
  exit 1
fi

echo "gm_knowledge_pack_import_test: ok"
