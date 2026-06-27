#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cp "$ROOT_DIR/scripts/gm-retrieval-receipt" "$TMP_DIR/gm-retrieval-receipt"
chmod +x "$TMP_DIR/gm-retrieval-receipt"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
tenant_schema_context=unknown
memory_layer=ready
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF
chmod +x "$TMP_DIR/gm-status"

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
echo "graymatter_api.sh should not be called when tenant schema context is unknown" >&2
exit 99
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

set +e
UNKNOWN_OUTPUT="$($TMP_DIR/gm-retrieval-receipt create "tenant context check" 8 DEFAULT 2>&1)"
UNKNOWN_STATUS=$?
set -e

test "$UNKNOWN_STATUS" -eq 25
grep -q "tenant_schema_context=unknown" <<<"$UNKNOWN_OUTPUT"
! grep -q "graymatter_api.sh should not be called" <<<"$UNKNOWN_OUTPUT"

cat > "$TMP_DIR/gm-status" <<'EOF'
#!/usr/bin/env bash
cat <<STATUS
graymatter_auth=keychain:write_capable
graymatter_token_state=ok
tenant_schema_context=ready
tenant_schema_name=main
memory_layer=ready
graph_layer=missing
strategic_layer=missing
kpi_layer=missing
STATUS
EOF

cat > "$TMP_DIR/graymatter_api.sh" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s|%s\n' "$1" "$2" "$3"
EOF
chmod +x "$TMP_DIR/graymatter_api.sh"

READY_OUTPUT="$($TMP_DIR/gm-retrieval-receipt create "tenant context check" 8 DEFAULT)"
grep -q '^POST|/graymatter-retrieval-receipts|' <<<"$READY_OUTPUT"
grep -q '"query":"tenant context check"' <<<"$READY_OUTPUT"

LIST_OUTPUT="$($TMP_DIR/gm-retrieval-receipt list --limit 3)"
grep -q '^GET|/graymatter-retrieval-receipts?limit=3|' <<<"$LIST_OUTPUT"

echo "gm_retrieval_receipt_test: PASS"
