"""硬件扫描工具 - 纯逻辑单元测试

覆盖内存去重、硬盘品牌推断、显示器厂商码映射。
"""
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import hardware_utils


class TestMemoryParsing(unittest.TestCase):
    """内存 wmic 输出解析 + 去重"""

    def test_正常两根内存_解析为两条(self):
        output = """DeviceLocator=DIMM_A1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

DeviceLocator=DIMM_B1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(len(modules), 2)
        self.assertEqual(modules[0]["locator"], "DIMM_A1")
        self.assertEqual(modules[1]["locator"], "DIMM_B1")

    def test_同插槽重复报告_去重为一条(self):
        """根因复现：物理2根内存，wmic 报3条（DIMM_A1 重复）"""
        output = """DeviceLocator=DIMM_A1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

DeviceLocator=DIMM_A1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

DeviceLocator=DIMM_B1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(len(modules), 2)
        locators = [m["locator"] for m in modules]
        self.assertEqual(locators, ["DIMM_A1", "DIMM_B1"])

    def test_空插槽容量为0_被过滤(self):
        output = """DeviceLocator=DIMM_A1
Capacity=0
Manufacturer=

DeviceLocator=DIMM_B1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(len(modules), 1)
        self.assertEqual(modules[0]["locator"], "DIMM_B1")

    def test_无插槽信息时_同规格内存保留全部(self):
        """修复点：真实两条同规格内存（无 DeviceLocator）不能被合并成一条！
        之前按 容量+速度+品牌 合并导致"2条变1条"、检测不到内存。"""
        output = """Capacity=8589934592
Manufacturer=Kingston
Speed=3200

Capacity=8589934592
Manufacturer=Kingston
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(len(modules), 2)

    def test_无插槽信息时_不同规格内存保留全部(self):
        output = """Capacity=8589934592
Manufacturer=Kingston
Speed=3200

Capacity=17179869184
Manufacturer=Samsung
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(len(modules), 2)
        self.assertEqual(modules[0]["name"], "8GB DDR3200MHz")
        self.assertEqual(modules[1]["name"], "16GB DDR3200MHz")

    def test_输出格式_生成内存名称(self):
        output = """DeviceLocator=DIMM_A1
Capacity=8589934592
Manufacturer=Kingston
Speed=3200

"""
        modules = hardware_utils.parse_memory_output(output)
        self.assertEqual(modules[0]["name"], "8GB DDR3200MHz")
        self.assertEqual(modules[0]["brand"], "Kingston")


class TestDiskBrand(unittest.TestCase):
    """硬盘品牌推断"""

    def test_常见品牌型号可识别(self):
        cases = [
            ("Samsung SSD 970 EVO", "Samsung"),
            ("WDC WD10EZEX", "Western Digital"),
            ("Seagate Barracuda 1TB", "Seagate"),
            ("Intel SSDPEKNW512G8", "Intel"),
            ("TOSHIBA DT01ACA100", "Toshiba"),
            ("KINGSTON SA400S37", "Kingston"),
            ("SanDisk SDSSDA240G", "SanDisk"),
            ("SK hynix SC308", "SK hynix"),
            ("ADATA SU800", "ADATA"),
        ]
        for model, expected in cases:
            with self.subTest(model=model):
                self.assertEqual(hardware_utils.guess_disk_brand(model), expected)

    def test_不带品牌名的型号前缀可识别(self):
        """修复点：ST2000DM001 / CT500MX500 这类型号不带品牌全名"""
        cases = [
            ("ST2000DM001", "Seagate"),        # 希捷
            ("ST31000524AS", "Seagate"),       # 希捷
            ("CT500MX500SSD1", "Micron"),      # 英睿达
            ("CT1000BX500SSD1", "Micron"),     # 英睿达
            ("WD20EZRZ", "Western Digital"),   # 西数
        ]
        for model, expected in cases:
            with self.subTest(model=model):
                self.assertEqual(hardware_utils.guess_disk_brand(model), expected)

    def test_无法识别的型号返回未知(self):
        self.assertEqual(hardware_utils.guess_disk_brand("XYZ12345"), "未知")


class TestMonitorBrand(unittest.TestCase):
    """显示器厂商码映射"""

    def test_三字母厂商码映射为品牌全名(self):
        cases = [
            ("DEL", "Dell"),
            ("SAM", "Samsung"),
            ("PHL", "Philips"),
            ("ACR", "Acer"),
            ("LGD", "LG"),
            ("BNQ", "BenQ"),
            ("LEN", "Lenovo"),
            ("HPN", "HP"),
            ("VSC", "ViewSonic"),
        ]
        for code, expected in cases:
            with self.subTest(code=code):
                self.assertEqual(hardware_utils.map_monitor_brand(code), expected)

    def test_小写厂商码也能映射(self):
        self.assertEqual(hardware_utils.map_monitor_brand("del"), "Dell")

    def test_未知厂商码返回空(self):
        self.assertEqual(hardware_utils.map_monitor_brand("ZZZ"), "")
        self.assertEqual(hardware_utils.map_monitor_brand(""), "")


class TestMemoryPsParsing(unittest.TestCase):
    """PowerShell Get-CimInstance 内存输出解析（wmic 被移除的备选路径）"""

    def test_正常两根内存_解析为两条(self):
        output = "Bank0|8589934592|3200|Kingston\nBank1|8589934592|3200|Kingston\n"
        modules = hardware_utils.parse_memory_ps_output(output)
        self.assertEqual(len(modules), 2)
        self.assertEqual(modules[0]["name"], "8GB DDR3200MHz")
        self.assertEqual(modules[1]["locator"], "Bank1")

    def test_同插槽重复报告_去重为一条(self):
        output = (
            "Bank0|8589934592|3200|Kingston\n"
            "Bank0|8589934592|3200|Kingston\n"
            "Bank1|8589934592|3200|Kingston\n"
        )
        modules = hardware_utils.parse_memory_ps_output(output)
        self.assertEqual(len(modules), 2)

    def test_空插槽容量为0_被过滤(self):
        output = "Bank0|0|0|\nBank1|8589934592|3200|Kingston\n"
        modules = hardware_utils.parse_memory_ps_output(output)
        self.assertEqual(len(modules), 1)
        self.assertEqual(modules[0]["locator"], "Bank1")

    def test_空输出返回空列表(self):
        self.assertEqual(hardware_utils.parse_memory_ps_output(""), [])


class TestMemoryResultSelection(unittest.TestCase):
    """选择更可靠的内存检测结果（wmic vs PowerShell 互补）"""

    def _wmic(self, modules):
        """构造 wmic 解析结果（含 locator 字段）"""
        return [dict(m, locator="") for m in modules]

    def test_wmic有插槽信息_优先用wmic(self):
        wmic = [{"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": "DIMM_A1"}]
        ps = [{"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": "Bank0"}]
        result = hardware_utils.pick_memory_result(wmic, ps)
        self.assertEqual(result, wmic)

    def test_wmic无插槽_用PowerShell结果覆盖(self):
        """wmic 无插槽时无法可靠去重，改用 PS（PS 的 DeviceLocator 可靠）"""
        wmic = [{"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": ""}]
        ps = [
            {"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": "Bank0"},
            {"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": "Bank1"},
        ]
        result = hardware_utils.pick_memory_result(wmic, ps)
        self.assertEqual(result, ps)

    def test_两边都无插槽_退回wmic保守结果(self):
        wmic = [{"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": ""}]
        result = hardware_utils.pick_memory_result(wmic, [])
        self.assertEqual(result, wmic)

    def test_wmic空_用PowerShell结果(self):
        result = hardware_utils.pick_memory_result(
            [],
            [{"name": "8GB DDR3200MHz", "brand": "Kingston", "locator": "Bank0"}],
        )
        self.assertEqual(len(result), 1)


class TestCpuBoardGpuParsing(unittest.TestCase):
    """CPU/主板/显卡 PowerShell fallback 解析"""

    def test_cpu_正常解析(self):
        r = hardware_utils.parse_cpu_ps_output("Intel(R) Core(TM) i7-12700|Intel\n")
        self.assertIsNotNone(r)
        self.assertEqual(r["name"], "Intel Core i7-12700")
        self.assertEqual(r["brand"], "Intel")

    def test_cpu_空输出返回None(self):
        self.assertIsNone(hardware_utils.parse_cpu_ps_output(""))

    def test_cpu_品牌缺失显示未知(self):
        r = hardware_utils.parse_cpu_ps_output("AMD Ryzen 5 5600X|\n")
        self.assertEqual(r["brand"], "未知")

    def test_主板_正常解析(self):
        r = hardware_utils.parse_motherboard_ps_output("B660M|ASUS\n")
        self.assertIsNotNone(r)
        self.assertEqual(r["name"], "B660M")
        self.assertEqual(r["brand"], "ASUS")

    def test_主板_NotAvailable被跳过(self):
        r = hardware_utils.parse_motherboard_ps_output("Not Available|Not Available\n")
        self.assertIsNone(r)

    def test_显卡_正常解析带显存(self):
        r = hardware_utils.parse_gpu_ps_output("NVIDIA GeForce RTX 3060|8589934592\n")
        self.assertIsNotNone(r)
        self.assertEqual(r["name"], "NVIDIA GeForce RTX 3060 (8GB)")
        self.assertEqual(r["brand"], "NVIDIA")

    def test_显卡_空输出返回None(self):
        self.assertIsNone(hardware_utils.parse_gpu_ps_output(""))


if __name__ == "__main__":
    unittest.main()
