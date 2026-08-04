import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { importAssetsFromExcelAuto } from "@/actions/auto-import.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { join } from "path";

// ============================================================
// 测试 seam：硬件扫描工具 (hardware_scanner.py / 硬件扫描工具.exe) 导出的 Excel 文件
// 验证这些文件能被 importAssetsFromExcelAuto 正确导入
// ============================================================

const SCRIPTS_DIR = join(__dirname, "..", "scripts");
const DIST_DIR = join(SCRIPTS_DIR, "dist");

function readExcelAsBuffer(filePath: string): Buffer {
  return readFileSync(filePath);
}

function readExcelRows(filePath: string): Record<string, unknown>[] {
  const buffer = readExcelAsBuffer(filePath);
  const wb = XLSX.read(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
}

// 所有硬件扫描工具生成的 Excel 文件
const SCANNER_FILES = [
  { name: "scripts/asset_import.xlsx", path: join(SCRIPTS_DIR, "asset_import.xlsx") },
  { name: "scripts/dist/asset_import.xlsx", path: join(DIST_DIR, "asset_import.xlsx") },
  { name: "scripts/田鹤松_硬件信息.xlsx", path: join(SCRIPTS_DIR, "田鹤松_硬件信息.xlsx") },
];

describe("硬件扫描工具导出 Excel 导入测试", () => {
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
    for (const file of SCANNER_FILES) {
      it(`${file.name} 应存在且可被 XLSX 解析`, () => {
        const rows = readExcelRows(file.path);
        expect(rows.length).toBeGreaterThan(0);
      });

      it(`${file.name} 应包含必要字段（使用人/部门/设备名称/CPU型号等）`, () => {
        const rows = readExcelRows(file.path);
        expect(rows.length).toBeGreaterThan(0);
        const firstRow = rows[0];
        expect(firstRow).toHaveProperty("使用人");
        expect(firstRow).toHaveProperty("部门");
        expect(firstRow).toHaveProperty("设备名称");
        expect(firstRow).toHaveProperty("设备分类");
        expect(firstRow).toHaveProperty("设备分类编号");
        expect(firstRow).toHaveProperty("CPU型号");
        expect(firstRow).toHaveProperty("CPU品牌");
        expect(firstRow).toHaveProperty("内存型号");
        expect(firstRow).toHaveProperty("硬盘型号");
      });
    }
  });

  // ============================================================
  // 导入功能验证 - 所有文件
  // ============================================================
  describe("导入验证", () => {
    for (const file of SCANNER_FILES) {
      it(`${file.name} 应成功导入，无错误`, async () => {
        const buffer = readExcelAsBuffer(file.path);
        const numberArray = Array.from(buffer);

        const result = await importAssetsFromExcelAuto({ buffer: numberArray });

        expect(result.success).toBe(true);
        const data = unwrap(result);
        expect(data.importedCount).toBeGreaterThan(0);
        expect(data.errors).toHaveLength(0);
      });
    }

    it("应正确创建设备、员工、部门、配件", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[0].path);
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      // 设备已创建
      const assets = await prisma.asset.findMany({
        include: { components: true },
      });
      expect(assets.length).toBeGreaterThan(0);

      // 整机模式：设备不写配件记录，配件配置记录在模板 BOM 上
      for (const asset of assets) {
        expect(asset.components.length).toBe(0);
      }

      // 设备模板应包含 BOM 配件配置
      const templates = await prisma.deviceTemplate.findMany({
        include: { components: true },
      });
      expect(templates.some((t) => t.components.length > 0)).toBe(true);

      // 员工已创建
      const employees = await prisma.employee.findMany();
      expect(employees.length).toBeGreaterThan(0);

      // 部门已创建
      const departments = await prisma.department.findMany();
      expect(departments.length).toBeGreaterThan(0);

      // 设备分类已创建
      const categories = await prisma.assetCategory.findMany();
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.some((c) => c.name === "电脑主机")).toBe(true);
      expect(categories.some((c) => c.code === "PC")).toBe(true);
    });

    it("应正确处理 CPU/内存/硬盘/主板/显卡 配件分类", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[0].path);
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      const compCategories = await prisma.componentCategory.findMany();
      const compCatNames = compCategories.map((c) => c.name);

      // 硬件扫描工具会扫描这 5 类配件
      expect(compCatNames).toContain("CPU");
      expect(compCatNames).toContain("内存");
      expect(compCatNames).toContain("硬盘");
      expect(compCatNames).toContain("主板");
      expect(compCatNames).toContain("显卡");
    });

    it("应正确导入田鹤松的设备信息", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[2].path);
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      // 查找田鹤松
      const employee = await prisma.employee.findFirst({
        where: { name: "田鹤松" },
      });
      expect(employee).not.toBeNull();

      // 查找田鹤松的设备
      const assets = await prisma.asset.findMany({
        where: { employeeId: employee!.id },
        include: { components: true },
      });
      expect(assets.length).toBeGreaterThan(0);

      // 整机模式：设备不写配件记录，配件配置在模板 BOM 上
      const templates = await prisma.deviceTemplate.findMany({
        include: {
          components: {
            include: { model: { include: { category: true } } },
          },
        },
      });

      const componentCategoryNames = templates.flatMap((t) =>
        t.components.map((c) => c.model.category.name)
      );
      expect(componentCategoryNames).toContain("CPU");
      expect(componentCategoryNames).toContain("内存");
      expect(componentCategoryNames).toContain("硬盘");
    });

    it("应正确提取 CPU 型号（去除冗余前缀）", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[0].path);
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      // 原始 Excel 中的 CPU 型号是 "12th Gen Intel Core i5-12400"
      const cpuModels = await prisma.componentModel.findMany({
        where: { category: { name: "CPU" } },
      });
      expect(cpuModels.length).toBeGreaterThan(0);
      // 验证 CPU 型号包含 i5-12400
      expect(cpuModels.some((m) => m.name.includes("i5-12400"))).toBe(true);
    });

    it("应正确解析硬盘容量", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[0].path);
      const numberArray = Array.from(buffer);

      await importAssetsFromExcelAuto({ buffer: numberArray });

      // 原始 Excel 中的硬盘型号是 "953GB HDD (Dahua)"
      const diskModels = await prisma.componentModel.findMany({
        where: { category: { name: "硬盘" } },
      });
      expect(diskModels.length).toBeGreaterThan(0);
      // 验证硬盘型号包含容量信息
      expect(diskModels.some((m) => m.name.includes("953") || m.name.includes("GB"))).toBe(true);
    });
  });

  // ============================================================
  // 幂等性测试
  // ============================================================
  describe("重复导入", () => {
    it("同一硬件扫描文件连续导入两次，第二次应成功（幂等性）", async () => {
      const buffer = readExcelAsBuffer(SCANNER_FILES[0].path);
      const numberArray = Array.from(buffer);

      // 第一次导入
      const result1 = await importAssetsFromExcelAuto({ buffer: numberArray });
      expect(result1.success).toBe(true);
      const count1 = unwrap(result1).importedCount;

      // 第二次导入
      const result2 = await importAssetsFromExcelAuto({ buffer: numberArray });
      expect(result2.success).toBe(true);
      expect(unwrap(result2).importedCount).toBe(count1);
      expect(unwrap(result2).errors).toHaveLength(0);

      // 员工不应重复创建
      const employees = await prisma.employee.findMany();
      expect(employees.length).toBe(1);
    });
  });
});
