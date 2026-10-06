#!/usr/bin/env bash
set -euo pipefail

thor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node --check "${thor_root}/scripts/gm-auth.mjs"
node --check "${thor_root}/scripts/gm-install.mjs"
node --check "${thor_root}/scripts/gm-mcp-launcher.mjs"
node --test "${thor_root}/mcp-server/test/auth-installer.test.js"

thor_install_output="$(GRAYMATTER_INSTALL_SKIP_CODEX=1 GRAYMATTER_INSTALL_SKIP_AUTH=1 node "${thor_root}/scripts/gm-install.mjs")"
for thor_stage in 'downloading plugin' 'performing signup/login' 'authenticating' 'GrayMatter plugin ready'; do
  grep -Fq "$thor_stage" <<<"$thor_install_output" || {
    echo "FAIL: friendly installer stage missing: $thor_stage" >&2
    exit 1
  }
done

thor_password_check_status=0
rg -n 'writeCredential\([^,]*PASSWORD|VALKYR_AUTH_PASSWORD.*writeCredential' "${thor_root}/scripts/gm-auth.mjs" >/dev/null || thor_password_check_status=$?
case "$thor_password_check_status" in
  1) ;;
  0)
    echo 'FAIL: authentication must not persist a GrayMatter password' >&2
    exit 1
    ;;
  *)
    echo "FAIL: password-persistence check could not run (ripgrep exit $thor_password_check_status)" >&2
    exit 1
    ;;
esac

echo 'gm login cross-platform tests passed'
