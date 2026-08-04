import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import * as XLSX from "xlsx";

// ============================================================
// 测试 seam：硬件扫描工具新增的笔记本检测 + 显示器检测功能
// 验证后端导入逻辑能正确处理：
// 1. "笔记本电脑" 设备分类（code: NB）
// 2. "显示器" 配件分类
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
    setTestUser({ id: 1, username: "admin" });
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
  // 显示器配件测试
  // ============================================================
  describe("显示器配件", () => {
    it("应正确导入显示器作为配件（分类=显示器）", async () => {
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
          "硬盘型号": "256GB SSD",
          "硬盘品牌": "Kingston",
          "显示器型号": "24寸 IPS 显示器",
          "显示器品牌": "Dell",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(1);
      expect(data.errors).toHaveLength(0);

      // 验证"显示器"配件分类已创建
      const monitorCategory = await prisma.componentCategory.findUnique({
        where: { name: "显示器" },
      });
      expect(monitorCategory).not.toBeNull();

      // 验证显示器配件型号已创建
      const monitorModel = await prisma.componentModel.findFirst({
        where: {
          category: { name: "显示器" },
          name: "24寸 IPS 显示器",
          brand: "Dell",
        },
      });
      expect(monitorModel).not.toBeNull();

      // 整机模式：显示器配件记录在模板 BOM 上
      const template = await prisma.deviceTemplate.findFirst({
        where: { category: { name: "电脑主机" } },
        include: {
          components: {
            include: { model: { include: { category: true } } },
          },
        },
      });
      const monitorComponent = template!.components.find(
        (c) => c.model.category.name === "显示器"
      );
      expect(monitorComponent).toBeDefined();
      expect(monitorComponent!.model.name).toBe("24寸 IPS 显示器");
    });

    it("应支持多显示器（显示器1/显示器2 多列格式）", async () => {
      const rows = [
        {
          "使用人": "孙七",
          "部门": "设计部",
          "设备名称": "孙七的电脑主机",
          "设备分类": "电脑主机",
          "设备分类编号": "PC",
          "CPU型号": "i9-13900K",
          "CPU品牌": "Intel",
          "显示器1型号": "27寸 4K 显示器",
          "显示器1品牌": "LG",
          "显示器2型号": "24寸 显示器",
          "显示器2品牌": "Dell",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(1);

      // 整机模式：两个显示器记录在模板 BOM 上
      const template = await prisma.deviceTemplate.findFirst({
        where: { category: { name: "电脑主机" } },
        include: {
          components: {
            include: { model: { include: { category: true } } },
          },
        },
      });

      const monitors = template!.components.filter(
        (c) => c.model.category.name === "显示器"
      );
      expect(monitors.length).toBe(2);
    });
  });

  // ============================================================
  // 综合：笔记本 + 显示器
  // ============================================================
  describe("笔记本 + 显示器组合", () => {
    it("笔记本自带屏幕应作为显示器配件导入", async () => {
      const rows = [
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
          "硬盘型号": "1TB SSD",
          "硬盘品牌": "Samsung",
          "主板型号": "ThinkPad X1 Carbon",
          "主板品牌": "Lenovo",
          "显示器型号": "14寸 OLED",
          "显示器品牌": "Lenovo",
        },
      ];

      const buffer = buildExcelBuffer(rows);
      const result = await importAssetsFromExcelAuto({ buffer });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(1);

      // 验证分类是笔记本电脑
      const asset = await prisma.asset.findFirst({
        where: { name: "周八的笔记本电脑" },
        include: { template: { include: { category: true } } },
      });
      expect(asset!.template.category.name).toBe("笔记本电脑");

      // 整机模式：显示器记录在模板 BOM 上
      const template = await prisma.deviceTemplate.findFirst({
        where: { category: { name: "笔记本电脑" } },
        include: {
          components: {
            include: { model: { include: { category: true } } },
          },
        },
      });
      const monitors = template!.components.filter(
        (c) => c.model.category.name === "显示器"
      );
      expect(monitors.length).toBe(1);
      expect(monitors[0].model.name).toBe("14寸 OLED");
    });
  });
});
