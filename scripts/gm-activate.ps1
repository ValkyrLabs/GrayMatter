param()

$ErrorActionPreference = 'Stop'
$thor_scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$thor_root = Split-Path -Parent $thor_scriptDir

Write-Host 'GrayMatter: checking the portable runtime...'
$thor_node = if ($env:GRAYMATTER_NODE) { $env:GRAYMATTER_NODE } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $thor_node) {
  throw 'Node.js 20 or newer is required. Install it from https://nodejs.org/ and rerun this command.'
}
$thor_major = [int]((& $thor_node --version).TrimStart('v').Split('.')[0])
if ($thor_major -lt 20) { throw 'GrayMatter requires Node.js 20 or newer.' }

& $thor_node (Join-Path $thor_scriptDir 'gm-auth.mjs') keychain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $thor_node --check (Join-Path $thor_root 'mcp-server/index.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $thor_node --check (Join-Path $thor_scriptDir 'gm-mcp-launcher.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'GrayMatter plugin ready. Your session is in Windows Credential Manager; your password was not saved.'
