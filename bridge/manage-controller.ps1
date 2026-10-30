param(
  [ValidateSet('start', 'stop', 'restart', 'status')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Controller = Join-Path $PSScriptRoot 'controller\controller.mjs'
$Node = (Get-Command node -ErrorAction Stop).Source
$Port = 32123
if ($env:CODEX_BRIDGE_PORT) { $Port = [int]$env:CODEX_BRIDGE_PORT }
$Health = "http://127.0.0.1:$Port/health"

function Test-Ready {
  try {
    $r = Invoke-RestMethod -Uri $Health -TimeoutSec 2
    return [bool]$r.ready
  } catch { return $false }
}

if ($Action -eq 'stop' -or $Action -eq 'restart') {
  Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  if ($Action -eq 'stop') { exit 0 }
}

if ($Action -eq 'start' -and (Test-Ready)) { exit 0 }

if ($Action -ne 'status') {
  Start-Process -FilePath $Node -ArgumentList $Controller -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Ready) { exit 0 }
  }
  throw "Codex bridge controller did not become ready on $Health"
}

if (Test-Ready) { Write-Output 'ready' } else { Write-Output 'not-ready'; exit 1 }
