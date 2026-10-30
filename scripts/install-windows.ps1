param(
  [ValidateSet('Codex', 'DSH', 'Both')]
  [string]$Target = 'Both',
  [switch]$SkipDshPlugin
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$SkillSource = Join-Path $RepoRoot 'skills\codex-dsh-bridge'
$PluginSource = Join-Path $RepoRoot 'bridge\dsh-plugin\index.mjs'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path -LiteralPath $SkillSource)) { throw "Skill source not found: $SkillSource" }
if (-not (Test-Path -LiteralPath $PluginSource)) { throw "DSH plugin not found: $PluginSource" }

function Install-SkillCopy {
  param([string]$Parent)
  $Destination = Join-Path $Parent 'codex-dsh-bridge'
  New-Item -ItemType Directory -Force -Path $Parent | Out-Null
  if (Test-Path -LiteralPath $Destination) {
    $Backup = "$Destination.backup-$Stamp"
    Move-Item -LiteralPath $Destination -Destination $Backup
    Write-Output "Backed up existing skill to $Backup"
  }
  Copy-Item -LiteralPath $SkillSource -Destination $Destination -Recurse
  Write-Output "Installed skill: $Destination"
}

if ($Target -eq 'Codex' -or $Target -eq 'Both') {
  $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
  Install-SkillCopy -Parent (Join-Path $CodexHome 'skills')
}

if ($Target -eq 'DSH' -or $Target -eq 'Both') {
  Install-SkillCopy -Parent (Join-Path $HOME '.agents\skills')
}

if (-not $SkipDshPlugin) {
  $ProfileDir = Join-Path $HOME '.dsh\profiles\web'
  $PatchPath = Join-Path $ProfileDir 'cordis.patch.yml'
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
  $PluginUri = [Uri]::new((Resolve-Path -LiteralPath $PluginSource).Path).AbsoluteUri
  $Existing = if (Test-Path -LiteralPath $PatchPath) { Get-Content -LiteralPath $PatchPath -Raw } else { '' }

  if ($Existing -match '(?m)^\s*-\s+id:\s+codex-appserver-bridge\s*$') {
    Write-Output "DSH plugin entry already exists: $PatchPath"
  } else {
    if (Test-Path -LiteralPath $PatchPath) {
      Copy-Item -LiteralPath $PatchPath -Destination "$PatchPath.backup-$Stamp"
    }
    $Entry = @"
- insert:
    - id: codex-appserver-bridge
      name: '$PluginUri'
"@
    if ($Existing -and -not $Existing.EndsWith("`n")) { Add-Content -LiteralPath $PatchPath -Value '' -Encoding utf8 }
    Add-Content -LiteralPath $PatchPath -Value $Entry.TrimEnd() -Encoding utf8
    Write-Output "Added persistent DSH plugin: $PatchPath"
  }
}

Write-Output 'Installation complete. Restart Codex and the DSH Web process.'

