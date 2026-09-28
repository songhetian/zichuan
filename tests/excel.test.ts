import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as XLSX from "xlsx";
import { unwrap, unwrapError } from "./helpers";
import {
  exportAssetsToExcel,
  exportComponentsToExcel,
  exportEmployeesToExcel,
} from "@/actions/excel.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupExcelData() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await prisma.employee.create({
    data: { employeeNo: "E001", name: "张三", departmentId: dept.id, phone: "13800138000" },
  });

  const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  await prisma.componentStock.upsert({
    where: { modelId: cpu.id },
    update: { quantity: 10 },
    create: { modelId: cpu.id, quantity: 10 },
  });

  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准电脑", categoryId: assetCat.id },
  });
  await prisma.asset.create({
    data: {
      assetNo: "DN-0001",
      name: "办公电脑",
      templateId: template.id,
      status: "IN_USE",
      employeeId: emp.id,
    },
  });

  return { dept, emp, cpu, assetCat, template };
}

describe("Excel 导出", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage", "system.account.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("exportAssetsToExcel", () => {
    it("可以导出设备数据为 Excel 格式的 Buffer", async () => {
      await setupExcelData();

      const result = await exportAssetsToExcel();

      expect(result.success).toBe(true);
      expect(unwrap(result).buffer).toBeDefined();
      expect(unwrap(result).buffer.length).toBeGreaterThan(0);
      expect(unwrap(result).fileName).toContain(".xlsx");
    });

    it("空数据库导出不为空 Buffer", async () => {
      const result = await exportAssetsToExcel();
      expect(result.success).toBe(true);
      // Buffer 可以存在但设备行数为 0
    });

    it("导出含品牌 / 型号 / 序列号列", async () => {
      const { template } = await setupExcelData();
      await prisma.asset.create({
        data: {
          assetNo: "XS-0001",
          name: "张三的显示器",
          templateId: template.id,
          status: "IN_USE",
          brand: "戴尔",
          model: "U2723QE",
          serialNo: "CN-0A1B2C3",
        },
      });

      const result = await exportAssetsToExcel();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const wb = XLSX.read(Buffer.from(unwrap(result).buffer));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      const monitor = rows.find((r) => r["设备编号"] === "XS-0001");

      expect(monitor?.["品牌"]).toBe("戴尔");
      expect(monitor?.["型号"]).toBe("U2723QE");
      expect(monitor?.["序列号"]).toBe("CN-0A1B2C3");
    });

    it("按字段选择导出时可单独选品牌 / 型号 / 序列号", async () => {
      const { template } = await setupExcelData();
      await prisma.asset.create({
        data: {
          assetNo: "XS-0002",
          name: "李四的显示器",
          templateId: template.id,
          brand: "AOC",
          model: "Q27G2S",
          serialNo: "SN-0002",
        },
      });

      const result = await exportAssetsToExcel(["assetNo", "brand", "serialNo"]);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const wb = XLSX.read(Buffer.from(unwrap(result).buffer));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      const monitor = rows.find((r) => r["设备编号"] === "XS-0002");

      expect(monitor?.["品牌"]).toBe("AOC");
      expect(monitor?.["序列号"]).toBe("SN-0002");
      expect(monitor?.["型号"]).toBeUndefined();
    });
  });

  describe("exportComponentsToExcel", () => {
    it("可以导出配件型号数据", async () => {
      await setupExcelData();

      const result = await exportComponentsToExcel();

      expect(result.success).toBe(true);
      expect(unwrap(result).buffer).toBeDefined();
      expect(unwrap(result).buffer.length).toBeGreaterThan(0);
    });
  });

  describe("exportEmployeesToExcel", () => {
    it("可以导出员工数据", async () => {
      await setupExcelData();

      const result = await exportEmployeesToExcel();

      expect(result.success).toBe(true);
      expect(unwrap(result).buffer).toBeDefined();
      expect(unwrap(result).buffer.length).toBeGreaterThan(0);
    });

    it("传入 selectedFields 时仅导出选中的列", async () => {
      await setupExcelData();

      const result = await exportEmployeesToExcel(["employeeNo", "name"]);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const wb = XLSX.read(Buffer.from(unwrap(result).buffer));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
      expect(rows.length).toBeGreaterThan(0);
      const row = rows[0];
      expect(row["工号"]).toBe("E001");
      expect(row["姓名"]).toBe("张三");
      expect(row["部门"]).toBeUndefined();
      expect(row["电话"]).toBeUndefined();
      expect(row["邮箱"]).toBeUndefined();
    });
  });

  describe("导出权限校验（无权限一律拒绝）", () => {
    beforeEach(() => {
      setTestUser({ id: 99999, username: "no-perm", permissions: [] });
    });

    it("无 asset.device.export 权限时导出设备被拒", async () => {
      const r = await exportAssetsToExcel();
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error).toContain("权限");
    });

    it("无 asset.component.view 权限时导出配件被拒", async () => {
      const r = await exportComponentsToExcel();
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error).toContain("权限");
    });

    it("无 employee.view 权限时导出员工被拒", async () => {
      const r = await exportEmployeesToExcel();
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error).toContain("权限");
    });
  });
});
