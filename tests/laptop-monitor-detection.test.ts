import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { unwrap } from "./helpers";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { COMPONENT_LAYER_CATEGORIES } from "@/lib/constants";
import * as XLSX from "xlsx";

// ============================================================
// 测试 seam：设备层 / 配件层的边界判定
// 验证后端导入逻辑能正确处理：
// 1. "笔记本电脑" 设备分类（code: NB）
// 2. "显示器" 属设备层：主机行里的显示器列不再变成配件，显示器按独立设备行导入
// 3. 配件列只认配件层白名单：清单外的「{X}型号」列不再误建垃圾配件分类
// 4. 白名单与 CONTEXT.md 的清单保持同步（防两处清单漂移）
// ============================================================

function buildExcelBuffer(rows: Record<string, string>[]): number[] {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "设备导入");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Array.from(Buffer.from(buf));
}

describe("笔记本 + 显示器检测功能导入测试", () => {
  beforeEach(() => {
    // 设备导入为写入操作：导入者需具备 asset.manage（与 createAsset 一致）
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  // ============================================================
  // 笔记本电脑分类测试
  // ============================================================
  describe("笔记本电脑分类", () => {
    it("应正确导入笔记本电脑（分类=笔记本电脑, 编号=NB）", async () => {
      const rows = [
        {
          "使用人": "张三",
          "部门": "技术部",
          "设备名称": "张三的笔记本电脑",
          "设备分类": "笔记本电脑",
          "设备分类编号": "NB",
          "CPU型号": "Intel Core i7-1360P",
          "CPU品牌": "Intel",
          "内存型号": "16GB DDR5",
          "内存品牌": "Samsung",
          "硬盘型号": "512GB SSD",
          "硬盘品牌": "Samsung",
          "主板型号": "ThinkPad X1 Carbon",
          "主板品牌": "Lenovo",
          "显卡型号": "Intel Iris Xe",
          "显卡品牌": "Intel",
          "显示器型号": "14寸 LCD",
          "显示器品牌": "Lenovo",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(1);
      expect(data.errors).toHaveLength(0);

      // 验证设备分类是"笔记本电脑"，编号是 NB
      const category = await prisma.assetCategory.findUnique({
        where: { name: "笔记本电脑" },
      });
      expect(category).not.toBeNull();
      expect(category!.code).toBe("NB");

      // 验证设备编号以 NB- 开头
      const asset = await prisma.asset.findFirst({
        where: { name: "张三的笔记本电脑" },
      });
      expect(asset).not.toBeNull();
      expect(asset!.assetNo).toMatch(/^NB-\d{4}$/);
    });

    it("台式机应使用 PC 编号，笔记本应使用 NB 编号（互不冲突）", async () => {
      const rows = [
        {
          "使用人": "李四",
          "部门": "技术部",
          "设备名称": "李四的台式机",
          "设备分类": "电脑主机",
          "设备分类编号": "PC",
          "CPU型号": "i5-12400",
          "CPU品牌": "Intel",
        },
        {
          "使用人": "王五",
          "部门": "技术部",
          "设备名称": "王五的笔记本",
          "设备分类": "笔记本电脑",
          "设备分类编号": "NB",
          "CPU型号": "i7-1360P",
          "CPU品牌": "Intel",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(2);

      // 验证两个设备的编号前缀不同
      const pcAsset = await prisma.asset.findFirst({
        where: { name: "李四的台式机" },
      });
      const nbAsset = await prisma.asset.findFirst({
        where: { name: "王五的笔记本" },
      });

      expect(pcAsset!.assetNo).toMatch(/^PC-\d{4}$/);
      expect(nbAsset!.assetNo).toMatch(/^NB-\d{4}$/);
    });
  });

  // ============================================================
  // 显示器：设备层（不再是配件）
  // ============================================================
  describe("显示器（设备层）", () => {
    it("主机行里的显示器列不再生成配件（单列与多列均跳过）", async () => {
      const rows = [
        {
          "使用人": "赵六",
          "部门": "财务部",
          "设备名称": "赵六的电脑主机",
          "设备分类": "电脑主机",
          "设备分类编号": "PC",
          "CPU型号": "i5-12400",
          "CPU品牌": "Intel",
          "内存型号": "8GB DDR4",
          "内存品牌": "Kingston",
          "显示器型号": "24寸 IPS 显示器",
          "显示器品牌": "Dell",
          "显示器1型号": "27寸 4K 显示器",
          "显示器1品牌": "LG",
          "显示器2型号": "24寸 显示器",
          "显示器2品牌": "Dell",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(1);

      // 显示器属设备层：不再生成「显示器」配件分类，也不进主机 BOM
      const monitorCategory = await prisma.componentCategory.findUnique({
        where: { name: "显示器" },
      });
      expect(monitorCategory).toBeNull();

      const asset = await prisma.asset.findFirst({
        where: { name: "赵六的电脑主机" },
        include: { components: { include: { model: { include: { category: true } } } } },
      });
      expect(asset!.components.map((c) => c.model.category.name).sort()).toEqual([
        "CPU",
        "内存",
      ]);
    });

    it("显示器按独立设备行导入，品牌/型号/序列号落在设备自身字段", async () => {
      const rows = [
        {
          "使用人": "孙七",
          "部门": "设计部",
          "设备分类": "显示器",
          "设备分类编号": "MON",
          "品牌": "戴尔",
          "型号": "U2723QE",
          "序列号": "CN-0M0N0001",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(1);

      const asset = await prisma.asset.findFirst({
        include: { template: { include: { category: true } } },
      });
      expect(asset).not.toBeNull();
      expect(asset!.template.category.name).toBe("显示器");
      expect(asset!.assetNo).toMatch(/^MON-\d{4}$/);
      // 未填设备名称 → 按「使用人 + 设备分类」生成
      expect(asset!.name).toBe("孙七的显示器");
      expect(asset!.brand).toBe("戴尔");
      expect(asset!.model).toBe("U2723QE");
      expect(asset!.serialNo).toBe("CN-0M0N0001");
      // 外设没有配件 BOM
      expect(asset!.status).toBe("IN_USE");
    });
  });

  // ============================================================
  // 综合：笔记本 + 显示器混合导入
  // ============================================================
  describe("笔记本 + 显示器混合导入", () => {
    it("笔记本行不再产生显示器配件，显示器行单独成设备", async () => {
      const rows: Record<string, string>[] = [
        {
          "使用人": "周八",
          "部门": "技术部",
          "设备名称": "周八的笔记本电脑",
          "设备分类": "笔记本电脑",
          "设备分类编号": "NB",
          "CPU型号": "Intel Core i7-1360P",
          "CPU品牌": "Intel",
          "内存型号": "16GB DDR5",
          "内存品牌": "Samsung",
          "显示器型号": "14寸 OLED",
          "显示器品牌": "Lenovo",
        },
        {
          "使用人": "周八",
          "部门": "技术部",
          "设备分类": "显示器",
          "设备分类编号": "MON",
          "品牌": "联想",
          "型号": "ThinkVision P27",
          "序列号": "SN-P27-001",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(2);

      const assets = await prisma.asset.findMany({
        include: { template: { include: { category: true } } },
        orderBy: { id: "asc" },
      });
      expect(assets).toHaveLength(2);
      expect(assets[0].template.category.name).toBe("笔记本电脑");
      expect(assets[1].template.category.name).toBe("显示器");
      expect(assets[1].name).toBe("周八的显示器");
      expect(assets[1].brand).toBe("联想");
      expect(assets[1].serialNo).toBe("SN-P27-001");

      // 笔记本行的显示器列不产生配件
      expect(
        await prisma.componentCategory.findUnique({ where: { name: "显示器" } })
      ).toBeNull();
    });
  });

  // ============================================================
  // 配件列只认配件层白名单
  // ============================================================
  describe("配件层白名单", () => {
    it("清单外的「{X}型号」列不再被当成配件（设备型号 / 台式机型号 / 规格型号）", async () => {
      const rows = [
        {
          "使用人": "钱九",
          "部门": "技术部",
          "设备名称": "钱九的电脑主机",
          "设备分类": "电脑主机",
          "设备分类编号": "PC",
          "设备型号": "OptiPlex 7010",
          "台式机型号": "OptiPlex 7010",
          "规格型号": "i5/16G/512G",
          "CPU型号": "i5-12400",
          "CPU品牌": "Intel",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(1);

      const asset = await prisma.asset.findFirst({
        where: { name: "钱九的电脑主机" },
        include: { components: { include: { model: { include: { category: true } } } } },
      });
      expect(asset!.components.map((c) => c.model.category.name)).toEqual(["CPU"]);

      // 只应建出 CPU 一个配件分类，不留下「设备」「台式机」「规格」这些垃圾分类
      const categories = await prisma.componentCategory.findMany({
        select: { name: true },
        orderBy: { id: "asc" },
      });
      expect(categories.map((c) => c.name)).toEqual(["CPU"]);
    });

    it("清单内的配件列仍正常解析，含数字后缀的多条（内存 / 内存2 / 电源）", async () => {
      const rows = [
        {
          "使用人": "孙十",
          "部门": "技术部",
          "设备名称": "孙十的电脑主机",
          "设备分类": "电脑主机",
          "设备分类编号": "PC",
          "内存型号": "8GB DDR4",
          "内存品牌": "Kingston",
          "内存2型号": "16GB DDR4",
          "内存2品牌": "Samsung",
          "电源型号": "500W 金牌",
          "电源品牌": "航嘉",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(1);

      const asset = await prisma.asset.findFirst({
        where: { name: "孙十的电脑主机" },
        include: {
          components: { include: { model: { include: { category: true } } } },
        },
      });
      expect(
        asset!.components.map((c) => `${c.model.category.name}/${c.model.name}/${c.model.brand}`).sort()
      ).toEqual(["内存/16GB DDR4/Samsung", "内存/8GB DDR4/Kingston", "电源/500W 金牌/航嘉"]);
    });

    it("配件层白名单与 CONTEXT.md 的清单保持一致", () => {
      const line = readFileSync("CONTEXT.md", "utf8")
        .split("\n")
        .find((l) => l.startsWith("配件层："));
      expect(line).toBeDefined();

      const docNames = line!
        .replace("配件层：", "")
        .replace(/[；;。.]\s*$/, "")
        .split("、")
        .map((s) => s.trim())
        .sort();

      expect(docNames).toEqual([...COMPONENT_LAYER_CATEGORIES].sort());
    });
  });
});
