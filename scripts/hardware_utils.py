# -*- coding: utf-8 -*-
"""
硬件扫描工具 - 纯逻辑模块（无外部依赖，可单测）

从 hardware_scanner.py 抽出的解析/推断逻辑：
- parse_memory_output: 解析 wmic memorychip 输出，按插槽去重（修复"2条变3条"）
- parse_memory_ps_output: 解析 PowerShell Get-CimInstance 输出（wmic 被移除的 Win11 24H2+ 备选）
- guess_disk_brand: 从硬盘型号推断品牌（扩充关键词表）
- map_monitor_brand: 显示器厂商码 -> 品牌全名
"""

import re

# ============================================================
# 内存解析
# ============================================================

# 常见内存品牌（用于识别 Manufacturer 中的杂散值）
_MEMORY_UNKNOWN_BRANDS = {"", "0", "0000", "Not Specified", "Unknown", "unknown"}


def _parse_memory_block(block_lines):
    """解析单个内存条块（wmic /value 的一个对象），返回 dict"""
    mod = {}
    for line in block_lines:
        line = line.strip()
        if line.startswith("DeviceLocator="):
            mod["locator"] = line.replace("DeviceLocator=", "").strip()
        elif line.startswith("Capacity="):
            val = line.replace("Capacity=", "").strip()
            if val.isdigit():
                mod["capacity"] = int(val)
        elif line.startswith("Speed="):
            val = line.replace("Speed=", "").strip()
            if val.isdigit():
                mod["speed"] = val
        elif line.startswith("Manufacturer="):
            mod["brand"] = line.replace("Manufacturer=", "").strip()
    return mod


def parse_memory_output(output):
    """解析 wmic memorychip /value 输出，返回去重后的内存条列表。

    wmic 输出格式：每个属性一行，对象之间空行分隔。

    去重策略（修复"物理2根报3条"问题）：
    1. 过滤容量 <= 0 的无效记录（空插槽/虚拟设备）
    2. 按插槽(DeviceLocator)去重：同一插槽只保留一条
    3. 无插槽信息时，保守保留全部（宁多勿漏，避免"2条变1条"），
       仅丢弃"无品牌+同容量+同速度"的完全重复裸报告
    """
    blocks = []
    current = []
    for line in output.split("\n"):
        line = line.strip()
        if not line:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)

    modules = [_parse_memory_block(b) for b in blocks]

    # 1. 过滤无效记录（必须有有效容量）
    valid = [m for m in modules if m.get("capacity", 0) > 0]
    if not valid:
        return []

    # 2. 按插槽去重（保留第一条）
    seen_locators = set()
    deduped = []
    for mod in valid:
        loc = mod.get("locator", "")
        if loc and loc in seen_locators:
            continue
        if loc:
            seen_locators.add(loc)
        deduped.append(mod)

    # 3. 无插槽信息时：保守策略，保留全部（宁可多报不漏报）。
    #    不按规格合并！真实两条同规格内存不能被合并成一条（会导致"检测不到"）。
    #    仅过滤掉"完全相同的重复报告"（同容量+同速度+品牌为空+无插槽，无法区分且无信息价值）。
    if not any(m.get("locator") for m in deduped):
        kept = []
        seen_bare = set()
        for mod in deduped:
            bare_key = (mod.get("capacity"), mod.get("speed"))
            if not mod.get("brand") and bare_key in seen_bare:
                continue  # 完全相同的裸报告重复，丢弃
            seen_bare.add(bare_key)
            kept.append(mod)
        deduped = kept

    # 输出格式化
    result = []
    for mod in deduped:
        capacity_gb = mod.get("capacity", 0) // (1024 ** 3)
        speed = mod.get("speed", "")
        brand = mod.get("brand", "")

        if brand in _MEMORY_UNKNOWN_BRANDS:
            brand = "未知"

        name = f"{capacity_gb}GB"
        if speed:
            name += f" DDR{speed}MHz"

        result.append({
            "category": "内存",
            "name": name,
            "brand": brand,
            "locator": mod.get("locator", ""),
        })

    return result


def pick_memory_result(wmic_modules, ps_modules):
    """选择更可靠的内存检测结果（wmic 与 PowerShell 互补）。

    决策规则：
    1. wmic 有插槽信息 → 用 wmic（去重可靠）
    2. wmic 无插槽信息（无法可靠去重）→ 用 PS 结果（PS 的 DeviceLocator 通常可靠）
    3. PS 为空 → 退回 wmic 保守结果（宁多勿漏）
    """
    if any(m.get("locator") for m in wmic_modules):
        return wmic_modules
    if ps_modules:
        return ps_modules
    return wmic_modules


def parse_memory_ps_output(output):
    """解析 PowerShell Get-CimInstance Win32_PhysicalMemory 输出。

    输出格式（每根内存一行，| 分隔）：
      DeviceLocator|Capacity(bytes)|Speed|Manufacturer
      例：Bank0|8589934592|3200|Kingston

    返回与 parse_memory_output 相同结构的列表。
    """
    modules = []
    for line in output.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 3:
            continue
        locator = parts[0].strip()
        capacity_str = parts[1].strip()
        speed = parts[2].strip()
        brand = parts[3].strip() if len(parts) > 3 else ""

        if not capacity_str.isdigit():
            continue
        capacity = int(capacity_str)
        if capacity <= 0:
            continue  # 空插槽

        modules.append({
            "category": "内存",
            "locator": locator,
            "capacity": capacity,
            "speed": speed,
            "brand": brand,
        })

    if not modules:
        return []

    # 按插槽去重（PowerShell 的 DeviceLocator 通常可靠）
    seen_locators = set()
    deduped = []
    for mod in modules:
        loc = mod.get("locator", "")
        if loc and loc in seen_locators:
            continue
        if loc:
            seen_locators.add(loc)
        deduped.append(mod)

    # 输出格式化
    result = []
    for mod in deduped:
        capacity_gb = mod.get("capacity", 0) // (1024 ** 3)
        speed = mod.get("speed", "")
        brand = mod.get("brand", "")

        if brand in _MEMORY_UNKNOWN_BRANDS:
            brand = "未知"

        name = f"{capacity_gb}GB"
        if speed:
            name += f" DDR{speed}MHz"

        result.append({
            "category": "内存",
            "name": name,
            "brand": brand,
            "locator": mod.get("locator", ""),
        })

    return result


# ============================================================
# 硬盘品牌推断
# ============================================================

# 硬盘品牌关键词表（按优先级排列）
# 短前缀（如 st/ct）用正则 "^前缀\d" 限定开头，避免误伤品牌全名（如 Kingston 含 "st"）
_DISK_BRAND_RULES = [
    ("samsung", "Samsung"),
    ("wdc", "Western Digital"),
    ("western digital", "Western Digital"),
    ("seagate", "Seagate"),
    ("intel", "Intel"),
    ("crucial", "Micron"),
    ("micron", "Micron"),
    ("ct", "Micron"),           # 英睿达型号前缀，如 CT500MX500
    ("toshiba", "Toshiba"),
    ("kingston", "Kingston"),
    ("kioxia", "KIOXIA"),
    ("sandisk", "SanDisk"),
    ("wd", "Western Digital"),
    ("hgst", "HGST"),
    ("hitachi", "HGST"),
    ("hynix", "SK hynix"),
    ("adata", "ADATA"),
    ("dahua", "Dahua"),
    ("lexar", "Lexar"),
    ("maxsun", "Maxsun"),
    ("colorful", "Colorful"),
    ("yeston", "Yeston"),
]

# 短前缀规则：必须出现在型号开头 + 后跟数字，如 "ST2000DM001"
_DISK_BRAND_PREFIX_RE = [
    (r"^st\d", "Seagate"),    # 希捷型号前缀
    (r"^ct\d", "Micron"),     # 英睿达型号前缀
]


def guess_disk_brand(model):
    """从硬盘型号推断品牌"""
    model_lower = (model or "").lower()
    # 先匹配短前缀（希捷 ST 开头等）
    for pattern, brand in _DISK_BRAND_PREFIX_RE:
        if re.match(pattern, model_lower):
            return brand
    # 再匹配全名关键词
    for keyword, brand in _DISK_BRAND_RULES:
        if keyword in model_lower:
            return brand
    return "未知"


# ============================================================
# 显示器厂商码映射
# ============================================================

# EDID 三字母厂商码 -> 品牌全名（PNP ID）
_MONITOR_BRAND_MAP = {
    "DEL": "Dell",
    "SAM": "Samsung",
    "SAMSUNG": "Samsung",
    "PHL": "Philips",
    "ACR": "Acer",
    "AOC": "AOC",
    "LGD": "LG",
    "LG": "LG",
    "BNQ": "BenQ",
    "LEN": "Lenovo",
    "HWP": "HP",
    "HPN": "HP",
    "HEW": "HP",
    "VSC": "ViewSonic",
    "GSM": "LG",            # Goldstar
    "SNY": "Sony",
    "SON": "Sony",
    "SEC": "Samsung",
    "CMO": "ChiMei",
    "AUO": "AUO",
    "BOE": "BOE",
    "IVO": "Innolux",
    "HSD": "HannStar",
    "TCL": "TCL",
    "HAI": "Haier",
    "KDB": "KDB",
    "MEI": "Meizu",
    "XIA": "Xiaomi",
    "MSI": "MSI",
    "GIG": "GIGABYTE",
    "AUS": "ASUS",
    "ATC": "ATi",            # 兼容 ATI 显卡输出的显示器
    "MAX": "MAXSUN",
    "ONN": "ONN",
}


def map_monitor_brand(raw):
    """将 EDID 厂商码/原始厂商名映射为品牌全名"""
    if not raw:
        return ""
    code = raw.strip().upper()
    return _MONITOR_BRAND_MAP.get(code, "")


# ============================================================
# CPU / 主板 / 显卡 PowerShell 输出解析
# （wmic 偶发失败时的 fallback，PowerShell 输出用 | 分隔）
# ============================================================

def parse_cpu_ps_output(output):
    """解析 Get-CimInstance Win32_Processor 输出。

    格式：Name|Manufacturer
    例：Intel(R) Core(TM) i7-12700|Intel
    """
    for line in (output or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 1:
            continue
        name = parts[0].strip()
        brand = parts[1].strip() if len(parts) > 1 else ""
        if not name:
            continue

        name = re.sub(r"\s+", " ", name)
        name = name.replace("(R)", "").replace("(TM)", "").replace("  ", " ")

        if not brand:
            brand = "未知"

        return {"category": "CPU", "name": name, "brand": brand}

    return None


def parse_motherboard_ps_output(output):
    """解析 Get-CimInstance Win32_BaseBoard 输出。

    格式：Product|Manufacturer
    例：B660M|ASUS
    """
    for line in (output or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 1:
            continue
        name = parts[0].strip()
        brand = parts[1].strip() if len(parts) > 1 else ""
        if not name or name in ["Base Board", "Not Available"]:
            continue

        if not brand:
            brand = "未知"

        return {"category": "主板", "name": name, "brand": brand}

    return None


def parse_gpu_ps_output(output):
    """解析 Get-CimInstance Win32_VideoController 输出。

    格式：Name|AdapterRAM(bytes)
    例：NVIDIA GeForce RTX 3060|8589934592
    """
    for line in (output or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 1:
            continue
        name = parts[0].strip()
        vram = ""
        if len(parts) > 1 and parts[1].strip().isdigit():
            vram_gb = int(parts[1].strip()) // (1024 ** 3)
            if vram_gb > 0:
                vram = f"{vram_gb}GB"
        if not name:
            continue

        brand = "未知"
        name_upper = name.upper()
        if "NVIDIA" in name_upper or "GEFORCE" in name_upper or "RTX" in name_upper or "GTX" in name_upper:
            brand = "NVIDIA"
        elif "AMD" in name_upper or "RADEON" in name_upper:
            brand = "AMD"
        elif "INTEL" in name_upper:
            brand = "Intel"

        display_name = f"{name} ({vram})" if vram else name
        return {"category": "显卡", "name": display_name, "brand": brand}

    return None
