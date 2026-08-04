import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { join } from "path";

// ============================================================
// 测试 seam：scripts/generate_*.py 生成的 Excel 文件
// 验证这些文件能被 importAssetsFromExcelAuto 正确导入
// ============================================================

const SCRIPTS_DIR = join(__dirname, "..", "scripts");

function readExcelAsBuffer(fileName: string): Buffer {
  const filePath = join(SCRIPTS_DIR, fileName);
  return readFileSync(filePath);
}

function readExcelRows(fileName: string): Record<string, unknown>[] {
  const buffer = readExcelAsBuffer(fileName);
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
}

describe("脚本生成的 Excel 文件导入测试", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  // ============================================================
  // 文件结构验证
  // ============================================================
  describe("文件结构验证", () => {
    it("测试导入_多行数据.xlsx 应存在且包含 4 行数据", () => {
      const rows = readExcelRows("测试导入_多行数据.xlsx");
      expect(rows.length).toBe(4);
    });

    it("测试导入_6人3部门.xlsx 应存在且包含 6 行数据", () => {
      const rows = readExcelRows("测试导入_6人3部门.xlsx");
      expect(rows.length).toBe(6);
    });

    it("测试导入_多内存多硬盘.xlsx 应存在且包含 3 行数据", () => {
      const rows = readExcelRows("测试导入_多内存多硬盘.xlsx");
      expect(rows.length).toBe(3);
    });

    it("所有 Excel 文件应包含必要字段（使用人/部门/设备名称）", () => {
      const files = [
        "测试导入_多行数据.xlsx",
        "测试导入_6人3部门.xlsx",
        "测试导入_多内存多硬盘.xlsx",
      ];

      for (const file of files) {
        const rows = readExcelRows(file);
        expect(rows.length).toBeGreaterThan(0);
        const firstRow = rows[0];
        expect(firstRow).toHaveProperty("使用人");
        expect(firstRow).toHaveProperty("部门");
        expect(firstRow).toHaveProperty("设备名称");
      }
    });
  });

  // ============================================================
  // 导入功能验证 - 测试导入_多行数据.xlsx
  // ============================================================
  describe("导入 测试导入_多行数据.xlsx", () => {
    it("应成功导入 4 台设备，无错误", async () => {
      const buffer = readExcelAsBuffer("测试导入_多行数据.xlsx");
      const numberArray = Array.from(buffer);

      const result = await importAssetsFromExcelAuto({ buffer: numberArray });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(4);
      expect(data.errors).toHaveLength(0);
      expect(data.details).toHaveLength(4);
    });

    it("应正确创建 4 个员工和 3 个部门（技术部/后勤部/财务部）", async () => {
      const buffer = readExcelAsBuffer("测试导入_多行数据.xlsx");
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      const employees = await prisma.employee.findMany();
      expect(employees).toHaveLength(4);

      const departments = await prisma.department.findMany();
      const deptNames = departments.map((d) => d.name).sort();
      expect(deptNames).toEqual(["后勤部", "技术部", "财务部"]);
    });

    it("应正确创建设备分类（电脑主机）和配件", async () => {
      const buffer = readExcelAsBuffer("测试导入_多行数据.xlsx");
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      const categories = await prisma.assetCategory.findMany();
      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe("电脑主机");
      expect(categories[0].code).toBe("PC");

      // 应有 CPU/内存/硬盘/主板/显卡 5 个配件分类
      const compCategories = await prisma.componentCategory.findMany();
      expect(compCategories.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ============================================================
  // 导入功能验证 - 测试导入_6人3部门.xlsx
  // ============================================================
  describe("导入 测试导入_6人3部门.xlsx", () => {
    it("应成功导入 6 台设备，无错误", async () => {
      const buffer = readExcelAsBuffer("测试导入_6人3部门.xlsx");
      const numberArray = Array.from(buffer);

      const result = await importAssetsFromExcelAuto({ buffer: numberArray });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(6);
      expect(data.errors).toHaveLength(0);
    });

    it("应创建 6 个员工和 3 个部门（技术部/财务部/市场部）", async () => {
      const buffer = readExcelAsBuffer("测试导入_6人3部门.xlsx");
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      const employees = await prisma.employee.findMany();
      expect(employees).toHaveLength(6);

      const departments = await prisma.department.findMany();
      const deptNames = departments.map((d) => d.name).sort();
      expect(deptNames).toEqual(["市场部", "技术部", "财务部"]);
    });
  });

  // ============================================================
  // 导入功能验证 - 测试导入_多内存多硬盘.xlsx
  // ============================================================
  describe("导入 测试导入_多内存多硬盘.xlsx", () => {
    it("应成功导入 3 台设备，无错误", async () => {
      const buffer = readExcelAsBuffer("测试导入_多内存多硬盘.xlsx");
      const numberArray = Array.from(buffer);

      const result = await importAssetsFromExcelAuto({ buffer: numberArray });

      expect(result.success).toBe(true);
      const data = unwrap(result);
      expect(data.importedCount).toBe(3);
      expect(data.errors).toHaveLength(0);
    });

    it("应正确处理多内存多硬盘格式（内存1/内存2/硬盘1/硬盘2 列）", async () => {
      const buffer = readExcelAsBuffer("测试导入_多内存多硬盘.xlsx");
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      // 验证设备已创建
      const assets = await prisma.asset.findMany({
        include: {
          components: true,
        },
      });
      expect(assets).toHaveLength(3);

      // 设备复制模板 BOM 配件记录（每个设备应有配件配置）
      for (const asset of assets) {
        expect(asset.components.length).toBeGreaterThan(0);
      }

      // 模板 BOM 应包含配件配置
      const templates = await prisma.deviceTemplate.findMany({
        include: { components: true },
      });
      expect(templates.some((t) => t.components.length > 0)).toBe(true);

      // 验证内存配件型号已创建（张三有两条不同品牌的 8GB 内存）
      const memoryModels = await prisma.componentModel.findMany({
        where: {
          category: { name: "内存" },
        },
      });
      expect(memoryModels.length).toBeGreaterThanOrEqual(2);

      // 验证硬盘配件型号已创建（张三有 SSD + HDD 两种硬盘）
      const diskModels = await prisma.componentModel.findMany({
        where: {
          category: { name: "硬盘" },
        },
      });
      expect(diskModels.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================================
  // 综合测试 - 重复导入不应报错
  // ============================================================
  describe("重复导入", () => {
    it("同一文件连续导入两次，第二次应成功（幂等性）", async () => {
      const buffer = readExcelAsBuffer("测试导入_6人3部门.xlsx");
      const numberArray = Array.from(buffer);

      // 第一次导入
      const result1 = await importAssetsFromExcelAuto({ buffer: numberArray });
      expect(result1.success).toBe(true);
      expect(unwrap(result1).importedCount).toBe(6);

      // 第二次导入（员工和配件已存在，应查找或创建而非报错）
      const result2 = await importAssetsFromExcelAuto({ buffer: numberArray });
      expect(result2.success).toBe(true);
      expect(unwrap(result2).importedCount).toBe(6);
      expect(unwrap(result2).errors).toHaveLength(0);

      // 应有 12 台设备（每次 6 台）
      const assets = await prisma.asset.findMany();
      expect(assets).toHaveLength(12);

      // 但员工仍只有 6 个（查找或创建）
      const employees = await prisma.employee.findMany();
      expect(employees).toHaveLength(6);
    });
  });
});
