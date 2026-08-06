#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_KEY="$ROOT/release/graymatter-release-public.pem"
PLUGIN_PUBLIC_KEY="$ROOT/plugins/graymatter/release/graymatter-release-public.pem"
WORKFLOW="$ROOT/.github/workflows/signed-release.yml"

openssl pkey -pubin -in "$PUBLIC_KEY" -noout >/dev/null
cmp "$PUBLIC_KEY" "$PLUGIN_PUBLIC_KEY"
cmp "$ROOT/scripts/gm-self-update" "$ROOT/plugins/graymatter/scripts/gm-self-update"
grep -q 'DEFAULT_PUBLIC_KEY="$ROOT_DIR/release/graymatter-release-public.pem"' "$ROOT/scripts/gm-self-update"
grep -q 'curl -fsSL --connect-timeout' "$ROOT/scripts/gm-self-update"
grep -q 'secrets.GRAYMATTER_RELEASE_PRIVATE_KEY' "$WORKFLOW"
grep -q 'openssl dgst -sha256 -verify release/graymatter-release-public.pem' "$WORKFLOW"
grep -q 'graymatter-release.json.sig' "$WORKFLOW"

echo "release_signing_contract_test: ok"
