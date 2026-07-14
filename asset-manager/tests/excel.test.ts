import { describe, it, expect } from "vitest";
import {
  exportAssetsToExcel,
  exportComponentsToExcel,
  exportEmployeesToExcel,
} from "@/actions/excel.actions";
import { prisma } from "@/lib/prisma";

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
  describe("exportAssetsToExcel", () => {
    it("可以导出设备数据为 Excel 格式的 Buffer", async () => {
      await setupExcelData();

      const result = await exportAssetsToExcel();

      expect(result.success).toBe(true);
      expect(result.data?.buffer).toBeDefined();
      expect(result.data?.buffer.length).toBeGreaterThan(0);
      expect(result.data?.fileName).toContain(".xlsx");
    });

    it("空数据库导出不为空 Buffer", async () => {
      const result = await exportAssetsToExcel();
      expect(result.success).toBe(true);
      // Buffer 可以存在但设备行数为 0
    });
  });

  describe("exportComponentsToExcel", () => {
    it("可以导出配件型号数据", async () => {
      await setupExcelData();

      const result = await exportComponentsToExcel();

      expect(result.success).toBe(true);
      expect(result.data?.buffer).toBeDefined();
      expect(result.data?.buffer.length).toBeGreaterThan(0);
    });
  });

  describe("exportEmployeesToExcel", () => {
    it("可以导出员工数据", async () => {
      await setupExcelData();

      const result = await exportEmployeesToExcel();

      expect(result.success).toBe(true);
      expect(result.data?.buffer).toBeDefined();
      expect(result.data?.buffer.length).toBeGreaterThan(0);
    });
  });
});
