#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/.tmp-test-light-bundle"

rm -rf "$OUT"
"$ROOT/scripts/gm-light-bootstrap" "$OUT" >/dev/null

[[ -f "$OUT/api.hbs.yaml" ]]
[[ -f "$OUT/docker-compose.yaml" ]]
[[ -f "$OUT/dashboard/index.html" ]]
[[ -f "$OUT/UPGRADE.md" ]]

grep -q "graymatter-light" "$OUT/docker-compose.yaml"
grep -q "starter 1000 credits" "$OUT/UPGRADE.md"

echo "gm_light_bootstrap_test: ok"
