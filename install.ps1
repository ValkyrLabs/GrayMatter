param()

$ErrorActionPreference = 'Stop'
$thor_root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $thor_root 'scripts/gm-install.mjs'))) {
  & (Join-Path $thor_root 'graymatter-bootstrap.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$thor_node = if ($env:GRAYMATTER_NODE) { $env:GRAYMATTER_NODE } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $thor_node) { throw 'GrayMatter requires Node.js 20 or newer. Download it from https://nodejs.org/ and rerun this installer.' }
& $thor_node (Join-Path $thor_root 'scripts/gm-install.mjs')
exit $LASTEXITCODE
