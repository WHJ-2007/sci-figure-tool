# launcher-core.ps1 — 启动器核心逻辑（纯函数，点源加载无副作用）
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:CoreDir = $PSScriptRoot
$script:Port = 3001

function Get-LauncherDir { return $script:CoreDir }

function Get-ProjectRoot {
    return (Split-Path (Split-Path $script:CoreDir -Parent) -Parent)
}

function Get-Port { return $script:Port }

function Get-ServerUrl { return ("http://localhost:" + $script:Port) }

function Get-RuntimeDir { return (Join-Path $script:CoreDir ".runtime") }

function Get-LogsDir { return (Join-Path (Get-RuntimeDir) "logs") }

function Ensure-RuntimeDir {
    $dir = Get-RuntimeDir
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $logs = Join-Path $dir "logs"
    if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Path $logs | Out-Null }
    return $dir
}

function Get-PidFilePath { return (Join-Path (Get-RuntimeDir) "server.pid") }

function Get-DevOutPath { return (Join-Path (Get-RuntimeDir) "dev.out.log") }

function Get-DevErrPath { return (Join-Path (Get-RuntimeDir) "dev.err.log") }

function Save-PidFile([int]$pidValue) {
    Ensure-RuntimeDir | Out-Null
    $pidValue | Out-File -FilePath (Get-PidFilePath) -Encoding ascii
}

function Load-PidFile {
    $f = Get-PidFilePath
    if (-not (Test-Path $f)) { return $null }
    $raw = Get-Content $f -Raw
    if (-not $raw) { Remove-PidFile; return $null }
    $v = $raw.Trim()
    if ($v -match '^\d{1,8}$') { return [int]$v }
    Remove-PidFile
    return $null
}

function Remove-PidFile {
    $f = Get-PidFilePath
    if (Test-Path $f) { Remove-Item $f -Force }
}

function Is-ProcessAlive([int]$processId) {
    if ($processId -le 0) { return $false }
    return [bool](Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Get-PortInUse {
    $conn = Get-NetTCPConnection -LocalPort $script:Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$conn
}

function Start-DevServer {
    Ensure-RuntimeDir | Out-Null
    $root = Get-ProjectRoot
    $out = Get-DevOutPath
    $err = Get-DevErrPath
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
    Save-PidFile $proc.Id
    return $proc.Id
}

function Stop-DevServer {
    $pidValue = Load-PidFile
    if ($pidValue) {
        # 结束整棵进程树（npm → next）
        $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($proc) {
            taskkill /PID $pidValue /T /F | Out-Null
        }
        Remove-PidFile
        return $true
    }
    return $false
}
