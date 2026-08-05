# launcher.ps1 — 科研制图工具启动器（WinForms GUI）
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. "$PSScriptRoot\launcher-core.ps1"

$ErrorActionPreference = 'Continue'

$form = New-Object System.Windows.Forms.Form
$form.Text = "科研制图工具 启动器"
$form.Size = New-Object System.Drawing.Size(420, 380)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Location = New-Object System.Drawing.Point(12, 12)
$lblStatus.Size = New-Object System.Drawing.Size(380, 40)
$lblStatus.Text = "状态：未知"
$lblStatus.Font = New-Object System.Drawing.Font("Microsoft YaHei", 11, [System.Drawing.FontStyle]::Bold)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Location = New-Object System.Drawing.Point(12, 60)
$txtLog.Size = New-Object System.Drawing.Size(380, 220)
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Location = New-Object System.Drawing.Point(12, 295)
$btnStart.Size = New-Object System.Drawing.Size(90, 30)
$btnStart.Text = "启动"
$btnStart.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$btnStart.ForeColor = [System.Drawing.Color]::White

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Location = New-Object System.Drawing.Point(112, 295)
$btnStop.Size = New-Object System.Drawing.Size(90, 30)
$btnStop.Text = "停止"
$btnStop.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$btnStop.ForeColor = [System.Drawing.Color]::White

$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Location = New-Object System.Drawing.Point(212, 295)
$btnOpen.Size = New-Object System.Drawing.Size(90, 30)
$btnOpen.Text = "打开浏览器"

$btnExit = New-Object System.Windows.Forms.Button
$btnExit.Location = New-Object System.Drawing.Point(312, 295)
$btnExit.Size = New-Object System.Drawing.Size(90, 30)
$btnExit.Text = "退出"

function Update-Status {
    $s = & "$PSScriptRoot\check-launcher.ps1" | ConvertFrom-Json
    if ($s.alive) {
        $lblStatus.Text = "状态：运行中（PID $($s.pid)）"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(22, 163, 74)
    } else {
        $lblStatus.Text = "状态：已停止"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
    }
}

function Read-Logs {
    $out = Get-DevOutPath
    $err = Get-DevErrPath
    $text = ""
    if (Test-Path $out) { $text += (Get-Content $out -Tail 30 -ErrorAction SilentlyContinue) -join "`r`n" }
    if (Test-Path $err) {
        $errText = (Get-Content $err -Tail 10 -ErrorAction SilentlyContinue) -join "`r`n"
        if ($errText.Trim()) { $text += "`r`n--- stderr ---`r`n" + $errText }
    }
    if ($text.Trim()) { $txtLog.Text = $text } else { $txtLog.Text = "暂无日志" }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.add_Tick({ Update-Status; Read-Logs })
$timer.Start()

$btnStart.Add_Click({
    if (Get-PortInUse) {
        $lblStatus.Text = "端口 3001 已被占用，无法启动"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
        return
    }
    $id = Start-DevServer
    $lblStatus.Text = "正在启动（PID $id）…"
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(234, 179, 8)
    Update-Status
})

$btnStop.Add_Click({
    $was = Stop-DevServer
    if ($was) {
        $lblStatus.Text = "已停止服务"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
    } else {
        $lblStatus.Text = "没有运行中的服务"
        $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
    }
    Update-Status
})

$btnOpen.Add_Click({
    Start-Process (Get-ServerUrl)
})

$btnExit.Add_Click({ $form.Close() })

$form.Controls.Add($lblStatus)
$form.Controls.Add($txtLog)
$form.Controls.Add($btnStart)
$form.Controls.Add($btnStop)
$form.Controls.Add($btnOpen)
$form.Controls.Add($btnExit)

Update-Status
Read-Logs
[void]$form.ShowDialog()
