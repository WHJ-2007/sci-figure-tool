# check-launcher.ps1 — 输出服务器状态（JSON），供 GUI/调试使用
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\launcher-core.ps1"

$pidValue = Load-PidFile
$alive = $false
if ($pidValue) { $alive = Is-ProcessAlive $pidValue }
$portUsed = Get-PortInUse

$status = @{
    pid = $pidValue
    alive = $alive
    portUsed = $portUsed
    url = Get-ServerUrl
}
$status | ConvertTo-Json -Compress
