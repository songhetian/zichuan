# ============================================================
#  设备核对工具（现场版）
#  用途：在员工电脑上运行，采集主机/显示器型号，直连台账系统核对，
#        替代旧的「Excel 中转导入」流程，输出只保留核对必需的信息。
#  用法：双击同目录 device-check.bat，或右键"使用 PowerShell 运行"。
# ============================================================

# ↓↓↓ 按实际环境修改 ↓↓↓
$ServerUrl = "http://<服务器地址>"   # 台账系统地址（含端口，如 http://192.168.x.x:3000）
#$Token    = "请填令牌"                  # 若服务器设置了 DEVICE_CHECK_TOKEN，取消注释并填同一个值
# ↑↑↑ 按实际环境修改 ↑↑↑

$ErrorActionPreference = "Stop"

function Convert-MonitorName {
    param($Bytes)
    if (-not $Bytes) { return $null }
    $chars = @()
    foreach ($b in $Bytes) { if ($b -ne 0) { $chars += [char]$b } }
    $s = (-join $chars).Trim()
    if ($s) { return $s } else { return $null }
}

# ---------- 采集本机信息（只采核对需要的字段） ----------
try {
    $cs   = Get-CimInstance -ClassName Win32_ComputerSystem
    $bios = Get-CimInstance -ClassName Win32_BIOS
    $hostModel  = if ($cs.Model)   { $cs.Model.Trim() }   else { "" }
    $hostSerial = if ($bios.SerialNumber) { $bios.SerialNumber.Trim() } else { "" }

    $monitorNames = @()
    try {
        $mids = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction Stop
        foreach ($m in $mids) {
            $n = Convert-MonitorName $m.UserFriendlyName
            if ($n) { $monitorNames += $n }
        }
    } catch {
        # 老系统没有 WmiMonitorID 时回退
        $monitorNames = @(Get-CimInstance -ClassName Win32_DesktopMonitor -ErrorAction SilentlyContinue |
            ForEach-Object { $_.Name } | Where-Object { $_ })
    }
} catch {
    Write-Host "本机信息采集失败：$($_.Exception.Message)" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

$monitorText = if ($monitorNames.Count -gt 0) { $monitorNames -join " | " } else { "(未检测到)" }

Write-Host ""
Write-Host "══════════ 设备核对 ══════════" -ForegroundColor Cyan
Write-Host ("  本机主机型号: {0}    序列号: {1}" -f $(if ($hostModel) { $hostModel } else { "(未能读取)" }), $(if ($hostSerial) { $hostSerial } else { "(无)" }))
Write-Host ("  检测到显示器: {0}" -f $monitorText)
Write-Host ""

# ---------- 输入设备编号 ----------
$hostNo = (Read-Host "请输入主机设备编号（必填，见设备标签，如 DN-0001）").Trim()
while (-not $hostNo) {
    $hostNo = (Read-Host "主机设备编号不能为空，请重新输入").Trim()
}
$monNo = (Read-Host "请输入显示器设备编号（没有/不确定可直接回车跳过）").Trim()

# ---------- 组装并请求台账 ----------
$items = @(
    @{ kind = "host"; assetNo = $hostNo; detectedModel = $hostModel; detectedSerial = $hostSerial }
)
if ($monNo) {
    $items += @{ kind = "monitor"; assetNo = $monNo; detectedModel = $monitorText }
}

$headers = @{}
if (Get-Variable -Name Token -ErrorAction SilentlyContinue) { if ($Token) { $headers["x-device-token"] = $Token } }

$payload = @{ hostname = $env:COMPUTERNAME; items = $items } | ConvertTo-Json -Depth 5

try {
    $resp = Invoke-RestMethod -Uri "$ServerUrl/api/device-check" -Method Post `
        -ContentType "application/json" -Headers $headers -Body $payload -TimeoutSec 15
} catch {
    Write-Host ""
    Write-Host "连接台账系统失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请检查脚本顶部的 ServerUrl 是否正确、以及是否与服务器同一网络。" -ForegroundColor Yellow
    Read-Host "按回车键退出"
    exit 1
}

# ---------- 输出核对结果（精简：只留核对必需信息） ----------
$verdictText = @{
    MATCH        = "OK  型号一致"
    MISMATCH     = "X   型号不一致"
    NOT_FOUND    = "?   编号未登记"
    DB_NO_MODEL  = "?   台账未填型号"
    NO_DETECT    = "?   未采集到本机型号"
    KIND_MISMATCH= "X   分类不符"
}
$verdictColor = @{
    MATCH        = "Green"
    MISMATCH     = "Red"
    NOT_FOUND    = "Yellow"
    DB_NO_MODEL  = "Yellow"
    NO_DETECT    = "Yellow"
    KIND_MISMATCH= "Red"
}

Write-Host ""
Write-Host "──────────── 核对结果 ────────────" -ForegroundColor Cyan
$allOk = $true
foreach ($r in $resp.results) {
    $allOk = $allOk -and ($r.verdict -eq "MATCH")
    Write-Host ("  [{0}]  {1}  {2}" -f $r.assetNo, $(if ($r.kind -eq "host") { "主机" } else { "显示器" }), $verdictText[$r.verdict]) -ForegroundColor $verdictColor[$r.verdict]
    Write-Host ("        检测型号: {0}" -f $(if ($r.detectedModel) { $r.detectedModel } else { "—" }))
    Write-Host ("        台账型号: {0}" -f $(if ($r.dbModel) { $r.dbModel } else { "—" }))
    if ($r.verdict -ne "MATCH") {
        Write-Host ("        说明: {0}" -f $r.message) -ForegroundColor Yellow
        if ($r.dbHolder) { Write-Host ("        台账使用人: {0}    状态: {1}" -f $r.dbHolder, $r.dbStatus) }
    }
}
Write-Host ""
if ($allOk) { Write-Host "  ✔ 全部核对通过" -ForegroundColor Green }
else        { Write-Host "  存在待处理项，请按上方说明处理" -ForegroundColor Yellow }
Write-Host ""
Read-Host "按回车键退出"
