param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$Node = (Get-Command node -ErrorAction Stop).Source
$Manager = Join-Path $PSScriptRoot 'manage-controller.mjs'
if (-not (Test-Path -LiteralPath $Manager -PathType Leaf)) {
  throw "Cross-platform controller manager not found: $Manager"
}

& $Node $Manager $Action
exit $LASTEXITCODE
