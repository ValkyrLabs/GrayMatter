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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
cp "$ROOT_DIR/scripts/gm-entity" "$TMP_DIR/gm-entity"
cat >"$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@"
EOF
chmod +x "$TMP_DIR/gm-entity" "$TMP_DIR/graymatter_api.sh"

patch_output="$(bash "$TMP_DIR/gm-entity" Lead PATCH lead-123 '{"stage":"QUALIFIED"}')"
expected_patch_output=$'PATCH\n/Lead/lead-123\n{"stage":"QUALIFIED"}'
[[ "$patch_output" == "$expected_patch_output" ]] || {
  echo "expected object PATCH route, got: $patch_output" >&2
  exit 1
}

echo "gm_entity_test: ok"
