#!/usr/bin/env bash
set -euo pipefail

thor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node --check "${thor_root}/scripts/gm-auth.mjs"
node --check "${thor_root}/scripts/gm-mcp-launcher.mjs"
node --test "${thor_root}/mcp-server/test/auth-installer.test.js"

if rg -n 'writeCredential\([^,]*PASSWORD|VALKYR_AUTH_PASSWORD.*writeCredential' "${thor_root}/scripts/gm-auth.mjs" >/dev/null; then
  echo 'FAIL: authentication must not persist a GrayMatter password' >&2
  exit 1
fi

echo 'gm login cross-platform tests passed'
