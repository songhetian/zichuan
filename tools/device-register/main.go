// 现场设备登记工具（GUI 版）—— 单文件窗口程序，拷到任何 Windows 电脑双击即用。
//
// 功能：
//   - 有输入框的独立窗口（非命令行）
//   - 自动采集本机详细配置：主机型号/序列号、CPU、内存、硬盘、显卡、系统、MAC、显示器
//   - 直连 MySQL 台账库：部门/员工没有就自动创建（含登录账号），设备直接写入
//     「设备详情」（服务端自动编号，不要求选模板），同一台设备不会重复建档
//
// 数据库配置（优先级从高到低）：
//  1. 命令行参数  DeviceRegister.exe -host 192.168.x.x -port 3306 -user xxx -password xxx -dbname asset-manage
//  2. exe 同目录  device-tool.ini（host=/port=/user=/password=/dbname=）
//  3. 编译时注入  go build -ldflags "-X main.defHost=... -X main.defDBName=..."
//  4. 内置默认值  本机开发库（当前测试用）
package main

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	_ "github.com/go-sql-driver/mysql"
	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
	"github.com/lxn/win"
	"golang.org/x/crypto/bcrypt"
)

// ────────────── 默认配置（本地测试用；上线时用 -ldflags 注入生产值） ──────────────

var (
	defHost     = "127.0.0.1"
	defPort     = "3306"
	defUser     = "root"
	defPassword = "root"
	defDBName   = "asset-manage-dev-online"
	// 走接口模式：ini 里填 server= 即启用（数据库密码不出服务器，推荐生产使用）
	defServer = ""
	defToken  = ""
)

type appConfig struct {
	Host, Port, User, Password, DBName string
	Server, Token                      string // 非空 = 接口模式
}

const configFileName = "device-tool.ini"

func loadConfig() *appConfig {
	c := &appConfig{defHost, defPort, defUser, defPassword, defDBName, defServer, defToken}
	exePath, err := os.Executable()
	if err != nil {
		return c
	}
	data, err := os.ReadFile(filepath.Join(filepath.Dir(exePath), configFileName))
	if err != nil {
		return c
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		k, v, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		k = strings.ToLower(strings.TrimSpace(k))
		v = strings.TrimSpace(v)
		switch k {
		case "host":
			c.Host = v
		case "port":
			c.Port = v
		case "user":
			c.User = v
		case "password":
			c.Password = v
		case "dbname":
			c.DBName = v
		case "server":
			c.Server = strings.TrimRight(v, "/")
		case "token":
			c.Token = v
		}
	}
	return c
}

// apiMode server= 非空时走系统 HTTP 接口（推荐），否则直连数据库
func (c *appConfig) apiMode() bool { return c.Server != "" }

func (c *appConfig) dsn() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=true&loc=Local&timeout=5s",
		c.User, c.Password, c.Host, c.Port, c.DBName)
}

// ────────────── 硬件采集（内嵌 PowerShell） ──────────────

type monitorInfo struct {
	Model  string `json:"model"`
	Serial string `json:"serial"`
	Maker  string `json:"maker"` // EDID 厂商码（如 DEL），解析为品牌名
}

type diskInfo struct {
	M  string `json:"m"`
	GB int64  `json:"gb"`
}

type stickInfo struct {
	GB    int    `json:"gb"`
	Maker string `json:"maker"`
}

type hwInfo struct {
	Model          string        `json:"model"`
	BaseboardModel string        `json:"baseModel"`
	Serial         string        `json:"serial"`
	Brand          string        `json:"brand"` // 主板/整机品牌
	Laptop         bool          `json:"laptop"`
	CPU            string        `json:"cpu"`
	Cores          int           `json:"cores"`
	Threads        int           `json:"threads"`
	RamGB          float64       `json:"ramGb"`
	RamSticks      int           `json:"ramSticks"`
	Sticks         []stickInfo   `json:"sticks"`
	GPUs           []string      `json:"gpus"`
	OS             string        `json:"os"`
	Mac            string        `json:"mac"`
	KB             string        `json:"kb"`
	KBMaker        string        `json:"kbMaker"`
	Mouse          string        `json:"mouse"`
	MouseMaker     string        `json:"mouseMaker"`
	Disks          []diskInfo    `json:"disks"`
	Monitors       []monitorInfo `json:"monitors"`
}

const detectScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$base = Get-CimInstance Win32_BaseBoard
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$gpuNames = @((Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }))
$disks = Get-CimInstance Win32_DiskDrive | ForEach-Object {
  [pscustomobject]@{ m = $_.Model; gb = [math]::Round($_.Size/1GB) }
} | Where-Object { $_.gb -gt 0 }
$rams = @(Get-CimInstance Win32_PhysicalMemory)
$sticks = @($rams | ForEach-Object {
  [pscustomobject]@{ gb = [math]::Round($_.Capacity/1GB); maker = $_.Manufacturer.Trim() }
})
$mac = (Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' | Select-Object -First 1).MACAddress
# 键鼠识别：PnP 非通用品名优先（同 VID&PID 兄弟接口常带真实型号）→ VID 厂商码 → 未知。
# 键盘跳过与鼠标同 VID&PID 的接口（雷蛇等鼠标自带的多媒体键盘接口），避免把鼠标识别成键盘。
$generic = @('HID-compliant mouse','HID Keyboard Device','USB Input Device','HID-compliant device','HID-compliant consumer control device','HID-compliant system controller','HID-compliant system multi-axis controller','I2C HID Device')
$vidBrands = @{ '1532'='雷蛇 Razer'; '046D'='罗技 Logitech'; '045E'='微软 Microsoft'; '05AC'='苹果 Apple'; '24AE'='雷柏 Rapoo'; '1B1C'='海盗船 Corsair'; '413C'='戴尔 Dell'; '03F0'='惠普 HP'; '17EF'='联想 Lenovo'; '0458'='精灵 Genius' }
$hidNames = @{}
Get-PnpDevice -Class HIDClass | Where-Object { $_.Status -eq 'OK' -and $generic -notcontains $_.FriendlyName } | ForEach-Object {
  if ($_.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') {
    $hidNames[('VID_' + $Matches[1] + '&PID_' + $Matches[2])] = $_.FriendlyName
  }
}
function Find-HidDev($class) {
  Get-PnpDevice -Class $class | Where-Object { $_.Status -eq 'OK' -and $_.InstanceId -match 'HID\\VID_|USB\\VID_' } |
    Sort-Object { if ($generic -notcontains $_.FriendlyName) { 0 } else { 1 } }
}
function Resolve-HidName($dev, $suffix) {
  if ($dev) {
    if ($generic -notcontains $dev.FriendlyName) { return $dev.FriendlyName }
    if ($dev.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') {
      $key = 'VID_' + $Matches[1] + '&PID_' + $Matches[2]
      if ($hidNames.ContainsKey($key)) { return $hidNames[$key] }
      $b = $vidBrands[$Matches[1]]
      if ($b) { return $b + ' ' + $suffix }
    }
  }
  return '未知 ' + $suffix
}
$msDev = Find-HidDev 'Mouse' | Select-Object -First 1
$msKey = ''
if ($msDev -and $msDev.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') { $msKey = 'VID_' + $Matches[1] + '&PID_' + $Matches[2] }
$kbDev = Find-HidDev 'Keyboard' | Where-Object {
  $k = ''
  if ($_.InstanceId -match 'VID_([0-9A-Fa-f]{4})&PID_([0-9A-Fa-f]{4})') { $k = 'VID_' + $Matches[1] + '&PID_' + $Matches[2] }
  $k -ne '' -and $k -ne $msKey
} | Select-Object -First 1
$mouse = Resolve-HidName $msDev '鼠标'
$kb = Resolve-HidName $kbDev '键盘'

function Get-EdidInfo($inst) {
  $p = $inst -split '\\'
  if ($p.Count -lt 3) { return $null }
  $edid = (Get-ItemProperty ("HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\DISPLAY\\" + $p[1] + "\\" + $p[2] + "\\Device Parameters") -Name EDID -ErrorAction SilentlyContinue).EDID
  if (-not $edid) { return $null }
  $w = $edid[8] -bor ($edid[9] -shl 8)
  $mk = ''
  foreach ($sh in 10,5,0) { $mk += [char](((($w -shr $sh) -band 31) + 64)) }
  $name = ''; $ser = ''
  foreach ($off in 54,72,90,108) {
    $t = $edid[$off+3]
    $txt = ''
    foreach ($b in $edid[($off+5)..($off+17)]) { if ($b -ge 32 -and $b -le 126) { $txt += [char]$b } }
    $txt = $txt.Trim()
    if ($t -eq 0xFC -and -not $name) { $name = $txt }
    if ($t -eq 0xFF -and -not $ser)  { $ser = $txt }
  }
  [pscustomobject]@{ maker = $mk; name = $name; serial = $ser }
}
$mons = @()
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID | ForEach-Object {
  $n = ''; $s = ''; $mk = ''
  if ($_.UserFriendlyName) { foreach ($b in $_.UserFriendlyName) { if ($b -ne 0) { $n += [char]$b } } }
  if ($_.SerialNumberID)  { foreach ($b in $_.SerialNumberID)  { if ($b -ne 0) { $s += [char]$b } } }
  if ($_.ManufacturerName) { foreach ($b in $_.ManufacturerName) { if ($b -ne 0) { $mk += [char]$b } } }
  # WMI 缺型号/序列号/厂商时从注册表 EDID 补（HKC 等杂牌 EDID 常缺型号名）
  if (-not $n.Trim() -or -not $s.Trim() -or -not $mk.Trim()) {
    $e = Get-EdidInfo $_.InstanceName
    if ($e) {
      if (-not $mk.Trim()) { $mk = $e.maker }
      if (-not $n.Trim())  { $n = $e.name }
      if (-not $s.Trim())  { $s = $e.serial }
    }
  }
  if (-not $n.Trim()) { $n = '显示器' }  # 仍无型号：占位，品牌由 maker 呈现
  $mons += [pscustomobject]@{ model = $n.Trim(); serial = $s.Trim(); maker = $mk.Trim() }
}
[pscustomobject]@{
  model = $cs.Model; serial = $bios.SerialNumber; brand = $base.Manufacturer
  baseModel = $base.Product
  laptop = ($cs.PCSystemType -eq 2)
  cpu = $cpu.Name; cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors
  ramGb = [math]::Round($cs.TotalPhysicalMemory/1GB, 1)
  ramSticks = $rams.Count; sticks = @($sticks)
  gpus = @($gpuNames); os = $os.Caption; mac = $mac
  kb = $kb; mouse = $mouse
  disks = @($disks); monitors = @($mons)
} | ConvertTo-Json -Compress -Depth 3
`

func detect() (*hwInfo, error) {
	utf16LE := utf16.Encode([]rune(detectScript))
	raw := make([]byte, len(utf16LE)*2)
	for i, v := range utf16LE {
		raw[i*2] = byte(v)
		raw[i*2+1] = byte(v >> 8)
	}
	encoded := base64.StdEncoding.EncodeToString(raw)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("powershell 采集失败: %s", msg)
	}

	var h hwInfo
	if err := json.Unmarshal(stdout.Bytes(), &h); err != nil {
		return nil, fmt.Errorf("解析采集结果失败: %w", err)
	}
	h.Model = strings.TrimSpace(h.Model)
	if h.Model == "" {
		h.Model = strings.TrimSpace(h.BaseboardModel)
	}
	h.Serial = cleanSerial(h.Serial)
	h.Brand = cleanBrand(strings.TrimSpace(h.Brand))
	h.CPU = cleanCPU(strings.TrimSpace(h.CPU))
	// 显卡：过滤虚拟显卡与集成显卡（Intel UHD/HD、AMD Radeon Graphics），只保留独立显卡
	gpus := []string{}
	for _, g := range h.GPUs {
		g = strings.TrimSpace(g)
		if g != "" && !gpuFilterRe.MatchString(g) {
			gpus = append(gpus, g)
		}
	}
	h.GPUs = gpus
	h.OS = strings.TrimSpace(h.OS)
	h.Mac = strings.TrimSpace(h.Mac)
	h.KB = strings.TrimSpace(h.KB)
	h.KBMaker = cleanVendor(strings.TrimSpace(h.KBMaker))
	h.Mouse = strings.TrimSpace(h.Mouse)
	h.MouseMaker = cleanVendor(strings.TrimSpace(h.MouseMaker))
	// 内存条逐条记录（容量+品牌）；总量按各条容量精确合计（系统上报 31.7G 实为 32G）
	ramTotal := 0
	for i := range h.Sticks {
		h.Sticks[i].Maker = cleanRamMaker(h.Sticks[i].Maker)
		if h.Sticks[i].Maker == "" {
			h.Sticks[i].Maker = "未知"
		}
		ramTotal += h.Sticks[i].GB
	}
	if ramTotal > 0 {
		h.RamGB = float64(ramTotal)
		h.RamSticks = len(h.Sticks)
	}
	for i := range h.Monitors {
		h.Monitors[i].Model = strings.TrimSpace(h.Monitors[i].Model)
		h.Monitors[i].Serial = cleanSerial(h.Monitors[i].Serial)
		h.Monitors[i].Maker = monitorBrandName(strings.TrimSpace(h.Monitors[i].Maker))
	}
	h.Disks = append([]diskInfo{}, h.Disks...)
	return &h, nil
}

// cleanSerial 过滤主板/显示器的占位串（两台机器会撞出同一个假序列号）
func cleanSerial(s string) string {
	s = strings.TrimSpace(s)
	switch strings.ToLower(s) {
	case "", "default string", "to be filled by o.e.m.", "system serial number",
		"0", "none", "n/a", "serial number", "o.e.m.":
		return ""
	}
	return s
}

// cleanBrand 归并主板厂商的全称（太长不适合展示），占位串清空；大小写不敏感
func cleanBrand(s string) string {
	s = strings.TrimSpace(s)
	switch strings.ToLower(s) {
	case "", "to be filled by o.e.m.", "default string", "system manufacturer",
		"system product name", "none", "o.e.m.", "n/a":
		return ""
	}
	lower := strings.ToLower(s)
	switch {
	case strings.Contains(lower, "micro-star"):
		return "微星 MSI"
	case strings.Contains(lower, "asustek"):
		return "华硕 ASUS"
	case strings.Contains(lower, "gigabyte"):
		return "技嘉 GIGABYTE"
	case strings.Contains(lower, "colorful"):
		return "七彩虹 Colorful"
	case strings.Contains(lower, "dell"):
		return "戴尔 Dell"
	case strings.Contains(lower, "lenovo"):
		return "联想 Lenovo"
	case strings.Contains(lower, "hewlett-packard") || lower == "hp":
		return "惠普 HP"
	case strings.Contains(lower, "huawei"):
		return "华为 HUAWEI"
	case strings.Contains(lower, "hasee") || strings.Contains(lower, "神舟"):
		return "神舟 Hasee"
	case strings.Contains(lower, "tim") || strings.Contains(lower, "xiaomi"):
		return "小米/红米"
	}
	return s
}

var (
	// "12th Gen Intel Core i5-12400" → i5 / 12400
	intelCoreRe = regexp.MustCompile(`(?i)\bi([3579])[ -]?(\d{4,5}[A-Za-z]{0,3})\b`)
	// "AMD Ryzen 5 5600 6-Core Processor" → R5 / 5600
	amdRyzenRe = regexp.MustCompile(`(?i)ryzen\s*(\d)\s*(\d{4}\w*)`)
	// "Ryzen Threadripper 3960X"
	ryzenTRRe = regexp.MustCompile(`(?i)ryzen\s*threadripper\s*(\d{4}\w*)`)
	// 尾部噪音：@频率、xx-Core Processor、processor
	cpuNoiseRe = regexp.MustCompile(`(?i)\s*cpu\s*@.*$|@.*$|\s+\d+-core\s+processor.*$|\s+processor\s*$`)
	// 未知厂商名的公司后缀（如 "Shenzhen Zhongshi Technology Co Ltd"）
	ramSuffixRe = regexp.MustCompile(`(?i)\s*(technology|electronics|semiconductor|electric|microsystems?)( co\.,? ltd| co\.? ltd| inc\.?| corporation| corp\.?| ltd\.?)?\s*$`)
	// SMBIOS 占位串（纯十六进制长串）
	hexGarbageRe = regexp.MustCompile(`^[0-9A-Fa-f]{8,}$`)
	// 未知厂商名开头的地名（如 Shenzhen Zhongshi → Zhongshi）
	ramLocationRe = regexp.MustCompile(`(?i)^(shenzhen|shanghai|beijing|guangzhou|dongguan|suzhou|hangzhou|chengdu|wuhan|hong kong|hongkong)\s+`)
	// 虚拟/集成显卡过滤（GameViewer Virtual、Intel UHD/HD、Radeon Graphics 等）
	gpuFilterRe = regexp.MustCompile(`(?i)virtual|basic display|hyper-v|(uhd|hd) graphics|radeon.{0,8}(graphics|vega)`)
)

// cleanCPU 精简 CPU 名称：品牌 + 型号（"12th Gen Intel Core i5-12400" → "Intel i5-12400"，
// "AMD Ryzen 5 5600 6-Core Processor" → "AMD R5 5600"）；识别不了就只去尾部噪音
func cleanCPU(s string) string {
	s = strings.NewReplacer("(R)", "", "(TM)", "", "(r)", "", "(tm)", "").Replace(s)
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if m := ryzenTRRe.FindStringSubmatch(s); m != nil {
		return "AMD Threadripper " + m[1]
	}
	if m := amdRyzenRe.FindStringSubmatch(s); m != nil {
		return "AMD R" + m[1] + " " + m[2]
	}
	if m := intelCoreRe.FindStringSubmatch(s); m != nil {
		return "Intel i" + m[1] + "-" + strings.ToUpper(m[2])
	}
	s = strings.TrimSpace(cpuNoiseRe.ReplaceAllString(s, ""))
	lower := strings.ToLower(s)
	if strings.Contains(lower, "celeron") || strings.Contains(lower, "pentium") {
		f := strings.Fields(s)
		if len(f) > 0 {
			brand := "Intel Celeron"
			if strings.Contains(lower, "pentium") {
				brand = "Intel Pentium"
			}
			return brand + " " + f[len(f)-1]
		}
	}
	return s
}

// 内存品牌归一（SMBIOS 常报全称）；识别不了就删掉公司后缀留核心词
var ramMakerRules = []struct{ key, name string }{
	{"kingston", "金士顿 Kingston"},
	{"samsung", "三星 Samsung"},
	{"hynix", "海力士 SK Hynix"},
	{"micron", "美光 Micron"},
	{"crucial", "英睿达 Crucial"},
	{"corsair", "海盗船 Corsair"},
	{"g.skill", "芝奇 G.SKILL"},
	{"gskill", "芝奇 G.SKILL"},
	{"adata", "威刚 ADATA"},
	{"team group", "十铨 Team"},
	{"apacer", "宇瞻 Apacer"},
	{"transcend", "创见 Transcend"},
	{"ramaxel", "记忆科技 Ramaxel"},
	{"nanya", "南亚 Nanya"},
	{"kingbank", "金百达 KingBank"},
	{"biwin", "佰维 BIWIN"},
	{"longsys", "江波龙 Longsys"},
	{"ymtc", "长江存储 YMTC"},
	{"timetec", "天弘 Timetec"},
	{"lenovo", "联想 Lenovo"},
}

// cleanRamMaker 内存条品牌归一；占位串/识别不了返回空或短名
func cleanRamMaker(s string) string {
	s = strings.TrimSpace(s)
	lower := strings.ToLower(s)
	if s == "" || lower == "unknown" || lower == "undefined" || lower == "module part number" || hexGarbageRe.MatchString(s) {
		return ""
	}
	for _, r := range ramMakerRules {
		if strings.Contains(lower, r.key) {
			return r.name
		}
	}
	s = strings.TrimSuffix(s, ".")
	s = strings.TrimSpace(ramSuffixRe.ReplaceAllString(s, ""))
	s = strings.TrimSpace(ramLocationRe.ReplaceAllString(s, ""))
	return s
}

// EDID 三字母厂商码 → 品牌名（常见显示器厂商）
var monitorBrandMap = map[string]string{
	"DEL": "戴尔 Dell", "SAM": "三星 Samsung", "GSM": "LG", "LPL": "LG",
	"AOC": "AOC", "PHL": "飞利浦 Philips", "BNQ": "明基 BenQ", "ACI": "华硕 ASUS",
	"MSI": "微星 MSI", "MST": "MSI", "MTC": "冠捷", "TPV": "AOC 冠捷",
	"HKC": "惠科 HKC", "SHP": "夏普 Sharp", "HWP": "惠普 HP", "HPN": "惠普 HP",
	"LEN": "联想 Lenovo", "SEC": "三星 Samsung", "SNY": "索尼 Sony",
	"VSC": "优派 ViewSonic", "NEC": "NEC", "EIZ": "艺卓 EIZO",
	"TCL": "TCL", "HTC": "海尔 Haier", "FUX": "富士康", "BOE": "京东方 BOE",
	"CMN": "群创 Innolux", "AUO": "友达 AUO", "HSD": "瀚斯宝丽",
	"MEI": "美格", "STU": "现代", "SKYWORTH": "创维", "KONKA": "康佳",
}

// monitorBrandName 厂商码解析为品牌名；解析不了就原样返回
func monitorBrandName(code string) string {
	if code == "" {
		return ""
	}
	if b, ok := monitorBrandMap[strings.ToUpper(code)]; ok {
		return b
	}
	return code
}

// 人类可读的详细配置（GUI 展示与 Asset.notes 同源）
func (h *hwInfo) summary() string {
	var b strings.Builder
	fmt.Fprintf(&b, "主板型号: %s", h.Model)
	if h.Brand != "" {
		fmt.Fprintf(&b, "  品牌: %s", h.Brand)
	}
	if h.Serial != "" {
		fmt.Fprintf(&b, "  (S/N: %s)", h.Serial)
	}
	b.WriteString("\n")
	if h.CPU != "" {
		fmt.Fprintf(&b, "CPU: %s", h.CPU)
		if h.Cores > 0 {
			fmt.Fprintf(&b, " (%d核%d线程)", h.Cores, h.Threads)
		}
		b.WriteString("\n")
	}
	if len(h.Sticks) > 0 {
		fmt.Fprintf(&b, "内存: %s\n", h.sticksDesc())
	} else if h.RamGB > 0 {
		fmt.Fprintf(&b, "内存: %d GB", int(math.Round(h.RamGB)))
		if h.RamSticks > 0 {
			fmt.Fprintf(&b, " (%d条)", h.RamSticks)
		}
		b.WriteString("\n")
	}
	for i, d := range h.Disks {
		if i >= 3 {
			break
		}
		fmt.Fprintf(&b, "硬盘%d: %s %dGB\n", i+1, d.M, d.GB)
	}
	if len(h.GPUs) > 0 {
		fmt.Fprintf(&b, "显卡: %s\n", strings.Join(h.GPUs, " + "))
	}
	if h.KB != "" {
		fmt.Fprintf(&b, "键盘: %s\n", vendorDev(h.KBMaker, h.KB))
	}
	if h.Mouse != "" {
		fmt.Fprintf(&b, "鼠标: %s\n", vendorDev(h.MouseMaker, h.Mouse))
	}
	if h.OS != "" {
		fmt.Fprintf(&b, "系统: %s\n", h.OS)
	}
	if h.Mac != "" {
		fmt.Fprintf(&b, "MAC: %s\n", h.Mac)
	}
	for i, m := range h.Monitors {
		fmt.Fprintf(&b, "显示器%d: %s", i+1, m.Model)
		if m.Maker != "" {
			fmt.Fprintf(&b, " (%s)", m.Maker)
		}
		if m.Serial != "" {
			fmt.Fprintf(&b, " (S/N: %s)", m.Serial)
		}
		b.WriteString("\n")
	}
	return b.String()
}

// brief 窗口里的分项摘要（每行一项、带品牌与数量；完整配置通过 summary 写入台账备注）
func (h *hwInfo) brief() string {
	os := strings.TrimPrefix(h.OS, "Microsoft ")
	var b strings.Builder
	line := func(label, val string) {
		if val != "" {
			fmt.Fprintf(&b, "%s  %s\n", label, val)
		}
	}
	line("主板:", strings.TrimSpace(h.Model+"  "+h.Brand))
	cpu := h.CPU
	if h.Cores > 0 {
		cpu += fmt.Sprintf("  %d核%d线程", h.Cores, h.Threads)
	}
	line("CPU:", cpu)
	ram := ""
	if len(h.Sticks) > 0 {
		ram = h.sticksDesc() // 只列内存条组成，不另报总数
	} else if h.RamGB > 0 {
		ram = fmt.Sprintf("%dG", int(math.Round(h.RamGB)))
	}
	line("内存:", ram)
	if len(h.Disks) > 0 {
		parts := make([]string, 0, len(h.Disks))
		for _, d := range h.Disks {
			parts = append(parts, fmt.Sprintf("%s %dG", diskBrand(d.M), d.GB))
		}
		desc := strings.Join(parts, " + ")
		if len(h.Disks) > 1 {
			desc += fmt.Sprintf(" · %d块", len(h.Disks))
		}
		line("硬盘:", desc)
	}
	line("显卡:", strings.Join(h.GPUs, " + "))
	line("系统:", os)
	if h.KB != "" {
		line("键盘:", vendorDev(h.KBMaker, h.KB))
	}
	if h.Mouse != "" {
		line("鼠标:", vendorDev(h.MouseMaker, h.Mouse))
	}
	for i, m := range h.Monitors {
		if i >= 3 {
			break
		}
		mon := m.Model
		if m.Maker != "" {
			mon = m.Maker + " " + mon
		} else {
			mon = "未知 " + mon
		}
		if m.Serial != "" {
			mon += " · S/N " + m.Serial
		}
		label := "显示器:"
		if len(h.Monitors) > 1 {
			label = fmt.Sprintf("显示器%d:", i+1)
			if i == 2 && len(h.Monitors) > 3 {
				mon += fmt.Sprintf(" 等%d台", len(h.Monitors))
			}
		}
		line(label, mon)
	}
	return strings.TrimRight(b.String(), "\n")
}

// sticksDesc 内存条摘要：同规格同品牌合并显示，混合时逐条标注
// 例: "16G金士顿 ×2" / "8G+8G+16G · 三星" / "8G三星+16G金士顿"
func (h *hwInfo) sticksDesc() string {
	n := len(h.Sticks)
	if n == 0 {
		return ""
	}
	first := h.Sticks[0]
	sameGB, sameMaker := true, true
	makers := []string{}
	for _, s := range h.Sticks {
		if s.GB != first.GB {
			sameGB = false
		}
		if s.Maker != first.Maker {
			sameMaker = false
		}
		if s.Maker == "" {
			continue
		}
		dup := false
		for _, m := range makers {
			if m == s.Maker {
				dup = true
				break
			}
		}
		if !dup {
			makers = append(makers, s.Maker)
		}
	}
	switch {
	case sameGB && sameMaker:
		return stickLabel(first.GB, shortMaker(first.Maker)) + fmt.Sprintf(" ×%d", n)
	case sameMaker:
		parts := make([]string, 0, n)
		for _, s := range h.Sticks {
			parts = append(parts, fmt.Sprintf("%dG", s.GB))
		}
		desc := strings.Join(parts, "+")
		if first.Maker != "" {
			desc += " · " + first.Maker
		}
		return desc
	default:
		parts := make([]string, 0, n)
		for _, s := range h.Sticks {
			parts = append(parts, stickLabel(s.GB, shortMaker(s.Maker)))
		}
		return strings.Join(parts, "+")
	}
}

// shortMaker 展示用短品牌名（"金士顿 Kingston" → "金士顿"）
func shortMaker(m string) string {
	if i := strings.IndexAny(m, " (（/"); i > 0 {
		return m[:i]
	}
	return m
}

// 硬盘品牌（型号字符串开头通常是品牌）
var diskBrandRules = []struct{ key, name string }{
	{"samsung", "三星"}, {"western", "西数"}, {"wdc", "西数"},
	{"seagate", "希捷"}, {"kingston", "金士顿"}, {"crucial", "英睿达"},
	{"micron", "美光"}, {"sandisk", "闪迪"}, {"intel", "英特尔"},
	{"hynix", "海力士"}, {"adata", "威刚"}, {"dahua", "大华"},
	{"hikvision", "海康威视"}, {"netac", "朗科"}, {"teclast", "台电"},
	{"colorful", "七彩虹"}, {"kingspec", "金胜维"}, {"kingdian", "金典"},
	{"foresee", "FORESEE"}, {"longsys", "江波龙"}, {"ymtc", "长江存储"},
	{"fanxiang", "梵想"}, {"biwin", "佰维"}, {"apacer", "宇瞻"},
	{"transcend", "创见"}, {"patriot", "博帝"}, {"team", "十铨"},
	{"orc", "奥睿科"}, {"goldenfir", "金田"},
}

// diskBrand 从硬盘型号提取品牌；识别不了返回「未知」
func diskBrand(model string) string {
	lower := strings.ToLower(model)
	for _, r := range diskBrandRules {
		if strings.Contains(lower, r.key) {
			return r.name
		}
	}
	return "未知"
}

// cleanVendor 键鼠厂商占位串清空（识别不了显示时落「未知」）
func cleanVendor(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(strings.ToLower(s), "(standard") {
		return ""
	}
	return s
}

// vendorDev 组合厂商与设备名（设备名已含厂商时不再重复前缀）
func vendorDev(maker, dev string) string {
	dev = strings.TrimSpace(dev)
	maker = strings.TrimSpace(maker)
	if dev == "" {
		return ""
	}
	if maker == "" || strings.Contains(strings.ToLower(dev), strings.ToLower(maker)) {
		return dev
	}
	return maker + " " + dev
}

// cpuModelOnly 去掉 CPU 简名前缀（Intel /AMD），用于与主板型号组合
func cpuModelOnly(s string) string {
	s = strings.TrimPrefix(strings.TrimSpace(s), "Intel ")
	s = strings.TrimPrefix(s, "AMD ")
	return s
}

// stickLabel 单条内存标签：中文品牌紧贴容量（16G金士顿），ASCII 品牌补空格（16G Zhongshi）
func stickLabel(gb int, maker string) string {
	if maker == "" {
		return fmt.Sprintf("%dG", gb)
	}
	sep := ""
	if maker[0] < 128 {
		sep = " "
	}
	return fmt.Sprintf("%dG%s%s", gb, sep, maker)
}

// ────────────── 型号模糊匹配（与服务端 device-check.ts 同口径） ──────────────

func normalizeModel(raw string) string {
	s := strings.ToLower(raw)
	var b strings.Builder
	for _, r := range s {
		switch r {
		case ' ', '-', '_', '（', '）', '(', ')', '"', '\'', '‘', '’', '“', '”':
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func modelMatches(a, b string) bool {
	na, nb := normalizeModel(a), normalizeModel(b)
	if na == "" || nb == "" {
		return false
	}
	return na == nb || strings.Contains(na, nb) || strings.Contains(nb, na)
}

// ────────────── 直连数据库登记（与 /api/device-register 同口径） ──────────────

const DIRECT_TEMPLATE_NAME = "现场直录"
const EMPLOYEE_NO_PREFIX = "EMP"

var fallbackCodes = map[string]string{"笔记本": "LP", "台式机": "DN", "显示器": "XS"}

type registerInput struct {
	Hostname     string
	Department   string
	EmployeeName string
	HostModel    string
	HostSerial   string
	HostBrand    string
	IsLaptop     bool
	HostAssetNo  string       // 已有主机编号：填了就把配置写进该记录（不新建）
	Monitor      *monitorInfo // nil = 不登记显示器
	MonAssetNo   string       // 已有显示器编号：同上
	Notes        string       // 主机详细配置摘要
}

// monitorNotes 显示器自己的配置说明（不混入主机配置）
func (in *registerInput) monitorNotes() string {
	if in.Monitor == nil {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "显示器型号: %s", in.Monitor.Model)
	if in.Monitor.Maker != "" {
		fmt.Fprintf(&b, "（%s）", in.Monitor.Maker)
	}
	if in.Monitor.Serial != "" {
		fmt.Fprintf(&b, "  S/N: %s", in.Monitor.Serial)
	}
	return b.String()
}

type itemResult struct {
	Kind    string // 主机 | 显示器
	Action  string // 新建 | 已存在 | 冲突
	AssetNo string
	Model   string
	Message string
}

type registerOutput struct {
	DeptName   string
	DeptAction string
	EmpName    string
	EmpNo      string
	EmpAction  string
	EmpNote    string
	Items      []itemResult
	OK         bool
}

type queryer interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func registerAll(db *sql.DB, in registerInput) (*registerOutput, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	out := &registerOutput{}

	// ── 1) 分类（复用既有配置；缺了才建） ──
	hostCatName := "台式机"
	if in.IsLaptop {
		hostCatName = "笔记本"
	}
	hostCat, err := ensureCategory(tx, hostCatName)
	if err != nil {
		return nil, err
	}
	hostTpl, err := ensureDirectTemplate(tx, hostCat.id)
	if err != nil {
		return nil, err
	}
	var monCat *categoryRow
	var monTplID int64
	if in.Monitor != nil {
		monCat, err = ensureCategory(tx, "显示器")
		if err != nil {
			return nil, err
		}
		monTpl, err := ensureDirectTemplate(tx, monCat.id)
		if err != nil {
			return nil, err
		}
		monTplID = monTpl.id
	}

	// ── 2) 部门：没有就创建 ──
	var deptID int64
	err = tx.QueryRow("SELECT id FROM Department WHERE name = ?", in.Department).Scan(&deptID)
	if err == sql.ErrNoRows {
		res, e := tx.Exec("INSERT INTO Department (name, createdAt, updatedAt) VALUES (?, NOW(), NOW())", in.Department)
		if e != nil {
			return nil, wrap("创建部门失败", e)
		}
		deptID, _ = res.LastInsertId()
		out.DeptAction = "新建"
	} else if err != nil {
		return nil, wrap("查询部门失败", err)
	} else {
		out.DeptAction = "已存在"
	}
	out.DeptName = in.Department

	// ── 3) 员工：没有就创建（含登录账号，初始密码 123456，首登改密） ──
	var empID int64
	var empNo string
	err = tx.QueryRow(
		"SELECT id, employeeNo FROM Employee WHERE name = ? AND status = 'ACTIVE' ORDER BY id ASC LIMIT 1",
		in.EmployeeName).Scan(&empID, &empNo)
	if err == sql.ErrNoRows {
		empNo, err = nextEmployeeNo(tx)
		if err != nil {
			return nil, err
		}
		res, e := tx.Exec(
			"INSERT INTO Employee (employeeNo, name, departmentId, status, createdAt, updatedAt) VALUES (?, ?, ?, 'ACTIVE', NOW(), NOW())",
			empNo, in.EmployeeName, deptID)
		if e != nil {
			return nil, wrap("创建员工失败", e)
		}
		empID, _ = res.LastInsertId()

		var roleID sql.NullInt64
		_ = tx.QueryRow("SELECT id FROM Role WHERE `key` = 'EMPLOYEE'").Scan(&roleID)
		hashed, e := bcrypt.GenerateFromPassword([]byte("123456"), 10)
		if e != nil {
			return nil, wrap("密码加密失败", e)
		}
		if _, e := tx.Exec(
			"INSERT INTO Admin (username, password, displayName, roleId, employeeId, mustChangePassword, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, 1, NOW(), NOW())",
			empNo, string(hashed), in.EmployeeName, roleID, empID); e != nil {
			return nil, wrap("创建登录账号失败", e)
		}
		out.EmpAction = "新建"
	} else if err != nil {
		return nil, wrap("查询员工失败", err)
	} else {
		out.EmpAction = "已存在"
	}
	out.EmpName = in.EmployeeName
	out.EmpNo = empNo

	// ── 4) 逐台登记 ──
	hostRes, err := registerOne(tx, registerOneArgs{
		kind: "主机", empID: empID, empName: in.EmployeeName,
		model: in.HostModel, serial: in.HostSerial, brand: in.HostBrand,
		cat: hostCat, tplID: hostTpl.id, notes: in.Notes, existingNo: in.HostAssetNo,
	})
	if err != nil {
		return nil, err
	}
	out.Items = append(out.Items, *hostRes)

	if in.Monitor != nil {
		// 显示器有自己的配置说明（型号/品牌/序列号），不混入主机配置
		monRes, err := registerOne(tx, registerOneArgs{
			kind: "显示器", empID: empID, empName: in.EmployeeName,
			model: in.Monitor.Model, serial: in.Monitor.Serial, brand: in.Monitor.Maker,
			cat: monCat, tplID: monTplID, notes: in.monitorNotes(), existingNo: in.MonAssetNo,
		})
		if err != nil {
			return nil, err
		}
		out.Items = append(out.Items, *monRes)
	}

	// ── 5) SystemLog 留痕 ──
	parts := make([]string, 0, len(out.Items))
	for _, it := range out.Items {
		parts = append(parts, fmt.Sprintf("%s[%s]", it.AssetNo, it.Action))
	}
	detail := fmt.Sprintf("现场直连登记（%s）：部门=%s(%s)，员工=%s/%s(%s)，设备=%s",
		in.Hostname, out.DeptName, out.DeptAction, out.EmpName, out.EmpNo, out.EmpAction, strings.Join(parts, ", "))
	_, _ = tx.Exec("INSERT INTO SystemLog (module, action, detail, operator, createdAt) VALUES ('设备核对', '现场登记', ?, ?, NOW())", detail, in.Hostname)

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	out.OK = true
	for _, it := range out.Items {
		if it.Action == "冲突" || it.Action == "未找到" || it.Action == "使用中" {
			out.OK = false
		}
	}
	return out, nil
}

type categoryRow struct {
	id     int64
	name   string
	code   string
	unique bool
}

// ────────────── 接口模式（server= 时启用；数据库密码不出服务器） ──────────────

type apiPayload struct {
	Department struct {
		Name   string `json:"name"`
		Action string `json:"action"`
	} `json:"department"`
	Employee struct {
		Name       string  `json:"name"`
		EmployeeNo string  `json:"employeeNo"`
		Action     string  `json:"action"`
		Note       *string `json:"note"`
	} `json:"employee"`
	Devices []struct {
		Kind    string  `json:"kind"`
		Action  string  `json:"action"`
		AssetNo *string `json:"assetNo"`
		Model   *string `json:"model"`
		Holder  *string `json:"holder"`
		Message string  `json:"message"`
	} `json:"devices"`
}

func apiActionCN(s string) string {
	switch s {
	case "CREATED":
		return "新建"
	case "EXISTS":
		return "已存在"
	case "CONFLICT":
		return "冲突"
	case "WRITTEN":
		return "已写入"
	case "NOT_FOUND":
		return "未找到"
	case "IN_USE":
		return "使用中"
	default:
		return s
	}
}

func apiRegister(cfg *appConfig, in registerInput) (*registerOutput, error) {
	payload := map[string]any{
		"hostname":     in.Hostname,
		"department":   in.Department,
		"employeeName": in.EmployeeName,
		"hostAssetNo":  in.HostAssetNo,
		"host": map[string]any{
			"model": in.HostModel, "serial": in.HostSerial, "brand": in.HostBrand,
			"isLaptop": in.IsLaptop, "notes": in.Notes,
		},
	}
	if in.Monitor != nil {
		payload["monitor"] = map[string]any{
			"model": in.Monitor.Model, "serial": in.Monitor.Serial,
			"brand": in.Monitor.Maker, "notes": in.monitorNotes(),
		}
		payload["monitorAssetNo"] = in.MonAssetNo
	}
	buf, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", cfg.Server+"/api/device-register", bytes.NewReader(buf))
	if err != nil {
		return nil, wrap("构造请求失败", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.Token != "" {
		req.Header.Set("x-device-token", cfg.Token)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, wrap("连接服务器失败", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, wrap("读取响应失败", err)
	}
	if resp.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(data, &e) == nil && e.Error != "" {
			return nil, fmt.Errorf("服务器返回错误: %s", e.Error)
		}
		return nil, fmt.Errorf("服务器返回状态码 %d", resp.StatusCode)
	}
	var p apiPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, wrap("解析服务器响应失败", err)
	}
	out := &registerOutput{
		DeptName: p.Department.Name, DeptAction: apiActionCN(p.Department.Action),
		EmpName: p.Employee.Name, EmpNo: p.Employee.EmployeeNo, EmpAction: apiActionCN(p.Employee.Action),
		OK: true,
	}
	if p.Employee.Note != nil {
		out.EmpNote = *p.Employee.Note
	}
	for _, d := range p.Devices {
		kind := "主机"
		if d.Kind == "monitor" {
			kind = "显示器"
		}
		item := itemResult{
			Kind: kind, Action: apiActionCN(d.Action),
			AssetNo: derefStr(d.AssetNo), Model: derefStr(d.Model), Message: d.Message,
		}
		if d.Action == "CONFLICT" || d.Action == "NOT_FOUND" || d.Action == "IN_USE" {
			out.OK = false
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func ensureCategory(q queryer, name string) (*categoryRow, error) {
	row := &categoryRow{name: name}
	err := q.QueryRow("SELECT id, code, is_unique FROM AssetCategory WHERE name = ?", name).
		Scan(&row.id, &row.code, &row.unique)
	if err == nil {
		return row, nil
	}
	if err != sql.ErrNoRows {
		return nil, wrap("查询分类失败", err)
	}
	base, ok := fallbackCodes[name]
	if !ok {
		r := []rune(name)
		base = strings.ToUpper(string(r[0]) + string(r[len(r)-1]))
	}
	code := base
	for i := 2; i < 100; i++ {
		var dummy int64
		err := q.QueryRow("SELECT id FROM AssetCategory WHERE code = ?", code).Scan(&dummy)
		if err == sql.ErrNoRows {
			break
		}
		if err != nil {
			return nil, wrap("查询分类编码失败", err)
		}
		code = fmt.Sprintf("%s%d", base, i)
	}
	unique := 1
	if name == "显示器" {
		unique = 0
	}
	// 新建分类默认 6 位随机编号规则（与网页端一致；否则显示器会退化为顺序号 XS-0001）
	res, err := q.Exec(
		"INSERT INTO AssetCategory (name, code, is_unique, numberingRule, createdAt, updatedAt) VALUES (?, ?, ?, '{prefix}-{R6}', NOW(), NOW())",
		name, code, unique)
	if err != nil {
		return nil, wrap("创建分类失败", err)
	}
	row.id, _ = res.LastInsertId()
	row.code = code
	row.unique = unique == 1
	return row, nil
}

func ensureDirectTemplate(q queryer, categoryID int64) (idRow, error) {
	var id int64
	err := q.QueryRow("SELECT id FROM DeviceTemplate WHERE categoryId = ? AND name = ?", categoryID, DIRECT_TEMPLATE_NAME).Scan(&id)
	if err == nil {
		return idRow{id}, nil
	}
	if err != sql.ErrNoRows {
		return idRow{}, wrap("查询直录模板失败", err)
	}
	res, err := q.Exec("INSERT INTO DeviceTemplate (name, categoryId, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
		DIRECT_TEMPLATE_NAME, categoryID)
	if err != nil {
		return idRow{}, wrap("创建直录模板失败", err)
	}
	id, _ = res.LastInsertId()
	return idRow{id}, nil
}

type idRow struct{ id int64 }

func nextEmployeeNo(q queryer) (string, error) {
	rows, err := q.Query("SELECT employeeNo FROM Employee WHERE employeeNo LIKE ?", EMPLOYEE_NO_PREFIX+"%")
	if err != nil {
		return "", wrap("查询工号失败", err)
	}
	defer rows.Close()
	max := 0
	for rows.Next() {
		var no string
		if err := rows.Scan(&no); err == nil && strings.HasPrefix(no, EMPLOYEE_NO_PREFIX) {
			if n, e := strconv.Atoi(no[len(EMPLOYEE_NO_PREFIX):]); e == nil && n > max {
				max = n
			}
		}
	}
	return fmt.Sprintf("%s%04d", EMPLOYEE_NO_PREFIX, max+1), nil
}

type registerOneArgs struct {
	kind       string
	empID      int64
	empName    string
	model      string
	serial     string
	brand      string
	cat        *categoryRow
	tplID      int64
	notes      string
	existingNo string // 非空 = 已有设备编号，写入该记录而非新建
}

func registerOne(q queryer, a registerOneArgs) (*itemResult, error) {
	// 已有编号：把现场检测到的配置写入该台账记录（不新建、不查重）
	if a.existingNo != "" {
		return writeIntoExisting(q, a)
	}

	res := &itemResult{Kind: a.kind, Model: a.model}

	// 序列号已登记过 → 返回既有台账 + 型号核对结论
	if a.serial != "" {
		var assetNo, model sql.NullString
		var holder, catName sql.NullString
		err := q.QueryRow(`
			SELECT a.assetNo, a.model, e.name, c.name
			FROM Asset a
			LEFT JOIN Employee e ON a.employeeId = e.id
			JOIN DeviceTemplate t ON a.templateId = t.id
			JOIN AssetCategory c ON t.categoryId = c.id
			WHERE a.serialNo = ? LIMIT 1`, a.serial).Scan(&assetNo, &model, &holder, &catName)
		if err == nil {
			res.Action = "已存在"
			res.AssetNo = assetNo.String
			if modelMatches(model.String, a.model) {
				res.Message = fmt.Sprintf("序列号已登记（%s，%s），型号一致，未重复建档", catName.String, holder.String)
			} else {
				res.Message = fmt.Sprintf("序列号已登记（%s，%s），但型号不一致：台账 %s", catName.String, holder.String, model.String)
			}
			return res, nil
		}
		if err != sql.ErrNoRows {
			return nil, wrap("序列号查重失败", err)
		}
	}

	// R4 唯一分类：同一员工至多 1 台
	if a.cat.unique {
		var assetNo, model sql.NullString
		err := q.QueryRow(`
			SELECT a.assetNo, a.model
			FROM Asset a
			JOIN DeviceTemplate t ON a.templateId = t.id
			WHERE a.employeeId = ? AND t.categoryId = ? AND a.status IN ('IDLE','IN_USE','IN_MAINTENANCE')
			LIMIT 1`, a.empID, a.cat.id).Scan(&assetNo, &model)
		if err == nil {
			res.Action = "冲突"
			res.AssetNo = assetNo.String
			res.Message = fmt.Sprintf("该员工在「%s」分类下已有 %s，且该分类每人限 1 台", a.cat.name, assetNo.String)
			return res, nil
		}
		if err != sql.ErrNoRows {
			return nil, wrap("唯一性校验失败", err)
		}
	}

	// 无序列号：同人 + 同分类 + 同型号视为同一台
	if a.serial == "" {
		rows, err := q.Query(`
			SELECT a.assetNo, a.model
			FROM Asset a
			JOIN DeviceTemplate t ON a.templateId = t.id
			WHERE a.employeeId = ? AND t.categoryId = ? AND a.model IS NOT NULL
			  AND a.status IN ('IDLE','IN_USE','IN_MAINTENANCE')`, a.empID, a.cat.id)
		if err != nil {
			return nil, wrap("同型号查重失败", err)
		}
		found := false
		for rows.Next() {
			var assetNo, model sql.NullString
			if err := rows.Scan(&assetNo, &model); err == nil && modelMatches(model.String, a.model) {
				res.Action = "已存在"
				res.AssetNo = assetNo.String
				res.Message = fmt.Sprintf("名下已有同型号%s（%s），未重复建档", a.cat.name, assetNo.String)
				found = true
				break
			}
		}
		rows.Close()
		if found {
			return res, nil
		}
	}

	// 建档：编号走分类编号规则，名字与网页端「新建即分配」一致
	assetNo, err := generateAssetNo(q, a.cat.code, a.cat.numberingRule(q))
	if err != nil {
		return nil, err
	}
	name := fmt.Sprintf("%s的%s", a.empName, a.cat.name)
	notes := a.notes
	if notes == "" {
		notes = fmt.Sprintf("现场登记（%s）", hostname())
	} else {
		notes = fmt.Sprintf("现场登记（%s）\n%s", hostname(), notes)
	}
	if _, err := q.Exec(`
		INSERT INTO Asset (assetNo, name, templateId, status, employeeId, brand, model, serialNo, notes, createdAt, updatedAt)
		VALUES (?, ?, ?, 'IN_USE', ?, ?, ?, ?, ?, NOW(), NOW())`,
		assetNo, name, a.tplID, a.empID, nullIfEmpty(a.brand), a.model, nullIfEmpty(a.serial), notes); err != nil {
		return nil, wrap("写入设备失败", err)
	}
	res.Action = "新建"
	res.AssetNo = assetNo
	res.Message = fmt.Sprintf("已建档并分配给 %s", a.empName)
	return res, nil
}

// writeIntoExisting 把现场检测到的配置写入已有编号的台账记录（不新建）
func writeIntoExisting(q queryer, a registerOneArgs) (*itemResult, error) {
	res := &itemResult{Kind: a.kind, Model: a.model}

	var id int64
	var assetNo, curModel, curSerial sql.NullString
	var holder sql.NullString
	var curEmpID sql.NullInt64
	err := q.QueryRow(`
		SELECT a.id, a.assetNo, a.model, a.serialNo, e.name, a.employeeId
		FROM Asset a
		LEFT JOIN Employee e ON a.employeeId = e.id
		WHERE a.assetNo = ? AND a.status IN ('IDLE','IN_USE','IN_MAINTENANCE')
		LIMIT 1`, a.existingNo).Scan(&id, &assetNo, &curModel, &curSerial, &holder, &curEmpID)
	if err == sql.ErrNoRows {
		res.Action = "未找到"
		res.Message = fmt.Sprintf("编号 %s 在台账中不存在（或已报废/已归还），请核对", a.existingNo)
		return res, nil
	}
	if err != nil {
		return nil, wrap("查询已有设备失败", err)
	}
	res.AssetNo = assetNo.String

	// ⚠️ 该编号已分配给别人 → 拦截写入，防止把配置写进别人的设备
	if curEmpID.Valid && curEmpID.Int64 != a.empID {
		res.Action = "使用中"
		res.Message = fmt.Sprintf("该编号已在使用中（持有人：%s），不能写入配置；请先在系统里归还/退库，或核实编号", holder.String)
		return res, nil
	}

	// 分类核对：编号填错位置（如把显示器编号填进主机栏）给出提醒
	var catName string
	_ = q.QueryRow(`
		SELECT c.name FROM Asset a
		JOIN DeviceTemplate t ON a.templateId = t.id
		JOIN AssetCategory c ON t.categoryId = c.id
		WHERE a.id = ?`, id).Scan(&catName)

	notes := a.notes
	if notes == "" {
		notes = fmt.Sprintf("现场登记（%s）", hostname())
	} else {
		notes = fmt.Sprintf("现场登记（%s）\n%s", hostname(), notes)
	}
	// 型号以现场检测为准；序列号只在现场采到时覆盖；品牌留空不覆盖
	if _, err := q.Exec(`
		UPDATE Asset
		SET model = ?, serialNo = COALESCE(NULLIF(?, ''), serialNo),
		    brand = COALESCE(NULLIF(?, ''), brand), notes = ?, updatedAt = NOW()
		WHERE id = ?`, a.model, a.serial, a.brand, notes, id); err != nil {
		return nil, wrap("写入配置失败", err)
	}
	res.Action = "已写入"
	res.Message = fmt.Sprintf("配置已写入 %s（原型号: %s）", assetNo.String, curModel.String)
	if catName != "" && catName != a.cat.name {
		res.Message += fmt.Sprintf("；注意：该编号在台账中属于「%s」分类", catName)
	}
	if curSerial.Valid && curSerial.String != "" && a.serial != "" && curSerial.String != a.serial {
		res.Message += fmt.Sprintf("；序列号不一致（台账 %s / 现场 %s），已按现场更新", curSerial.String, a.serial)
	}
	// 尚未分配给任何人 → 顺手分配给本次登记的员工
	if !curEmpID.Valid {
		if _, err := q.Exec(
			"UPDATE Asset SET employeeId = ?, status = 'IN_USE', updatedAt = NOW() WHERE id = ?",
			a.empID, id); err == nil {
			res.Message += fmt.Sprintf("，并分配给 %s", a.empName)
		}
	}
	return res, nil
}

// numberingRule 读分类的编号规则（如 "{prefix}-{R6}"），空则用默认
func (c *categoryRow) numberingRule(q queryer) string {
	var rule sql.NullString
	_ = q.QueryRow("SELECT numberingRule FROM AssetCategory WHERE id = ?", c.id).Scan(&rule)
	return rule.String
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// generateAssetNo 移植自 src/lib/asset-numbering.ts（{prefix} {YYYY} {MM} {DD} {####} {Rn}）
func generateAssetNo(q queryer, prefix, rule string) (string, error) {
	if rule == "" {
		rule = "{prefix}-{####}"
	}
	now := time.Now()
	result := strings.NewReplacer(
		"{prefix}", prefix,
		"{YYYY}", now.Format("2006"),
		"{MM}", now.Format("01"),
		"{DD}", now.Format("02"),
	).Replace(rule)

	// 随机字符 {Rn}
	if m := regexp.MustCompile(`\{R(\d+)\}`).FindStringSubmatch(result); m != nil {
		n, _ := strconv.Atoi(m[1])
		chars := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
		for attempt := 0; attempt < 10; attempt++ {
			var b strings.Builder
			for i := 0; i < n; i++ {
				b.WriteByte(chars[rand.Intn(len(chars))])
			}
			candidate := strings.Replace(result, m[0], b.String(), 1)
			var dummy int64
			err := q.QueryRow("SELECT id FROM Asset WHERE assetNo = ?", candidate).Scan(&dummy)
			if err == sql.ErrNoRows {
				return candidate, nil
			}
			if err != nil {
				return "", wrap("生成设备编号失败", err)
			}
		}
		return result, nil
	}

	// 自增序号 {####}
	if m := regexp.MustCompile(`\{(#+)\}`).FindStringSubmatch(result); m != nil {
		placeholder := m[0]
		digits := len(m[1])
		prefixBefore := strings.Split(result, placeholder)[0]

		var last sql.NullString
		err := q.QueryRow(
			"SELECT assetNo FROM Asset WHERE assetNo LIKE ? ORDER BY assetNo DESC LIMIT 1",
			strings.ReplaceAll(prefixBefore, "%", "\\%")+"%").Scan(&last)
		next := 1
		if err == nil && last.Valid {
			re := regexp.MustCompile("^" + regexp.QuoteMeta(prefixBefore) + `(\d+)$`)
			if mm := re.FindStringSubmatch(last.String); mm != nil {
				if n, e := strconv.Atoi(mm[1]); e == nil {
					next = n + 1
				}
			}
		} else if err != nil && err != sql.ErrNoRows {
			return "", wrap("生成设备编号失败", err)
		}
		return strings.Replace(result, placeholder, fmt.Sprintf("%0*d", digits, next), 1), nil
	}
	return result, nil
}

func wrap(what string, err error) error {
	return fmt.Errorf("%s: %w", what, err)
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "未知主机"
	}
	return h
}

// ────────────── GUI ──────────────

type mainWindow struct {
	*walk.MainWindow
	infoText       *walk.TextEdit
	outText        *walk.TextEdit
	deptEdit       *walk.LineEdit
	nameEdit       *walk.LineEdit
	modelEdit      *walk.LineEdit
	hostNoEdit     *walk.LineEdit
	monCombo       *walk.ComboBox
	monNoEdit      *walk.LineEdit
	statusLabel    *walk.Label
	regBtn         *walk.PushButton
	testBtn        *walk.PushButton
	copyBtn        *walk.PushButton
	hostPhotoBtn   *walk.PushButton // 选主机照片
	monPhotoBtn    *walk.PushButton // 选显示器照片
	uploadPhotoBtn *walk.PushButton // 仅上传照片（不重新登记）
	hostPhotoView  *walk.ImageView
	monPhotoView   *walk.ImageView
	hostPhotoLabel *walk.Label
	monPhotoLabel  *walk.Label
	hostPhotoBmp   *walk.Bitmap
	monPhotoBmp    *walk.Bitmap

	hw              *hwInfo
	detErr          error
	lastCodes       string // 最近一次登记成功的设备编号（供「复制编号」）
	lastHostAssetNo string // 最近登记成功的主机编号（供照片挂载）
	lastMonAssetNo  string // 最近登记成功的显示器编号（供照片挂载）
	hostPhotoPath   string // 已选待传的主机照片（和登记一起提交）
	monPhotoPath    string // 已选待传的显示器照片
	photoBusy       bool   // 照片上传进行中（防止并发重复提交）
	monItems        []monitorInfo
	cfg             *appConfig
}

func runGUI(cfg *appConfig) {
	mw := &mainWindow{cfg: cfg}
	const labelW = 84

	connDesc := "接口模式: " + cfg.Server
	if !cfg.apiMode() {
		connDesc = fmt.Sprintf("数据库: %s:%s/%s", cfg.Host, cfg.Port, cfg.DBName)
	}

	MainWindow{
		AssignTo: &mw.MainWindow,
		Title:    "现场设备登记",
		MinSize:  Size{Width: 620, Height: 760},
		Size:     Size{Width: 660, Height: 920},
		Font:     Font{Family: "Microsoft YaHei UI", PointSize: 10},
		Layout:   VBox{Margins: Margins{Left: 16, Top: 12, Right: 16, Bottom: 12}, Spacing: 8},
		Children: []Widget{
			GroupBox{Title: "本机配置（自动采集）", Layout: VBox{
				Margins: Margins{Left: 10, Top: 6, Right: 10, Bottom: 8},
			}, Children: []Widget{
				// MinSize 保底约 9 行：配置区不能被其他区域挤压到只剩两三行
				TextEdit{AssignTo: &mw.infoText, ReadOnly: true, MinSize: Size{Height: 165}, MaxSize: Size{Height: 220}},
			}},
			// 操作提示放在输入框上方，员工填表前就能看到连接状态和操作反馈
			Label{AssignTo: &mw.statusLabel, Text: connDesc},
			GroupBox{Title: "登记信息", Layout: VBox{
				Margins: Margins{Left: 10, Top: 6, Right: 10, Bottom: 8}, Spacing: 6,
			}, Children: []Widget{
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "部门:", MinSize: Size{Width: labelW}},
					LineEdit{AssignTo: &mw.deptEdit, CueBanner: "如 技术部（没有会自动创建）"},
				}},
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "员工姓名:", MinSize: Size{Width: labelW}},
					LineEdit{AssignTo: &mw.nameEdit, CueBanner: "如 张三（没有会自动创建）"},
				}},
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "主机型号:", MinSize: Size{Width: labelW}},
					LineEdit{AssignTo: &mw.modelEdit, CueBanner: "主板/CPU 自动组合，可手改"},
				}},
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "主机编号:", MinSize: Size{Width: labelW}},
					LineEdit{AssignTo: &mw.hostNoEdit, CueBanner: "已有设备填编号，如 DN-0123（留空 = 新建）"},
				}},
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "显示器:", MinSize: Size{Width: labelW}},
					ComboBox{AssignTo: &mw.monCombo},
				}},
				Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
					Label{Text: "显示器编号:", MinSize: Size{Width: labelW}},
					LineEdit{AssignTo: &mw.monNoEdit, CueBanner: "已有显示器填编号（留空 = 新建）"},
				}},
			}},
			Composite{Layout: HBox{MarginsZero: true, Spacing: 10}, Children: []Widget{
				PushButton{AssignTo: &mw.regBtn, Text: "登记入库", MinSize: Size{Width: 130, Height: 34}, OnClicked: mw.onRegister},
				PushButton{AssignTo: &mw.testBtn, Text: "测试连接", MinSize: Size{Height: 34}, OnClicked: mw.onTestDB},
				PushButton{AssignTo: &mw.copyBtn, Text: "复制编号", MinSize: Size{Height: 34}, OnClicked: mw.onCopyCodes},
				HSpacer{},
			}},
			// 照片走服务器转存 OSS，直连数据库模式没有这个通道，只在接口模式显示。
			// 流程：先选好照片 → 点「登记入库」自动一起提交；已有设备（填编号）照片挂到原设备；
			// 不想重新登记就点「仅上传照片」。
			Composite{Layout: VBox{MarginsZero: true, Spacing: 6}, Visible: cfg.apiMode(), Children: []Widget{
				Composite{Layout: HBox{MarginsZero: true, Spacing: 10}, Children: []Widget{
					PushButton{AssignTo: &mw.hostPhotoBtn, Text: "选主机照片", MinSize: Size{Height: 34}, OnClicked: func() { mw.onPickPhoto("host") }},
					PushButton{AssignTo: &mw.monPhotoBtn, Text: "选显示器照片", MinSize: Size{Height: 34}, OnClicked: func() { mw.onPickPhoto("monitor") }},
					PushButton{AssignTo: &mw.uploadPhotoBtn, Text: "仅上传照片", MinSize: Size{Height: 34}, OnClicked: mw.onUploadPendingPhotos},
				}},
				Composite{Layout: HBox{MarginsZero: true, Spacing: 16}, Children: []Widget{
					Composite{Layout: VBox{MarginsZero: true, Spacing: 2}, Children: []Widget{
						ImageView{AssignTo: &mw.hostPhotoView, Mode: ImageViewModeZoom, MinSize: Size{Width: 150, Height: 100}},
						Label{AssignTo: &mw.hostPhotoLabel, Text: "主机照片未选", TextColor: walk.RGB(120, 120, 120)},
					}},
					Composite{Layout: VBox{MarginsZero: true, Spacing: 2}, Children: []Widget{
						ImageView{AssignTo: &mw.monPhotoView, Mode: ImageViewModeZoom, MinSize: Size{Width: 150, Height: 100}},
						Label{AssignTo: &mw.monPhotoLabel, Text: "显示器照片未选", TextColor: walk.RGB(120, 120, 120)},
					}},
					Composite{Layout: VBox{MarginsZero: true, Spacing: 2}, Children: []Widget{
						Label{Text: "选好照片点「登记入库」一起提交；", TextColor: walk.RGB(120, 120, 120)},
						Label{Text: "已有设备（填编号再登记）会挂到原设备；", TextColor: walk.RGB(120, 120, 120)},
						Label{Text: "不重新登记就点「仅上传照片」。", TextColor: walk.RGB(120, 120, 120)},
						Label{Text: "点缩略图可放大核对。", TextColor: walk.RGB(120, 120, 120)},
					}},
					HSpacer{},
				}},
			}},
			GroupBox{Title: "结果", Layout: VBox{
				Margins: Margins{Left: 10, Top: 6, Right: 10, Bottom: 8},
			}, Children: []Widget{
				TextEdit{AssignTo: &mw.outText, ReadOnly: true, VScroll: true, MinSize: Size{Height: 120}},
			}},
		},
	}.Create()

	// 预览缩略图可点击放大核对（webp 因系统解码不支持时不显示缩略图，仍可上传）
	mw.hostPhotoView.SetCursor(walk.CursorHand())
	mw.hostPhotoView.MouseDown().Attach(func(x, y int, button walk.MouseButton) {
		if button == walk.LeftButton {
			mw.showPhotoZoom(mw.hostPhotoBmp, "主机照片放大预览")
		}
	})
	mw.monPhotoView.SetCursor(walk.CursorHand())
	mw.monPhotoView.MouseDown().Attach(func(x, y int, button walk.MouseButton) {
		if button == walk.LeftButton {
			mw.showPhotoZoom(mw.monPhotoBmp, "显示器照片放大预览")
		}
	})

	mw.setOut("等待登记……\n")
	mw.setInfo("正在采集本机配置……")
	go mw.doDetect()
	mw.Run()
}

func (mw *mainWindow) doDetect() {
	h, err := detect()
	mw.Synchronize(func() {
		mw.hw, mw.detErr = h, err
		if err != nil {
			mw.setInfo("自动采集失败：" + err.Error() + "（仍可手动填写型号后登记）")
			mw.monCombo.SetModel([]string{"不登记显示器"})
			return
		}
		mw.setInfo(h.brief())
		// 主机型号 = 主板型号 / CPU 型号 的组合（可手改）
		hostModel := h.Model
		if cpu := cpuModelOnly(h.CPU); cpu != "" {
			if hostModel != "" {
				hostModel += " / "
			}
			hostModel += cpu
		}
		mw.modelEdit.SetText(hostModel)
		mw.monItems = append([]monitorInfo{}, h.Monitors...)
		items := []string{"不登记显示器"}
		for i, m := range h.Monitors {
			label := m.Model
			if m.Maker != "" && !strings.HasPrefix(m.Model, m.Maker) {
				label = m.Maker + " " + label
			}
			items = append(items, fmt.Sprintf("%d: %s", i+1, label))
		}
		mw.monCombo.SetModel(items)
		if len(h.Monitors) == 1 {
			mw.monCombo.SetCurrentIndex(1) // 仅 1 台时默认登记
		}
	})
}

func (mw *mainWindow) onTestDB() {
	mw.testBtn.SetEnabled(false)
	mw.statusLabel.SetText("正在测试连接……")
	go func() {
		var err error
		desc := ""
		if mw.cfg.apiMode() {
			// 接口模式：对服务器发一次 GET，能收到响应即视为可达
			client := &http.Client{Timeout: 8 * time.Second}
			var resp *http.Response
			resp, err = client.Get(mw.cfg.Server + "/login")
			if resp != nil {
				resp.Body.Close()
				desc = fmt.Sprintf("（HTTP %d）", resp.StatusCode)
			}
		} else {
			var db *sql.DB
			db, err = sql.Open("mysql", mw.cfg.dsn())
			if err == nil {
				err = db.Ping()
				db.Close()
			}
		}
		mw.Synchronize(func() {
			mw.testBtn.SetEnabled(true)
			if err != nil {
				mw.statusLabel.SetText("✗ 连接失败: " + shortErr(err))
			} else if mw.cfg.apiMode() {
				mw.statusLabel.SetText("✓ 服务器可达 " + desc)
			} else {
				mw.statusLabel.SetText("✓ 数据库连接正常")
			}
		})
	}()
}

func (mw *mainWindow) onRegister() {
	dept := strings.TrimSpace(mw.deptEdit.Text())
	name := strings.TrimSpace(mw.nameEdit.Text())
	if dept == "" || name == "" {
		mw.setOut("部门与员工姓名均为必填。\n")
		return
	}
	if mw.hw == nil && mw.detErr == nil {
		mw.setOut("本机配置仍在采集中，请稍候 2 秒再点。\n")
		return
	}

	hostNo := strings.ToUpper(strings.TrimSpace(mw.hostNoEdit.Text()))
	monNo := strings.ToUpper(strings.TrimSpace(mw.monNoEdit.Text()))

	in := registerInput{
		Hostname:     hostname(),
		Department:   dept,
		EmployeeName: name,
		HostAssetNo:  hostNo,
		MonAssetNo:   monNo,
		Notes:        "",
	}
	hostSerial, hostBrand := "", ""
	isLaptop := false
	if mw.hw != nil {
		hostSerial, hostBrand = mw.hw.Serial, mw.hw.Brand
		isLaptop = mw.hw.Laptop
		in.Notes = mw.hw.summary()
	}
	hostModel := strings.TrimSpace(mw.modelEdit.Text())
	if hostModel == "" && hostNo == "" {
		mw.setOut("主板型号为空（自动采集失败且未手动填写，也未填已有编号），无法登记。\n")
		return
	}
	in.HostModel, in.HostSerial, in.HostBrand, in.IsLaptop = hostModel, hostSerial, hostBrand, isLaptop

	// 显示器下拉选择
	if idx := mw.monCombo.CurrentIndex(); idx > 0 && idx-1 < len(mw.monItems) {
		m := mw.monItems[idx-1]
		in.Monitor = &monitorInfo{Model: m.Model, Serial: m.Serial, Maker: m.Maker}
	}
	if monNo != "" && in.Monitor == nil {
		mw.setOut("已填显示器编号，但上方显示器选了「不登记显示器」——请先在下拉框选中那台显示器。\n")
		return
	}

	mw.regBtn.SetEnabled(false)
	mw.lastCodes = ""
	mw.setOut("正在写入台账……\n")
	go func() {
		var out *registerOutput
		var regErr error
		if mw.cfg.apiMode() {
			out, regErr = apiRegister(mw.cfg, in)
		} else {
			var db *sql.DB
			db, regErr = sql.Open("mysql", mw.cfg.dsn())
			if regErr == nil {
				regErr = db.Ping()
			}
			if regErr != nil {
				mw.Synchronize(func() {
					mw.regBtn.SetEnabled(true)
					mw.setOut("✗ 连接数据库失败：" + shortErr(regErr) +
						"\n\n请检查 device-tool.ini 里的 host/port/user/password/dbname，以及网络是否可达。\n")
				})
				return
			}
			defer db.Close()
			out, regErr = registerAll(db, in)
		}
		mw.Synchronize(func() {
			mw.regBtn.SetEnabled(true)
			if regErr != nil {
				mw.setOut("✗ 登记失败：" + shortErr(regErr) + "\n")
				return
			}
			var b strings.Builder
			b.WriteString("──────────── 登记结果 ────────────\n")
			fmt.Fprintf(&b, "  部门    %s    %s\n", out.DeptName, out.DeptAction)
			fmt.Fprintf(&b, "  员工    %s(%s)    %s\n", out.EmpName, out.EmpNo, out.EmpAction)
			if out.EmpNote != "" {
				fmt.Fprintf(&b, "          注: %s\n", out.EmpNote)
			}
			// 主机/显示器是两条独立台账、两个编号：突出显示方便员工记录
			var codes, plain strings.Builder
			for _, it := range out.Items {
				if it.AssetNo == "" {
					continue
				}
				fmt.Fprintf(&codes, "  ★ %s编号: %s （%s）\n", it.Kind, it.AssetNo, it.Action)
				fmt.Fprintf(&plain, "%s编号: %s\n", it.Kind, it.AssetNo)
			}
			if codes.Len() > 0 {
				b.WriteString("\n  ── 设备编号（请让员工记录，可点「复制编号」） ──\n")
				b.WriteString(codes.String())
			}
			b.WriteString("\n")
			for _, it := range out.Items {
				fmt.Fprintf(&b, "  %-4s %-12s %s    %s\n", it.Kind, it.AssetNo, it.Model, it.Action)
				fmt.Fprintf(&b, "        %s\n", it.Message)
			}
			b.WriteString("\n")
			if out.OK {
				b.WriteString("  ✔ 登记完成\n")
			} else {
				b.WriteString("  存在待处理项，请按上方说明处理\n")
			}
			mw.lastCodes = strings.TrimRight(plain.String(), "\n")
			// 照片分别挂主机/显示器：按 kind 记各自的编号
			mw.lastHostAssetNo, mw.lastMonAssetNo = "", ""
			for _, it := range out.Items {
				if it.AssetNo == "" {
					continue
				}
				if it.Kind == "显示器" {
					mw.lastMonAssetNo = it.AssetNo
				} else if mw.lastHostAssetNo == "" {
					mw.lastHostAssetNo = it.AssetNo
				}
			}
			if out.OK && mw.cfg.apiMode() {
				// 已选好的照片自动随登记挂到对应设备——照片和配置一次提交
				autoHost, autoMon := mw.lastHostAssetNo, mw.lastMonAssetNo
				mw.autoUploadPendingPhotos(autoHost, autoMon)
				if autoHost == "" && autoMon != "" {
					b.WriteString("  主机照片可点「选主机照片」后「仅上传照片」补挂\n")
				} else if autoMon == "" && autoHost != "" {
					b.WriteString("  显示器照片可点「选显示器照片」后「仅上传照片」补挂\n")
				}
			}
			mw.setOut(b.String())
		})
	}()
}

// setInfo/setOut Windows 编辑控件只认 CRLF 换行，纯 \n 会挤成一行
func (mw *mainWindow) setInfo(s string) { mw.infoText.SetText(crlf(s)) }

func (mw *mainWindow) setOut(s string) { mw.outText.SetText(crlf(s)) }

func crlf(s string) string { return strings.ReplaceAll(s, "\n", "\r\n") }

// showPhotoZoom 点击预览缩略图后弹出的大图窗口，图片按窗口缩放显示
func (mw *mainWindow) showPhotoZoom(bmp *walk.Bitmap, title string) {
	if bmp == nil {
		return
	}
	var dlgWalk *walk.Dialog
	w := int(win.GetSystemMetrics(win.SM_CXFULLSCREEN)) * 8 / 10
	h := int(win.GetSystemMetrics(win.SM_CYFULLSCREEN)) * 8 / 10
	if w < 480 {
		w = 480
	}
	if h < 360 {
		h = 360
	}
	dlg := Dialog{
		AssignTo: &dlgWalk,
		Title:    title + "（点「关闭」或窗口 × 返回）",
		MinSize:  Size{Width: w, Height: h},
		Layout:   VBox{Margins: Margins{Left: 10, Top: 10, Right: 10, Bottom: 10}},
		Children: []Widget{
			ImageView{Image: bmp, Mode: ImageViewModeZoom},
			Composite{Layout: HBox{MarginsZero: true}, Children: []Widget{
				HSpacer{},
				PushButton{Text: "关闭", OnClicked: func() { dlgWalk.Cancel() }},
			}},
		},
	}
	if err := dlg.Create(mw.MainWindow); err != nil {
		mw.setOut("放大预览失败：" + shortErr(err) + "\n")
		return
	}
	dlgWalk.Run()
}

// onCopyCodes 把最近登记成功的设备编号复制到剪贴板
func (mw *mainWindow) onCopyCodes() {
	if mw.lastCodes == "" {
		mw.statusLabel.SetText("还没有可复制的设备编号（先登记成功）")
		return
	}
	if err := walk.Clipboard().SetText(mw.lastCodes); err != nil {
		mw.statusLabel.SetText("复制失败: " + shortErr(err))
		return
	}
	mw.statusLabel.SetText("✓ 设备编号已复制到剪贴板")
}

// ────────────── 照片上传（仅接口模式；服务端转存 OSS 并挂到资产） ──────────────
//
// 流程：先点「选主机照片 / 选显示器照片」选好照片（带缩略图预览），
// 点「登记入库」后登记成功会自动把照片挂到对应设备——所以照片和配置是一次提交的；
// 编号框里填了已有设备编号再登记，照片就挂到原设备上（等于修改）；
// 不想重新登记时点「仅上传照片」补传。

// resolveAssetNo 照片要挂的设备编号：优先用最近一次登记成功的，其次用编号框里填的已有编号
func (mw *mainWindow) resolveAssetNo(kind string) string {
	if kind == "monitor" {
		if mw.lastMonAssetNo != "" {
			return mw.lastMonAssetNo
		}
		return strings.ToUpper(strings.TrimSpace(mw.monNoEdit.Text()))
	}
	if mw.lastHostAssetNo != "" {
		return mw.lastHostAssetNo
	}
	return strings.ToUpper(strings.TrimSpace(mw.hostNoEdit.Text()))
}

// onPickPhoto 选一张现场照片（只选不传），缩略图预览，等登记时一起提交或点「仅上传照片」
func (mw *mainWindow) onPickPhoto(kind string) {
	if !mw.cfg.apiMode() {
		return
	}
	if mw.photoBusy {
		mw.setOut("照片正在上传，请等当前上传结束再选。\n")
		return
	}
	kindCN := "主机"
	dlg := walk.FileDialog{
		Title:  "选择" + kindCN + "的现场照片",
		Filter: "图片文件 (*.jpg;*.jpeg;*.png;*.webp)|*.jpg;*.jpeg;*.png;*.webp",
	}
	if kind == "monitor" {
		kindCN = "显示器"
		dlg.Title = "选择" + kindCN + "的现场照片"
	}
	ok, err := dlg.ShowOpen(mw.MainWindow)
	if err != nil || !ok { // 用户取消
		return
	}
	path := dlg.FilePath
	if path == "" {
		return
	}
	// 选图时就校验大小，别等到登记后才发现传不了
	data, err := os.ReadFile(path)
	if err != nil {
		mw.setOut("✗ 读取照片失败：" + shortErr(err) + "\n")
		return
	}
	if len(data) > 5*1024*1024 {
		mw.setOut("✗ 照片超过 5MB，请压缩后再选。\n")
		return
	}
	// 缩略图预览（GDI+ 解码；webp 不支持时不显示，但不影响上传）
	bmp, bmpErr := walk.NewBitmapFromFile(path)
	name := filepath.Base(path)
	if kind == "host" {
		mw.hostPhotoPath = path
		if bmpErr == nil {
			if mw.hostPhotoBmp != nil {
				mw.hostPhotoBmp.Dispose()
			}
			mw.hostPhotoBmp = bmp
			mw.hostPhotoView.SetImage(bmp)
			mw.hostPhotoLabel.SetText("✓ 已选 " + name)
		} else {
			mw.hostPhotoLabel.SetText("✓ 已选 " + name + "（无缩略图）")
		}
	} else {
		mw.monPhotoPath = path
		if bmpErr == nil {
			if mw.monPhotoBmp != nil {
				mw.monPhotoBmp.Dispose()
			}
			mw.monPhotoBmp = bmp
			mw.monPhotoView.SetImage(bmp)
			mw.monPhotoLabel.SetText("✓ 已选 " + name)
		} else {
			mw.monPhotoLabel.SetText("✓ 已选 " + name + "（无缩略图）")
		}
	}
	mw.setOut("已选" + kindCN + "照片 " + name + "。点「登记入库」一起提交；不重新登记就点「仅上传照片」。\n")
}

// setPhotoBusy 上传期间锁住照片按钮，防并发重复提交
func (mw *mainWindow) setPhotoBusy(busy bool) {
	mw.hostPhotoBtn.SetEnabled(!busy)
	mw.monPhotoBtn.SetEnabled(!busy)
	mw.uploadPhotoBtn.SetEnabled(!busy)
}

// uploadOnePhoto 同步上传一张照片（在 goroutine 里调用），返回上传错误
func (mw *mainWindow) uploadOnePhoto(path, assetNo, kind string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("读取照片失败: %w", err)
	}
	return apiUploadPhoto(mw.cfg, assetNo, kind, filepath.Base(path), data)
}

// autoUploadPendingPhotos 登记成功后自动把已选照片挂到对应设备（照片和配置一次提交）。
// hostNo/monNo 是本次登记结果里的设备编号。
func (mw *mainWindow) autoUploadPendingPhotos(hostNo, monNo string) {
	hostPath, monPath := mw.hostPhotoPath, mw.monPhotoPath
	if hostPath == "" && monPath == "" {
		return
	}
	mw.setPhotoBusy(true)
	go func() {
		if hostPath != "" {
			if hostNo == "" {
				mw.Synchronize(func() { mw.outText.AppendText(crlf("⚠ 已选的主机照片没有可挂的编号，未上传。\n")) })
			} else {
				err := mw.uploadOnePhoto(hostPath, hostNo, "host")
				mw.Synchronize(func() {
					if err == nil {
						mw.hostPhotoPath = ""
						mw.hostPhotoLabel.SetText("✓ 已挂到 " + hostNo)
						mw.outText.AppendText(crlf("✓ 主机照片已随登记挂到 " + hostNo + "（网页端该设备详情页可查看）\n"))
					} else {
						mw.outText.AppendText(crlf("✗ 主机照片随登记上传失败：" + shortErr(err) + "（可点「仅上传照片」重试）\n"))
					}
				})
			}
		}
		// 显示器串行跟传：避免并发写同一资产 photos 竞态
		if monPath != "" {
			if monNo == "" {
				mw.Synchronize(func() {
					mw.outText.AppendText(crlf("⚠ 已选的显示器照片没有可挂的编号，未上传。\n"))
				})
			} else {
				err := mw.uploadOnePhoto(monPath, monNo, "monitor")
				mw.Synchronize(func() {
					if err == nil {
						mw.monPhotoPath = ""
						mw.monPhotoLabel.SetText("✓ 已挂到 " + monNo)
						mw.outText.AppendText(crlf("✓ 显示器照片已随登记挂到 " + monNo + "（网页端该设备详情页可查看）\n"))
					} else {
						mw.outText.AppendText(crlf("✗ 显示器照片随登记上传失败：" + shortErr(err) + "（可点「仅上传照片」重试）\n"))
					}
				})
			}
		}
		mw.Synchronize(func() { mw.setPhotoBusy(false) })
	}()
}

// onUploadPendingPhotos 「仅上传照片」：不重新登记，把已选照片挂到编号对应设备上
func (mw *mainWindow) onUploadPendingPhotos() {
	if !mw.cfg.apiMode() {
		return
	}
	if mw.photoBusy {
		mw.setOut("照片正在上传，请稍候。\n")
		return
	}
	hostPath, monPath := mw.hostPhotoPath, mw.monPhotoPath
	if hostPath == "" && monPath == "" {
		mw.setOut("先点「选主机照片 / 选显示器照片」选好照片。\n")
		return
	}
	hostNo, monNo := mw.resolveAssetNo("host"), mw.resolveAssetNo("monitor")
	if hostPath != "" && hostNo == "" {
		mw.setOut("主机照片没有可挂的编号——在「主机编号」框填已有编号，或先「登记入库」成功。\n")
		return
	}
	if monPath != "" && monNo == "" {
		mw.setOut("显示器照片没有可挂的编号——在「显示器编号」框填已有编号，或先「登记入库」成功。\n")
		return
	}
	mw.setPhotoBusy(true)
	go func() {
		if hostPath != "" {
			err := mw.uploadOnePhoto(hostPath, hostNo, "host")
			mw.Synchronize(func() {
				if err == nil {
					mw.hostPhotoPath = ""
					mw.hostPhotoLabel.SetText("✓ 已挂到 " + hostNo)
					mw.outText.AppendText(crlf("✓ 主机照片已挂到 " + hostNo + "（网页端该设备详情页可查看）\n"))
				} else {
					mw.outText.AppendText(crlf("✗ 主机照片上传失败：" + shortErr(err) + "\n"))
				}
			})
		}
		if monPath != "" {
			err := mw.uploadOnePhoto(monPath, monNo, "monitor")
			mw.Synchronize(func() {
				if err == nil {
					mw.monPhotoPath = ""
					mw.monPhotoLabel.SetText("✓ 已挂到 " + monNo)
					mw.outText.AppendText(crlf("✓ 显示器照片已挂到 " + monNo + "（网页端该设备详情页可查看）\n"))
				} else {
					mw.outText.AppendText(crlf("✗ 显示器照片上传失败：" + shortErr(err) + "\n"))
				}
			})
		}
		mw.Synchronize(func() { mw.setPhotoBusy(false) })
	}()
}

// photoMime 现场照片扩展名 → MIME（显式写入分部头，服务端按它存 OSS 元数据）
var photoMime = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
}

// apiUploadPhoto multipart 上传一张现场照片到 /api/device-register/photo
func apiUploadPhoto(cfg *appConfig, assetNo, kind, fileName string, data []byte) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	// 不能用 CreateFormFile：它固定发 application/octet-stream，服务端会拒收
	ext := strings.ToLower(filepath.Ext(fileName))
	ct := photoMime[ext]
	if ct == "" {
		ct = "application/octet-stream"
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, fileName))
	h.Set("Content-Type", ct)
	fw, err := w.CreatePart(h)
	if err != nil {
		return wrap("构造上传请求失败", err)
	}
	if _, err := fw.Write(data); err != nil {
		return wrap("写入照片数据失败", err)
	}
	_ = w.WriteField("assetNo", assetNo)
	_ = w.WriteField("kind", kind)
	_ = w.WriteField("hostname", hostname())
	if err := w.Close(); err != nil {
		return wrap("构造上传请求失败", err)
	}
	req, err := http.NewRequest("POST", cfg.Server+"/api/device-register/photo", &buf)
	if err != nil {
		return wrap("构造请求失败", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	if cfg.Token != "" {
		req.Header.Set("x-device-token", cfg.Token)
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return wrap("连接服务器失败", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return wrap("读取响应失败", err)
	}
	if resp.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return fmt.Errorf("%s", e.Error)
		}
		return fmt.Errorf("服务器返回状态码 %d", resp.StatusCode)
	}
	return nil
}

func shortErr(err error) string {
	s := err.Error()
	if len(s) > 160 {
		s = s[:160] + "…"
	}
	return s
}

// ────────────── 自测模式（无界面，供脚本验证） ──────────────

func runSelftest(cfg *appConfig) {
	fmt.Println("=== 设备登记自测（直连数据库） ===")
	fmt.Printf("目标库: %s:%s/%s\n", cfg.Host, cfg.Port, cfg.DBName)

	h, err := detect()
	if err != nil {
		fmt.Println("采集失败:", err)
		os.Exit(1)
	}
	fmt.Print("--- 窗口摘要展示效果 ---\n")
	fmt.Print(h.brief())
	fmt.Print("\n--- 完整配置（写入台账备注） ---\n")
	fmt.Print(h.summary())

	db, err := sql.Open("mysql", cfg.dsn())
	if err != nil {
		fmt.Println("打开数据库失败:", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fmt.Println("连接数据库失败:", err)
		os.Exit(1)
	}
	fmt.Println("✓ 数据库连接正常")

	stamp := time.Now().Unix()
	dept := fmt.Sprintf("自测部门%d", stamp%1000)
	name := fmt.Sprintf("自测员%d", stamp%1000)
	if *flagDept != "" {
		dept = *flagDept
	}
	if *flagName != "" {
		name = *flagName
	}
	in := registerInput{
		Hostname:     "SELFTEST",
		Department:   dept,
		EmployeeName: name,
		HostModel:    h.Model,
		HostSerial:   h.Serial,
		HostBrand:    h.Brand,
		IsLaptop:     h.Laptop,
		HostAssetNo:  *flagAssetNo,
		Notes:        h.summary(),
	}
	if len(h.Monitors) > 0 {
		in.Monitor = &monitorInfo{Model: h.Monitors[0].Model, Serial: h.Monitors[0].Serial, Maker: h.Monitors[0].Maker}
	}

	out, err := registerAll(db, in)
	if err != nil {
		fmt.Println("登记失败:", err)
		os.Exit(1)
	}
	fmt.Printf("部门 %s → %s\n", out.DeptName, out.DeptAction)
	fmt.Printf("员工 %s(%s) → %s\n", out.EmpName, out.EmpNo, out.EmpAction)
	for _, it := range out.Items {
		fmt.Printf("%s %s %s → %s | %s\n", it.Kind, it.AssetNo, it.Model, it.Action, it.Message)
	}
	fmt.Println("✓ 自测完成")
}

// ────────────── 入口 ──────────────

var stdinReader = bufio.NewReader(os.Stdin)

var (
	flagDept    *string
	flagName    *string
	flagAssetNo *string
)

func main() {
	cfg := loadConfig()
	printOnly := flag.Bool("print", false, "只采集并显示本机配置，不连接数据库")
	selftest := flag.Bool("selftest", false, "无界面自测：采集配置并登记一条测试数据")
	flagHost := flag.String("host", "", "数据库地址")
	flagPort := flag.String("port", "", "数据库端口")
	flagUser := flag.String("user", "", "数据库用户名")
	flagPass := flag.String("password", "", "数据库密码")
	flagDB := flag.String("dbname", "", "数据库名")
	flagDept = flag.String("dept", "", "自测模式：指定部门名（用于重复登记验证）")
	flagName = flag.String("name", "", "自测模式：指定员工姓名（用于重复登记验证）")
	flagAssetNo = flag.String("assetno", "", "自测模式：已有设备编号（验证按编号写入配置）")
	flag.Parse()
	if *flagHost != "" {
		cfg.Host = *flagHost
	}
	if *flagPort != "" {
		cfg.Port = *flagPort
	}
	if *flagUser != "" {
		cfg.User = *flagUser
	}
	if *flagPass != "" {
		cfg.Password = *flagPass
	}
	if *flagDB != "" {
		cfg.DBName = *flagDB
	}

	if *printOnly {
		h, err := detect()
		if err != nil {
			fmt.Println("采集失败:", err)
			os.Exit(1)
		}
		fmt.Print("--- 摘要（窗口展示） ---\n" + h.brief() + "\n\n--- 完整配置（写入台账备注） ---\n" + h.summary() + "\n")
		return
	}
	if *selftest {
		runSelftest(cfg)
		return
	}
	runGUI(cfg)
}
