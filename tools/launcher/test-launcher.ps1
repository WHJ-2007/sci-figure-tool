# test-launcher.ps1 — launcher.ps1 静态检查
$ErrorActionPreference = 'Stop'
$script:Pass = 0
$script:Fail = 0

function Assert-True([string]$name, [bool]$cond) {
    if ($cond) { $script:Pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
    else { $script:Fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

function Test-Done {
    Write-Host ("--- " + $script:Pass + " passed, " + $script:Fail + " failed ---")
    if ($script:Fail -gt 0) { exit 1 }
    exit 0
}

$launcherPath = Join-Path $PSScriptRoot "launcher.ps1"
Assert-True "launcher.ps1 存在" (Test-Path $launcherPath)

$bytes = [System.IO.File]::ReadAllBytes($launcherPath)
Assert-True "launcher.ps1 为 UTF-8 BOM" ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($launcherPath, [ref]$tokens, [ref]$errors) | Out-Null
Assert-True "launcher.ps1 语法正确" ($errors.Count -eq 0)

$corePath = Join-Path $PSScriptRoot "launcher-core.ps1"
$coreBytes = [System.IO.File]::ReadAllBytes($corePath)
Assert-True "launcher-core.ps1 为 UTF-8 BOM" ($coreBytes.Length -ge 3 -and $coreBytes[0] -eq 0xEF -and $coreBytes[1] -eq 0xBB -and $coreBytes[2] -eq 0xBF)

Test-Done
