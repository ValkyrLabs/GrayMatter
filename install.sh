#!/usr/bin/env bash
set -euo pipefail

thor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${thor_root}/scripts/gm-auth.mjs" ]]; then
  "${thor_root}/graymatter-bootstrap"
fi
exec "${thor_root}/scripts/gm-activate"
