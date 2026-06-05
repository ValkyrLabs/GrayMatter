#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$ROOT_DIR/scripts/gm-write" "$TMP_DIR/gm-write"
chmod +x "$TMP_DIR/gm-write"

cat > "$TMP_DIR/gm-fallback-append" <<'EOF'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$SCRIPT_DIR/gm-fallback-calls"
EOF
chmod +x "$TMP_DIR/gm-fallback-append"

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
echo "HTTP 413 Payload Too Large" >&2
exit 1
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

OUTPUT="$($TMP_DIR/gm-write todo "$(printf 'x%.0s' {1..1200})" test 2>&1 || true)"

grep -q "gm-write rejected payload length" <<<"$OUTPUT"
grep -q "gm-write failed (type=todo, sourceChannel=test" <<<"$OUTPUT"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:read_only
graymatter_token_state=ok
memory_layer=degraded
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF
chmod +x "$TMP_DIR/gm-status"

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
READ_ONLY_OUTPUT="$($TMP_DIR/gm-write context "signal sweep payload" signal-harvester signal,github 2>&1)"
READ_ONLY_STATUS=$?
set -e

test "$READ_ONLY_STATUS" -eq 23
grep -q "read-only GrayMatter auth" <<<"$READ_ONLY_OUTPUT"
grep -q "queued fallback payload" <<<"$READ_ONLY_OUTPUT"
grep -q "gm-write preflight blocked read-only auth" "$TMP_DIR/gm-fallback-calls"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
memory_layer=degraded
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF

rm -f "$TMP_DIR/gm-fallback-calls"
set +e
DEGRADED_OUTPUT="$($TMP_DIR/gm-write artifact "operator payload" signal-harvester signal 2>&1)"
DEGRADED_STATUS=$?
set -e

test "$DEGRADED_STATUS" -eq 24
grep -q "memory_layer=degraded" <<<"$DEGRADED_OUTPUT"
grep -q "gm-write preflight blocked memory_layer=degraded" "$TMP_DIR/gm-fallback-calls"

echo "gm_write_test: PASS"
