import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  importEmployeesFromExcel,
  importComponentModelsFromExcel,
  importAssetsFromExcel,
} from "@/actions/excel.actions";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

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
  beforeEach(async () => {
    // 自建超级管理员：显式授予导入相关权限点，避免依赖 test DB 种子数据
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    const superRole = await prisma.role.create({
      data: { key: "SUPER_ADMIN", name: "超级管理员", isSystem: true },
    });
    const permKeys = [
      "system.account.manage",
      "employee.import",
      "employee.view",
      "asset.manage",
      "asset.component.view",
      "asset.import.execute",
    ];
    for (const k of permKeys) {
      const perm = await prisma.permission.upsert({
        where: { key: k },
        update: {},
        create: { key: k, module: "system", name: k },
      });
      await prisma.rolePermission.create({ data: { roleId: superRole.id, permissionId: perm.id } });
    }
    const admin = await prisma.admin.create({
      data: { username: "admin", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: admin.id, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

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

  describe("importAssetsFromExcel — 按模板 BOM 扣减配件库存", () => {
    let _counter = 0;

    // 每台设备消耗 2 个 CPU，库存由入参决定
    async function setupStockTemplate(stockQty: number) {
      const cat = await prisma.assetCategory.create({
        data: { name: `导入库存分类_${Date.now()}_${++_counter}`, code: "PC" },
      });
      const compCat = await prisma.componentCategory.create({
        data: { name: `CPU_${Date.now()}_${++_counter}` },
      });
      const cpu = await prisma.componentModel.create({
        data: { name: "i5-12400", brand: "Intel", categoryId: compCat.id },
      });
      await prisma.componentStock.create({ data: { modelId: cpu.id, quantity: stockQty } });
      const template = await prisma.deviceTemplate.create({
        data: {
          name: `导入库存模板_${Date.now()}_${_counter}`,
          categoryId: cat.id,
          components: { create: [{ modelId: cpu.id, quantity: 2 }] },
        },
      });
      return { cpu, template };
    }

    it("按模板 BOM 扣减配件库存并写 ASSET_BUILD 流水", async () => {
      const { cpu, template } = await setupStockTemplate(10);
      const buffer = createExcelBuffer([
        { "设备名称": "测试设备", "设备模板": template.name, "使用人": "" },
      ]);

      const result = await importAssetsFromExcel({ buffer: Array.from(buffer) });

      expect(unwrap(result).importedCount).toBe(1);
      // 每台 2 个：10 → 8
      const stock = await prisma.componentStock.findUnique({ where: { modelId: cpu.id } });
      expect(stock?.quantity).toBe(8);
      const logs = await prisma.componentStockLog.findMany({ where: { type: "ASSET_BUILD" } });
      expect(logs).toHaveLength(1);
      expect(logs[0].modelId).toBe(cpu.id);
      expect(logs[0].quantity).toBe(-2);
    });

    it("没填使用人的行入闲置池（与新建设备同一口径）", async () => {
      const { template } = await setupStockTemplate(10);
      const buffer = createExcelBuffer([
        { "设备名称": "闲置设备", "设备模板": template.name, "使用人": "" },
      ]);

      const result = await importAssetsFromExcel({ buffer: Array.from(buffer) });

      expect(unwrap(result).importedCount).toBe(1);
      const asset = await prisma.asset.findFirst({ where: { templateId: template.id } });
      expect(asset?.status).toBe("IDLE");
      expect(asset?.employeeId).toBeNull();
      const log = await prisma.lifecycleLog.findFirst({ where: { assetId: asset!.id } });
      expect(log?.action).toBe("CREATED");
      expect(log?.toStatus).toBe("IDLE");
    });

    it("配件库存不足时该行跳过并报中文错误，不产生设备、不扣库存", async () => {
      const { cpu, template } = await setupStockTemplate(1);
      const buffer = createExcelBuffer([
        { "设备名称": "缺料设备", "设备模板": template.name, "使用人": "" },
      ]);

      const result = await importAssetsFromExcel({ buffer: Array.from(buffer) });

      const data = unwrap(result);
      expect(data.importedCount).toBe(0);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toContain("最多可建 0 台");
      // 机器编码不得泄漏给用户
      expect(data.errors[0]).not.toContain("INSUFFICIENT_STOCK");
      expect(await prisma.asset.count({ where: { templateId: template.id } })).toBe(0);
      const stock = await prisma.componentStock.findUnique({ where: { modelId: cpu.id } });
      expect(stock?.quantity).toBe(1);
    });

    it("多行导入逐行扣减，库存耗尽后的行报错跳过", async () => {
      const { cpu, template } = await setupStockTemplate(4);
      const buffer = createExcelBuffer([
        { "设备名称": "设备A", "设备模板": template.name, "使用人": "" },
        { "设备名称": "设备B", "设备模板": template.name, "使用人": "" },
        { "设备名称": "设备C", "设备模板": template.name, "使用人": "" },
      ]);

      const result = await importAssetsFromExcel({ buffer: Array.from(buffer) });

      const data = unwrap(result);
      expect(data.importedCount).toBe(2);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toContain("第4行");
      expect(await prisma.asset.count({ where: { templateId: template.id } })).toBe(2);
      const stock = await prisma.componentStock.findUnique({ where: { modelId: cpu.id } });
      expect(stock?.quantity).toBe(0);
    });
  });

  describe("导入权限校验（无权限账号一律拒绝）", () => {
    it("无 employee.import 权限时拒绝导入员工（导入会批量创建登录账号）", async () => {
      setTestUser({ id: 99999, username: "no-perm" });
      const buffer = createExcelBuffer([
        { "工号": "E101", "姓名": "赵六", "部门": "技术部", "电话": "", "邮箱": "" },
      ]);

      const result = await importEmployeesFromExcel({ buffer });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("导入员工");
    });

    it("无 asset.component.view 权限时拒绝导入配件型号", async () => {
      setTestUser({ id: 99999, username: "no-perm" });
      const buffer = createExcelBuffer([{ "型号名称": "R24", "品牌": "Dell", "分类": "CPU" }]);

      const result = await importComponentModelsFromExcel({ buffer });

      expect(result.success).toBe(false);
    });

    it("无 asset.manage 权限时拒绝自动导入资产", async () => {
      setTestUser({ id: 99999, username: "no-perm" });
      const { importAssetsFromExcelAuto } = await import("@/actions/auto-import.actions");
      const buffer = createExcelBuffer([{ "使用人": "张三", "部门": "技术部", "设备名称": "台式机", "资产编号": "PC0001" }]);

      const result = await importAssetsFromExcelAuto({ buffer: Array.from(buffer) });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("资产");
    });
  });
});
