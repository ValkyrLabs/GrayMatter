#!/usr/bin/env bash
set -euo pipefail

thor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${thor_root}/scripts/gm-install.mjs" ]]; then
  "${thor_root}/graymatter-bootstrap"
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'GrayMatter requires Node.js 20 or newer. Download it from https://nodejs.org/ and rerun this installer.\n' >&2
  exit 4
fi
exec node "${thor_root}/scripts/gm-install.mjs"
