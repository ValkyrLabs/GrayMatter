#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/scripts/gm-self-update"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

source_repo="${tmp}/source"
install_repo="${tmp}/install"
state_file="${tmp}/state/plugin-update.json"
git init -q "$source_repo"
git -C "$source_repo" config user.email test@example.com
git -C "$source_repo" config user.name Test
printf 'v1\n' >"${source_repo}/README.md"
mkdir -p "${source_repo}/scripts"
cp "$SCRIPT" "${source_repo}/scripts/gm-self-update"
chmod +x "${source_repo}/scripts/gm-self-update"
git -C "$source_repo" add README.md scripts/gm-self-update
git -C "$source_repo" commit -q -m 'initial'
git -C "$source_repo" branch -M main

git clone -q "$source_repo" "$install_repo"

output="$(
  GRAYMATTER_PLUGIN_REPO="$source_repo" \
  GRAYMATTER_SELF_UPDATE_STATE="$state_file" \
  GRAYMATTER_SELF_UPDATE_INTERVAL_SECONDS=604800 \
  "${install_repo}/scripts/gm-self-update" maybe 2>&1
)"
[[ "$output" == *"GrayMatter plugin ready:"* ]] || fail "maybe mode should report ready state"
[[ -f "$state_file" ]] || fail "self-update should write state file"

printf 'v2\n' >"${source_repo}/README.md"
git -C "$source_repo" add README.md
git -C "$source_repo" commit -q -m 'update'

output="$(
  GRAYMATTER_PLUGIN_REPO="$source_repo" \
  GRAYMATTER_SELF_UPDATE_STATE="$state_file" \
  "${install_repo}/scripts/gm-self-update" force 2>&1
)"
[[ "$output" == *"updated to"* ]] || fail "force mode should update a clean checkout"
[[ "$(cat "${install_repo}/README.md")" == "v2" ]] || fail "clean checkout should fast-forward to latest source"

printf 'local\n' >"${install_repo}/local-change.txt"
printf 'v3\n' >"${source_repo}/README.md"
git -C "$source_repo" add README.md
git -C "$source_repo" commit -q -m 'second update'
output="$(
  GRAYMATTER_PLUGIN_REPO="$source_repo" \
  GRAYMATTER_SELF_UPDATE_STATE="$state_file" \
  "${install_repo}/scripts/gm-self-update" force 2>&1
)"
[[ "$output" == *"local changes"* ]] || fail "dirty checkout should not be overwritten"
[[ -f "${install_repo}/local-change.txt" ]] || fail "dirty checkout local changes must be preserved"

echo "gm_self_update_test.sh: PASS"
