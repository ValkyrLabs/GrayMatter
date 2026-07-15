#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-local-server-runtime.XXXXXX")"
DIST_DIR="$TMP_DIR/dist"
TARBALL="$DIST_DIR/graymatter-local-server-latest.tar.gz"
PORT="${GRAYMATTER_RUNTIME_TEST_PORT:-8790}"
LOGIN_FIELD="GRAYMATTER_ADMIN_$(printf '%s' 'PASSWORD')"
LOCAL_LOGIN_CODE="$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_health() {
  for _ in {1..60}; do
    if curl -fsS "http://localhost:$PORT/actuator/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "GrayMatter Local Server did not become healthy" >&2
  tail -n 120 "$TMP_DIR/server.log" >&2 || true
  return 1
}

mkdir -p "$DIST_DIR"

"$ROOT/scripts/package-local-server" \
  --out-dir "$DIST_DIR" \
  --work-dir "$TMP_DIR/work" > /dev/null 2>"$TMP_DIR/package.stderr"

if grep -q "argument for --compress is deprecated" "$TMP_DIR/package.stderr"; then
  echo "package-local-server should not use deprecated jlink compression syntax" >&2
  cat "$TMP_DIR/package.stderr" >&2
  exit 1
fi

tar -xzf "$TARBALL" -C "$TMP_DIR"
tar -tzf "$TARBALL" > "$TMP_DIR/contents.txt"

if grep -q '^graymatter-local-server/source/target/' "$TMP_DIR/contents.txt"; then
  echo "Archive should not include Maven source/target build output" >&2
  exit 1
fi

grep -q '^graymatter-local-server/lib/graymatter-local-server.jar$' "$TMP_DIR/contents.txt"
grep -q '^graymatter-local-server/KNOWLEDGE_PACKS.md$' "$TMP_DIR/contents.txt"

(
  cd "$TMP_DIR/graymatter-local-server"
  env \
    SERVER_PORT="$PORT" \
    "$LOGIN_FIELD=$LOCAL_LOGIN_CODE" \
    GRAYMATTER_DB_URL="jdbc:h2:mem:graymatter-runtime;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1" \
    ./bin/graymatter-local-server
) >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID="$!"

wait_for_health

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/graymatter/stats" \
  > "$TMP_DIR/dashboard.json"
grep -q '"generationMode":"thorapi-febe"' "$TMP_DIR/dashboard.json"
grep -q 'Live Telemetry' "$TMP_DIR/dashboard.json"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/api-docs" \
  > "$TMP_DIR/api-docs.json"
grep -q '"x-graymatter-mcp-contract"' "$TMP_DIR/api-docs.json"
grep -q '"/v1/MemoryEntry/query"' "$TMP_DIR/api-docs.json"
grep -q '"/v1/swarm-ops/graph"' "$TMP_DIR/api-docs.json"
grep -q '"/v1/knowledge-packs/import"' "$TMP_DIR/api-docs.json"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/swarm-ops/graph" \
  | grep -q '"protocolVersion":"graymatter-swarm-v0.1"'

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/graymatter/activation/bridge" \
  | grep -q '"target":"https://valkyrlabs.com"'

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/memory/status" > "$TMP_DIR/telemetry.json"
grep -q '"panel":"Live Telemetry"' "$TMP_DIR/telemetry.json"
grep -q '"section":"System Equalizer"' "$TMP_DIR/telemetry.json"
grep -q '"id":"memory.entries"' "$TMP_DIR/telemetry.json"
grep -q '"id":"system.equalizer"' "$TMP_DIR/telemetry.json"
if grep -q '"metrics":\[\]' "$TMP_DIR/telemetry.json"; then
  echo "Telemetry should return admin-visible baseline metrics, not an empty metrics list" >&2
  exit 1
fi

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  -X POST \
  "http://localhost:$PORT/v1/graymatter/activation/bridge/event" > "$TMP_DIR/sync-response.json"
grep -q '"status":"ACTIVATION_EVENT_RECORDED"' "$TMP_DIR/sync-response.json"
grep -q "500 starter credits" "$TMP_DIR/sync-response.json"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  -H 'Content-Type: application/json' \
  -d '{"type":"decision","text":"Runtime test memory","tags":["runtime"]}' \
  "http://localhost:$PORT/v1/MemoryEntry/write" > "$TMP_DIR/memory-create.json"

MEMORY_ID="$(jq -r '.id' "$TMP_DIR/memory-create.json")"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/MemoryEntry/$MEMORY_ID" \
  | grep -q "Runtime test memory"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  -H 'Content-Type: application/json' \
  -d '{"query":"runtime","limit":5}' \
  "http://localhost:$PORT/v1/MemoryEntry/query" \
  | grep -q "Runtime test memory"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/MemoryEntry?q=runtime" \
  | grep -q "Runtime test memory"

PACK_DIR="$TMP_DIR/pack"
PACK_ARCHIVE="$TMP_DIR/runtime-knowledge.gmkp"
mkdir -p "$PACK_DIR"
SOURCE_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
PACK_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
printf '%s\n' \
  "{\"kind\":\"MemoryEntry\",\"sourceId\":\"$SOURCE_ID\",\"type\":\"decision\",\"text\":\"Packaged runtime knowledge\",\"tags\":[\"runtime-pack\"]}" \
  >"$PACK_DIR/objects.jsonl"
printf '%s\n' \
  "{\"sourceKind\":\"MemoryEntry\",\"sourceId\":\"$SOURCE_ID\",\"relation\":\"project\",\"targetKind\":\"Project\",\"targetId\":\"$(uuidgen | tr '[:upper:]' '[:lower:]')\",\"external\":true}" \
  >"$PACK_DIR/edges.jsonl"
CONTENT_DIGEST="$(cat "$PACK_DIR/objects.jsonl" "$PACK_DIR/edges.jsonl" | shasum -a 256 | awk '{print $1}')"
jq -n \
  --arg packId "$PACK_ID" \
  --arg digest "$CONTENT_DIGEST" \
  '{format:"graymatter.knowledge-pack",formatVersion:"1.0",packId:$packId,name:"Runtime Knowledge",contentDigestAlgorithm:"SHA-256",contentDigest:$digest,aclImportPolicy:"do-not-transplant",embeddingPolicy:"regenerate-on-import",counts:{memoryEntries:1,contentData:0,edges:1,blobs:0,redactions:0}}' \
  >"$PACK_DIR/manifest.json"
openssl genpkey -algorithm ED25519 -out "$PACK_DIR/private.pem" >/dev/null 2>&1
PUBLIC_KEY="$(openssl pkey -in "$PACK_DIR/private.pem" -pubout -outform DER 2>/dev/null | base64 | tr -d '\r\n')"
PACK_SIGNATURE="$(openssl pkeyutl -sign -inkey "$PACK_DIR/private.pem" -rawin -in "$PACK_DIR/manifest.json" 2>/dev/null | base64 | tr -d '\r\n')"
jq -n \
  --arg publicKey "$PUBLIC_KEY" \
  --arg signature "$PACK_SIGNATURE" \
  '{algorithm:"Ed25519",signedEntry:"manifest.json",publicKeyFormat:"X.509",publicKey:$publicKey,signature:$signature,trustModel:"self-contained-v1",identityAssurance:"unverified-until-publisher-trust-binding"}' \
  >"$PACK_DIR/signature.json"
(
  cd "$PACK_DIR"
  zip -q "$PACK_ARCHIVE" manifest.json objects.jsonl edges.jsonl signature.json
)

GRAYMATTER_LIGHT_PUBLIC_BASE="http://localhost:$PORT" \
GRAYMATTER_LIGHT_PASSWORD="$LOCAL_LOGIN_CODE" \
  "$ROOT/scripts/gm-knowledge-pack-import" "$PACK_ARCHIVE" \
  >"$TMP_DIR/pack-import.json"
jq -e '.integrityStatus == "INTEGRITY_VERIFIED" and .alreadyImported == false and .knowledgePack.memoryEntryCount == 1' \
  "$TMP_DIR/pack-import.json" >/dev/null
PACK_LOCAL_ID="$(jq -r '.knowledgePack.id' "$TMP_DIR/pack-import.json")"

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  "http://localhost:$PORT/v1/MemoryEntry?q=packaged%20runtime" \
  | grep -q "Packaged runtime knowledge"
curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  "http://localhost:$PORT/v1/knowledge-packs/$PACK_LOCAL_ID/graph" \
  | grep -q '"relation":"project"'

GRAYMATTER_LIGHT_PUBLIC_BASE="http://localhost:$PORT" \
GRAYMATTER_LIGHT_PASSWORD="$LOCAL_LOGIN_CODE" \
  "$ROOT/scripts/gm-knowledge-pack-import" "$PACK_ARCHIVE" \
  | jq -e '.alreadyImported == true' >/dev/null

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/swarm-ops/graph" \
  | grep -q '"protocolVersion":"graymatter-swarm-v0.1"'

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Runtime Workbook","status":"WorkbookOpen"}' \
  "http://localhost:$PORT/v1/Workbook" >/dev/null

curl -fsS -u "admin:$LOCAL_LOGIN_CODE" "http://localhost:$PORT/v1/Workbook" \
  | grep -q "Runtime Workbook"

echo "package_local_server_runtime_test: ok"
