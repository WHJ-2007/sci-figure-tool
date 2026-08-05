# test-core.ps1 — launcher-core 冒烟测试
$ErrorActionPreference = 'Stop'
$script:Pass = 0
$script:Fail = 0

function Assert-True([string]$name, [bool]$cond) {
    if ($cond) { $script:Pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
    else { $script:Fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

function Assert-False([string]$name, [bool]$cond) { Assert-True $name (-not $cond) }

function Test-Done {
    Write-Host ("--- " + $script:Pass + " passed, " + $script:Fail + " failed ---")
    if ($script:Fail -gt 0) { exit 1 }
    exit 0
}

. "$PSScriptRoot\launcher-core.ps1"

# BOM 编码（三个 .ps1 均须为 UTF-8 BOM，否则 PS 5.1 下中文串损坏）
foreach ($name in @('launcher-core.ps1', 'test-core.ps1', 'check-launcher.ps1')) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))
    Assert-True ("$name 为 UTF-8 BOM") ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
}

# 路径推导（工具目录 tools/launcher → 项目根）
$expectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Assert-True "项目根目录推导" ((Get-ProjectRoot) -eq $expectRoot)
Assert-True "端口为 3001" ((Get-Port) -eq 3001)
Assert-True "服务器地址" ((Get-ServerUrl) -eq "http://localhost:3001")

# 运行时目录
$rt = Get-RuntimeDir
$null = Ensure-RuntimeDir
Assert-True "运行时目录存在" (Test-Path $rt)
Assert-True "PID 文件路径" ((Get-PidFilePath) -like "*server.pid")

# PID 读写
$pidValue = 12345
Save-PidFile $pidValue
Assert-True "PID 写入读取" ((Load-PidFile) -eq $pidValue)
Remove-PidFile
Assert-True "PID 文件删除" (-not (Test-Path (Get-PidFilePath)))

# 端口检查（3001 不应被占用）
$used = Get-PortInUse
Assert-False "端口 3001 未被占用" $used

Test-Done
