param()

$ErrorActionPreference = 'Stop'
$thor_root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $thor_root 'scripts/gm-auth.mjs'))) {
  & (Join-Path $thor_root 'graymatter-bootstrap.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& (Join-Path $thor_root 'scripts/gm-activate.ps1')
exit $LASTEXITCODE
