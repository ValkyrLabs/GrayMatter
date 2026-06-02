#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/gm-doctor"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

make_fake_script() {
  local dir="$1"
  local name="$2"
  local status="$3"
  local text="$4"

  cat >"${dir}/${name}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
echo "${text}"
exit ${status}
EOF
  chmod +x "${dir}/${name}"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fake_bin="${tmp}/scripts"
mkdir -p "$fake_bin"

make_fake_script "$fake_bin" gm-self-update 0 "self-update ok"
make_fake_script "$fake_bin" gm-install-check 0 "install ok"
make_fake_script "$fake_bin" gm-status 0 "memory_layer=ready"
make_fake_script "$fake_bin" gm-openapi-sync 0 "api-docs.json"
make_fake_script "$fake_bin" gm-openapi-summary 0 "OpenAPI: ValkyrAI CORE API"
make_fake_script "$fake_bin" gm-mcp-contract 0 "mcp contract ok"
make_fake_script "$fake_bin" gm-replay-deferred 0 "No deferred operations found."
make_fake_script "$fake_bin" gm-smoke 0 "smoke ok"

cache_dir="${tmp}/root/tmp"
mkdir -p "$cache_dir"
cat >"${cache_dir}/api-docs.json" <<'JSON'
{"info":{"title":"Cached API","version":"test"},"paths":{},"tags":[]}
JSON

output="$(GRAYMATTER_SCRIPT_DIR="$fake_bin" GRAYMATTER_ROOT_DIR="${tmp}/root" "$SCRIPT" --quick)"
[[ "$output" == *"[ok] install and auth check"* ]] || fail "doctor should report successful required checks"
[[ "$output" == *"[skip] live memory smoke"* ]] || fail "doctor --quick should skip smoke"
[[ "$output" == *"GrayMatter doctor result: ready"* ]] || fail "doctor should report ready when all required checks pass"

make_fake_script "$fake_bin" gm-replay-deferred 1 "replay temporarily unavailable"
warn_output="$(GRAYMATTER_SCRIPT_DIR="$fake_bin" GRAYMATTER_ROOT_DIR="${tmp}/root" "$SCRIPT" --quick)"
[[ "$warn_output" == *"[warn] deferred replay check"* ]] || fail "doctor should warn for optional replay failures"
[[ "$warn_output" == *"ready with 1 warning"* ]] || fail "doctor should remain ready with optional warnings"

make_fake_script "$fake_bin" gm-openapi-sync 1 "sync timed out"
cached_output="$(GRAYMATTER_SCRIPT_DIR="$fake_bin" GRAYMATTER_ROOT_DIR="${tmp}/root" "$SCRIPT" --quick)"
[[ "$cached_output" == *"[warn] live OpenAPI sync"* ]] || fail "doctor should warn when live OpenAPI sync fails but cache exists"
[[ "$cached_output" == *"using cached schema"* ]] || fail "doctor should identify cached schema fallback"

make_fake_script "$fake_bin" gm-install-check 1 "auth missing"
set +e
fail_output="$(GRAYMATTER_SCRIPT_DIR="$fake_bin" GRAYMATTER_ROOT_DIR="${tmp}/root" "$SCRIPT" --quick 2>&1)"
fail_status=$?
set -e

[[ "$fail_status" == "1" ]] || fail "doctor should exit 1 when a required check fails"
[[ "$fail_output" == *"[fail] install and auth check"* ]] || fail "doctor should identify the required failed check"
[[ "$fail_output" == *"blocked by 1 required failure"* ]] || fail "doctor should summarize required failures"

echo "gm_doctor_test.sh: PASS"
