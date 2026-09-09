#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-invariant-preflight-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

fake_api="$TMP_DIR/fake-graymatter-api"
out="$TMP_DIR/preflight.out"
err="$TMP_DIR/preflight.err"

cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"
if [[ "$PATH_PART" == "/MemoryEntry?page="* ]]; then
  [[ "$PATH_PART" == *"page=0&"* ]] || { printf "[]\n"; exit 0; }
  PATH_PART="/MemoryEntry"
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/memory/status" ]]; then
  printf '{"ready":true,"memoryLayer":"ready"}\n'
  exit 0
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
[
  {
    "id": "acl-invariant",
    "type": "decision",
    "text": "Rule: ValkyrAI ACL enforcement must use generated ThorAPI service paths.",
    "sourceChannel": "codex:workspace:ValkyrAI",
    "tags": ["invariant", "acl", "thorapi"]
  },
  {
    "id": "context-note",
    "type": "context",
    "text": "ValkyrAI context but not a binding invariant.",
    "sourceChannel": "codex:workspace:ValkyrAI",
    "tags": ["context"]
  },
  {
    "id": "graymatter-global",
    "type": "decision",
    "text": "Rule: GrayMatter mandatory preflight applies across installed agents.",
    "sourceChannel": "codex:workspace:GrayMatter",
    "tags": ["invariant", "mandatory-preflight", "graymatter"]
  }
]
JSON
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
chmod +x "$fake_api"

GRAYMATTER_API_COMMAND="$fake_api" \
  "$ROOT_DIR/scripts/gm-invariant-preflight" ValkyrAI signup acl --format json \
  >"$out" 2>"$err"

jq -e '
  .sourceChannel == "codex:workspace:ValkyrAI"
  and .workspace == "ValkyrAI"
  and .status.state == "ready"
  and .failClosed == true
  and .count == 2
  and ([.entries[].id] | index("acl-invariant") != null)
  and ([.entries[].id] | index("graymatter-global") != null)
  and ([.entries[].id] | index("context-note") == null)
' "$out" >/dev/null

GRAYMATTER_API_COMMAND="$fake_api" \
  "$ROOT_DIR/plugins/graymatter/scripts/gm-invariant-preflight" ValkyrAI signup acl --format brief \
  >"$out" 2>"$err"

grep -q "GrayMatter invariant preflight" "$out"
grep -q "matches=2" "$out"
grep -q "acl-invariant" "$out"
! grep -q "context-note" "$out"

cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"
if [[ "$PATH_PART" == "/MemoryEntry?page="* ]]; then
  [[ "$PATH_PART" == *"page=0&"* ]] || { printf "[]\n"; exit 0; }
  PATH_PART="/MemoryEntry"
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/memory/status" ]]; then
  printf '{"ready":true,"memoryLayer":"ready"}\n'
  exit 0
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  printf '[{"id":"context-note","type":"context","text":"No binding rule here.","sourceChannel":"codex:workspace:EmptyProduct","tags":["context"]}]\n'
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
chmod +x "$fake_api"

GRAYMATTER_API_COMMAND="$fake_api" \
  "$ROOT_DIR/scripts/gm-invariant-preflight" EmptyProduct --format brief \
  >"$out" 2>"$err"

grep -q "matches=0" "$out"
grep -q "No binding invariants were found" "$err"

cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$2" == /memory/status ]]; then printf '{"ready":true}\n'; exit 0; fi
node -e '
  const page = Number(new URL(process.argv[1], "https://test/").searchParams.get("page"));
  process.stdout.write(JSON.stringify(page >= 3 ? [] : Array.from({length:100}, (_,i) => ({
    id:`large-${page*100+i}`, type:"decision", sourceChannel:"codex:workspace:GrayMatter",
    text:"Rule: GrayMatter pagination invariant " + "x".repeat(5000), tags:["invariant"]
  }))));
' "$2"
SH
chmod +x "$fake_api"
GRAYMATTER_API_COMMAND="$fake_api" "$ROOT_DIR/scripts/gm-invariant-preflight" GrayMatter --limit 500 --format json >"$out" 2>"$err"
jq -e '.count == 300 and .coverage.complete and .coverage.pages == 4 and .readyToProceed' "$out" >/dev/null
set +e
GRAYMATTER_API_COMMAND="$fake_api" "$ROOT_DIR/scripts/gm-invariant-preflight" GrayMatter --limit 20 --format json >"$out" 2>"$err"
thor_status=$?
set -e
[[ "$thor_status" == 2 ]]
jq -e '.count == 20 and .omittedInvariants == 280 and .readyToProceed == false' "$out" >/dev/null

echo "gm_invariant_preflight_test: PASS"
