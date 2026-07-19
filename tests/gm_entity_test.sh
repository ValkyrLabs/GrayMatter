#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if bash "$ROOT_DIR/scripts/gm-entity" >/tmp/gm-entity.out 2>&1; then
  echo "expected usage failure" >&2
  exit 1
fi

grep -q "Usage:" /tmp/gm-entity.out
grep -q "gm-entity <Entity>" /tmp/gm-entity.out

if bash "$ROOT_DIR/scripts/gm-entity" --help >/tmp/gm-entity-help.out 2>&1; then
  echo "expected help usage exit" >&2
  exit 1
fi

grep -q "Usage:" /tmp/gm-entity-help.out
grep -q "<Entity> <id> PATCH" /tmp/gm-entity-help.out

mock_dir="$(mktemp -d)"
trap 'rm -rf "$mock_dir"' EXIT
cp "$ROOT_DIR/scripts/gm-entity" "$mock_dir/gm-entity"
cat >"$mock_dir/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@"
EOF
chmod +x "$mock_dir/graymatter_api.sh"

patch_output="$(bash "$mock_dir/gm-entity" Task task-123 PATCH '{"name":"Updated task"}')"
[[ "$(printf '%s\n' "$patch_output" | sed -n '1p')" == "PATCH" ]]
[[ "$(printf '%s\n' "$patch_output" | sed -n '2p')" == "/Task/task-123" ]]
[[ "$(printf '%s\n' "$patch_output" | sed -n '3p')" == '{"name":"Updated task"}' ]]

delete_output="$(bash "$mock_dir/gm-entity" Task task-123 DELETE)"
[[ "$(printf '%s\n' "$delete_output" | sed -n '1p')" == "DELETE" ]]
[[ "$(printf '%s\n' "$delete_output" | sed -n '2p')" == "/Task/task-123" ]]

long_description="$(printf 'x%.0s' {1..256})"
if bash "$ROOT_DIR/scripts/gm-entity" StrategicPriority POST "{\"description\":\"$long_description\"}" >/tmp/gm-entity-long-strategy.out 2>&1; then
  echo "expected long StrategicPriority validation failure" >&2
  exit 1
fi
grep -q "StrategicPriority.description is 256 characters" /tmp/gm-entity-long-strategy.out
grep -q "SQL truncation 500" /tmp/gm-entity-long-strategy.out

long_note="$(printf 'n%.0s' {1..256})"
if bash "$ROOT_DIR/scripts/gm-entity" Note POST "{\"content\":\"$long_note\"}" >/tmp/gm-entity-long-note.out 2>&1; then
  echo "expected long Note validation failure" >&2
  exit 1
fi
grep -q "Note.content is 256 characters" /tmp/gm-entity-long-note.out
grep -q "MemoryEntry/ContentData" /tmp/gm-entity-long-note.out

echo "gm_entity_test: ok"
