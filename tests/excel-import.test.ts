import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  importEmployeesFromExcel,
  importComponentModelsFromExcel,
} from "@/actions/excel.actions";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";

// ============================================================
// 测试 seam：excel actions — 导入
// ============================================================

function createExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

describe("Excel 导入", () => {
  describe("importEmployeesFromExcel — 导入员工", () => {
    it("可以从 Excel 导入员工数据", async () => {
      // 先创建部门
      const dept = await prisma.department.create({ data: { name: "技术部" } });

      const buffer = createExcelBuffer([
        { "工号": "E001", "姓名": "张三", "部门": "技术部", "电话": "13800138000", "邮箱": "zhangsan@test.com" },
        { "工号": "E002", "姓名": "李四", "部门": "技术部", "电话": "13900139000", "邮箱": "" },
      ]);

      const result = await importEmployeesFromExcel({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(2);

      // 验证数据
      const emps = await prisma.employee.findMany({ orderBy: { employeeNo: "asc" } });
      expect(emps).toHaveLength(2);
      expect(emps[0].name).toBe("张三");
      expect(emps[0].phone).toBe("13800138000");
      expect(emps[1].name).toBe("李四");
    });

    it("部门不存在时跳过并报告错误", async () => {
      const buffer = createExcelBuffer([
        { "工号": "E003", "姓名": "王五", "部门": "不存在的部门", "电话": "", "邮箱": "" },
      ]);

      const result = await importEmployeesFromExcel({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(0);
      expect(unwrap(result).errors).toBeDefined();
      expect(unwrap(result).errors!.length).toBeGreaterThan(0);
    });

    it("工号重复时跳过已存在的记录", async () => {
      const dept = await prisma.department.create({ data: { name: "技术部" } });
      await prisma.employee.create({
        data: { employeeNo: "E001", name: "已有员工", departmentId: dept.id },
      });

      const buffer = createExcelBuffer([
        { "工号": "E001", "姓名": "重复", "部门": "技术部", "电话": "", "邮箱": "" },
        { "工号": "E002", "姓名": "新员工", "部门": "技术部", "电话": "", "邮箱": "" },
      ]);

      const result = await importEmployeesFromExcel({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(1); // E002 是新的
    });
  });

  describe("importComponentModelsFromExcel — 导入配件型号", () => {
    it("可以从 Excel 导入配件型号", async () => {
      // 先创建分类
      const cat = await prisma.componentCategory.create({ data: { name: "CPU" } });

      const buffer = createExcelBuffer([
        { "型号名称": "i7-12700F", "品牌": "Intel", "分类": "CPU" },
        { "型号名称": "Ryzen 5", "品牌": "AMD", "分类": "CPU" },
      ]);

      const result = await importComponentModelsFromExcel({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(2);

      const models = await prisma.componentModel.findMany({ orderBy: { id: "asc" } });
      expect(models).toHaveLength(2);
      expect(models[0].name).toBe("i7-12700F");
      expect(models[1].brand).toBe("AMD");
    });

    it("分类不存在时跳过并报告错误", async () => {
      const buffer = createExcelBuffer([
        { "型号名称": "不存在分类的配件", "品牌": "Brand", "分类": "不存在的分类" },
      ]);

      const result = await importComponentModelsFromExcel({ buffer });

      expect(result.success).toBe(true);
      expect(unwrap(result).importedCount).toBe(0);
      expect(unwrap(result).errors!.length).toBeGreaterThan(0);
    });
  });
});
