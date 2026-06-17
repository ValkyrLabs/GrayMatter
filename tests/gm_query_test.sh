#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gm-query-test.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

run_timeout_fallback_filters_memory_entries() {
  local fake_api="$TMP_DIR/fake-graymatter-api-timeout"
  local out="$TMP_DIR/query-timeout.out"
  local err="$TMP_DIR/query-timeout.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"path":"uri=/v1/MemoryEntry/query","error":"Runtime Error","message":"transaction timeout expired"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
[
  {
    "id": "580739d8-1776-4517-82c0-f3f51a8759bb",
    "type": "context",
    "text": "TrustLove mandate",
    "sourceChannel": "codex:workspace:graymatter"
  },
  {
    "id": "unrelated",
    "type": "context",
    "text": "Nothing to see here",
    "sourceChannel": "codex:workspace:graymatter"
  },
  {
    "id": "wrong-source",
    "type": "context",
    "text": "TrustLove outside this scope",
    "sourceChannel": "codex:workspace:other"
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
    "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter \
    >"$out" 2>"$err"

  jq -e 'length == 1 and .[0].id == "580739d8-1776-4517-82c0-f3f51a8759bb"' "$out" >/dev/null
  grep -q "falling back to MemoryEntry list filtering" "$err"
}

run_success_brief_formats_human_output() {
  local fake_api="$TMP_DIR/fake-graymatter-api-brief"
  local out="$TMP_DIR/query-brief.out"
  local err="$TMP_DIR/query-brief.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  cat <<'JSON'
[
  {
    "id": "brief-match",
    "type": "decision",
    "text": "GrayMatter query output should be concise for humans and should not dump full tag and principal payloads by default when brief mode is requested.",
    "sourceChannel": "codex:workspace:graymatter",
    "tags": [{"name": "graymatter"}, {"name": "query"}]
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
    "$ROOT_DIR/scripts/gm-query" query 10 decision codex:workspace:graymatter --brief --text-max 90 \
    >"$out" 2>"$err"

  grep -q "GrayMatter returned 1 matching memory entry for: query" "$out"
  grep -F -q -- "- [decision] GrayMatter query output should be concise for humans" "$out"
  grep -F -q "..." "$out"
  grep -q "id=brief-match" "$out"
  grep -q "tags=graymatter,query" "$out"
  ! grep -q '"principal"' "$out"
}

run_non_timeout_errors_do_not_fallback() {
  local fake_api="$TMP_DIR/fake-graymatter-api-error"
  local out="$TMP_DIR/query-error.out"
  local err="$TMP_DIR/query-error.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"error":"Unauthorized","message":"SESSION_EXPIRED"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  echo "GET /MemoryEntry should not be called for non-timeout errors" >&2
  exit 64
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
  chmod +x "$fake_api"

  set +e
  GRAYMATTER_API_COMMAND="$fake_api" \
    "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter \
    >"$out" 2>"$err"
  local status=$?
  set -e

  [[ "$status" -eq 22 ]]
  grep -q '"SESSION_EXPIRED"' "$err"
  ! grep -q "falling back to MemoryEntry list filtering" "$err"
  ! grep -q "GET /MemoryEntry should not be called" "$err"
}

run_timeout_fallback_can_be_disabled() {
  local fake_api="$TMP_DIR/fake-graymatter-api-disabled"
  local out="$TMP_DIR/query-disabled.out"
  local err="$TMP_DIR/query-disabled.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"error":"Runtime Error","message":"transaction timeout expired"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  echo "GET /MemoryEntry should not be called when timeout fallback is disabled" >&2
  exit 64
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
  chmod +x "$fake_api"

  set +e
  GRAYMATTER_QUERY_TIMEOUT_FALLBACK=false \
    GRAYMATTER_API_COMMAND="$fake_api" \
    "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter \
    >"$out" 2>"$err"
  local status=$?
  set -e

  [[ "$status" -eq 22 ]]
  grep -q "transaction timeout expired" "$err"
  ! grep -q "falling back to MemoryEntry list filtering" "$err"
  ! grep -q "GET /MemoryEntry should not be called" "$err"
}

run_wrapped_memoryentry_lists_are_filtered() {
  local fake_api="$TMP_DIR/fake-graymatter-api-wrapped"
  local out="$TMP_DIR/query-wrapped.out"
  local err="$TMP_DIR/query-wrapped.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"details":{"message":"timed out waiting for transaction"}}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
{
  "content": [
    {
      "id": "wrapped",
      "type": "context",
      "text": "TrustLove from wrapped content",
      "source": "codex:workspace:graymatter"
    }
  ]
}
JSON
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
  chmod +x "$fake_api"

  GRAYMATTER_API_COMMAND="$fake_api" \
    "$ROOT_DIR/scripts/gm-query" trustlove 10 context codex:workspace:graymatter \
    >"$out" 2>"$err"

  jq -e 'length == 1 and .[0].id == "wrapped"' "$out" >/dev/null
  grep -q "falling back to MemoryEntry list filtering" "$err"
}

run_results_wrapped_content_is_filtered() {
  local fake_api="$TMP_DIR/fake-graymatter-api-results"
  local out="$TMP_DIR/query-results.out"
  local err="$TMP_DIR/query-results.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"message":"transaction timeout expired"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
{
  "results": [
    {
      "id": "content-match",
      "type": "context",
      "content": "TrustLove appears in the long-form content field",
      "sourceChannel": "codex:workspace:graymatter"
    },
    {
      "id": "wrong-type",
      "type": "artifact",
      "content": "TrustLove artifact outside requested type",
      "sourceChannel": "codex:workspace:graymatter"
    }
  ]
}
JSON
  exit 0
fi

echo "unexpected fake API call: $*" >&2
exit 64
SH
  chmod +x "$fake_api"

  GRAYMATTER_API_COMMAND="$fake_api" \
    "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter \
    >"$out" 2>"$err"

  jq -e 'length == 1 and .[0].id == "content-match"' "$out" >/dev/null
  grep -q "falling back to MemoryEntry list filtering" "$err"
}

run_timeout_fallback_brief_formats_filtered_results() {
  local fake_api="$TMP_DIR/fake-graymatter-api-timeout-brief"
  local out="$TMP_DIR/query-timeout-brief.out"
  local err="$TMP_DIR/query-timeout-brief.err"

  cat >"$fake_api" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"

if [[ "$METHOD" == "POST" && "$PATH_PART" == "/MemoryEntry/query" ]]; then
  printf '{"message":"transaction timeout expired"}\n'
  exit 22
fi

if [[ "$METHOD" == "GET" && "$PATH_PART" == "/MemoryEntry" ]]; then
  cat <<'JSON'
[
  {
    "id": "fallback-brief",
    "type": "context",
    "text": "TrustLove fallback result should also render in bounded brief mode.",
    "sourceChannel": "codex:workspace:graymatter",
    "tags": ["fallback", "graymatter"]
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
    "$ROOT_DIR/scripts/gm-query" TrustLove 10 context codex:workspace:graymatter --brief \
    >"$out" 2>"$err"

  grep -q "falling back to MemoryEntry list filtering" "$err"
  grep -q "GrayMatter returned 1 matching memory entry for: TrustLove" "$out"
  grep -F -q -- "- [context] TrustLove fallback result should also render in bounded brief mode." "$out"
  grep -q "id=fallback-brief" "$out"
  ! grep -q '^\[' "$out"
}

run_timeout_fallback_filters_memory_entries
run_success_brief_formats_human_output
run_non_timeout_errors_do_not_fallback
run_timeout_fallback_can_be_disabled
run_wrapped_memoryentry_lists_are_filtered
run_results_wrapped_content_is_filtered
run_timeout_fallback_brief_formats_filtered_results

echo "gm_query_test: ok"
