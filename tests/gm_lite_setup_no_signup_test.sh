#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-lite-setup-no-signup.XXXXXX")"
export VAIX_STATE_DIR="$TMP_DIR/state"
export GRAYMATTER_STATE_DIR="$TMP_DIR/memory-state"
export GRAYMATTER_PROFILES_FILE="$TMP_DIR/profiles.json"
export GRAYMATTER_LITE_BUNDLE_DIR="$TMP_DIR/application"
export GRAYMATTER_DATA_DIR="$TMP_DIR/application/data"
export GRAYMATTER_PROFILE=""
export GRAYMATTER_PROFILES=""
export GRAYMATTER_PROFILE_RESOLVED=""

cleanup() {
  local status="$?"
  "$ROOT/vaix" stop >/dev/null 2>&1 || true
  if [[ "$status" -ne 0 ]]; then
    node - "$TMP_DIR" <<'JS'
const fs = require('node:fs');
for (const name of ['setup.log','state/graymatter-lite.log','state/graymatter-mcp.log']) {
  const file = process.argv[2]+'/'+name;
  if (fs.existsSync(file)) console.error(fs.readFileSync(file,'utf8').split('\n')
    .filter(line=>!/(password|token|credential|secret)/i.test(line)).slice(-35).join('\n'));
}
JS
  fi
  rm -rf "$TMP_DIR"
  return "$status"
}
trap cleanup EXIT

free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});'
}
export GRAYMATTER_LITE_PORT="$(free_port)"
export GRAYMATTER_MCP_PORT="$(free_port)"
mkdir -p "$GRAYMATTER_DATA_DIR" "$GRAYMATTER_LITE_BUNDLE_DIR/local-server"
printf '%s\n' 'preserve partial setup data' > "$GRAYMATTER_DATA_DIR/interrupted-setup-marker.txt"
printf '%s\n' '{"version":1,"mode":"single","activeProfile":"hosted-existing","blendProfiles":[],"profiles":{"hosted-existing":{"kind":"hosted","username":"metadata-only-fixture","apiBase":"https://api-0.valkyrlabs.com/v1","keychainService":"fixture-never-read","accountFingerprint":"sha256:fixture"}}}' > "$GRAYMATTER_PROFILES_FILE"
chmod 600 "$GRAYMATTER_PROFILES_FILE"

"$ROOT/vaix" setup >"$TMP_DIR/setup.log" 2>&1
test -f "$GRAYMATTER_LITE_BUNDLE_DIR/local-server/lib/graymatter-local-server.jar"
unzip -Z1 "$GRAYMATTER_LITE_BUNDLE_DIR/local-server/lib/graymatter-local-server.jar" > "$TMP_DIR/jar-contents.txt"
if grep -Eq '^BOOT-INF/lib/(thorapi|valkyrai|valhalla|workflow-ml-runner)-[0-9]' "$TMP_DIR/jar-contents.txt"; then
  echo 'Standalone setup must not require or ship a private generator/platform dependency' >&2
  exit 1
fi
node - "$TMP_DIR" <<'JS'
const fs = require('node:fs');
const crypto = require('node:crypto');
const file=process.argv[2]+'/application/admin.env';
if (fs.statSync(file).mode & 0o077) throw Error('Local credentials must remain private');
fs.writeFileSync(process.argv[2]+'/credential-file.sha256',crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
JS

cat > "$TMP_DIR/verify-mcp.cjs" <<'JS'
const assert = require('node:assert/strict');
const endpoint='http://127.0.0.1:'+process.env.GRAYMATTER_MCP_PORT+'/mcp';
let id=1;
async function rpc(method,params) {
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method,params})});
  assert(response.ok);const result=await response.json();assert(!result.error,JSON.stringify(result));assert(!result.result.isError,JSON.stringify(result));return result.result;
}
(async()=>{
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'native-lite-no-signup',version:'1'}});
  const list=await rpc('tools/list',{});for(const name of ['memory_put','memory_query'])assert(list.tools.some(t=>t.name===name));
  if(process.argv[2]==='write') {
    const written=await rpc('tools/call',{name:'memory_put',arguments:{type:'context',content:'native-standalone-no-signup-reconnect-marker'}});
    assert(JSON.stringify(written).includes('native-standalone-no-signup-reconnect-marker'));
  }
  const found=await rpc('tools/call',{name:'memory_query',arguments:{query:'native-standalone-no-signup-reconnect-marker',limit:5}});
  assert(JSON.stringify(found).includes('native-standalone-no-signup-reconnect-marker'));
})().catch(error=>{console.error(error);process.exitCode=1;});
JS
node "$TMP_DIR/verify-mcp.cjs" write
"$ROOT/vaix" setup >>"$TMP_DIR/setup.log" 2>&1
node "$TMP_DIR/verify-mcp.cjs" read
"$ROOT/vaix" stop >/dev/null
printf '%s' 'interrupted jar copy' > "$GRAYMATTER_LITE_BUNDLE_DIR/local-server/lib/graymatter-local-server.jar"
"$ROOT/vaix" setup >>"$TMP_DIR/setup.log" 2>&1
node "$TMP_DIR/verify-mcp.cjs" read
"$ROOT/vaix" stop >/dev/null
"$ROOT/vaix" up >>"$TMP_DIR/setup.log" 2>&1
"$ROOT/vaix" doctor >>"$TMP_DIR/setup.log" 2>&1
node "$TMP_DIR/verify-mcp.cjs" read

node - "$TMP_DIR" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.argv[2],registry=JSON.parse(fs.readFileSync(root+'/profiles.json'));
assert.equal(registry.activeProfile,'hosted-existing');assert.equal(registry.profiles['hosted-existing'].keychainService,'fixture-never-read');
assert.equal(registry.profiles['graymatter-lite-local'].kind,'local');
assert.equal(fs.readFileSync(root+'/application/data/interrupted-setup-marker.txt','utf8').trim(),'preserve partial setup data');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(root+'/application/admin.env')).digest('hex'),fs.readFileSync(root+'/credential-file.sha256','utf8'));
assert.equal(fs.statSync(registry.profiles['graymatter-lite-local'].passwordFile).mode & 0o077,0);
JS
echo 'gm_lite_setup_no_signup_test: ok (real setup, partial retry, repeated setup, interrupted jar repair, MCP write/query, durable reconnect, hosted profile preserved)'
