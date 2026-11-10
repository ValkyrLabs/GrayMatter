param()

$ErrorActionPreference = 'Stop'
$thor_root = Split-Path -Parent $MyInvocation.MyCommand.Path
$thor_bundle = if ($env:GRAYMATTER_SKILL_BUNDLE) { $env:GRAYMATTER_SKILL_BUNDLE } else { Join-Path $thor_root 'graymatter.skill' }
if ((Test-Path (Join-Path $thor_root 'scripts/gm-auth.mjs')) -and (Test-Path (Join-Path $thor_root 'mcp-server/index.js'))) {
  Write-Host 'GrayMatter runtime files are already present.'
  exit 0
}
if (-not (Test-Path $thor_bundle)) { throw "GrayMatter runtime files and $thor_bundle are missing." }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$thor_archive = [System.IO.Compression.ZipFile]::OpenRead($thor_bundle)
try {
  if (-not ($thor_archive.Entries | Where-Object FullName -eq 'graymatter/SKILL.md')) {
    throw 'graymatter.skill does not contain the expected GrayMatter payload.'
  }
  $thor_rootPrefix = [System.IO.Path]::GetFullPath($thor_root + [System.IO.Path]::DirectorySeparatorChar)
  foreach ($thor_entry in $thor_archive.Entries) {
    if (-not $thor_entry.FullName.StartsWith('graymatter/')) { continue }
    $thor_relative = $thor_entry.FullName.Substring('graymatter/'.Length)
    if (-not $thor_relative -or $thor_relative.EndsWith('/')) { continue }
    $thor_destination = [System.IO.Path]::GetFullPath((Join-Path $thor_root $thor_relative))
    if (-not $thor_destination.StartsWith($thor_rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Unsafe path in graymatter.skill: $($thor_entry.FullName)"
    }
    $thor_parent = Split-Path -Parent $thor_destination
    New-Item -ItemType Directory -Force -Path $thor_parent | Out-Null
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($thor_entry, $thor_destination, $true)
  }
} finally {
  $thor_archive.Dispose()
}
Write-Host 'GrayMatter runtime files restored from graymatter.skill.'
