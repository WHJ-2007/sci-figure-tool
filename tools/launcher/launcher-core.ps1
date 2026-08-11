# launcher-core.ps1 — 启动器核心逻辑（纯函数，点源加载无副作用）
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:CoreDir = $PSScriptRoot
$script:Port = 8081

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
    try {
        $raw = Get-Content $f -Raw
    } catch {
        # 文件被瞬时占用（如并发 Save-PidFile）：按"读取失败"处理，不删除文件
        return $null
    }
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
    # 仅认可 cmd/node 进程：防止 PID 复用后把无关进程误报为"运行中"
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    return [bool]($proc -and $proc.ProcessName -in @('cmd', 'node'))
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
        # 结束整棵进程树（cmd → npm → next）
        $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -in @('cmd', 'node')) {
            taskkill /PID $pidValue /T /F | Out-Null
            if ($LASTEXITCODE -eq 1) {
                # 拒绝访问：PID 可能仍存活，保留 PID 文件（不删除可能仍有效的 PID）
                return $false
            }
            Remove-PidFile
            return $true
        }
        # 进程不存在，或 PID 已被系统复用给无关进程（非 cmd/node）：
        # 仅清理过期 PID 文件并返回 $false —— 没有我们启动的进程在运行，如实报告
        Remove-PidFile
        return $false
    }
    return $false
}
