import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createAsset,
  getAssets,
  getAssetById,
  updateAsset,
  deleteAsset,
} from "@/actions/asset.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { prisma } from "@/lib/prisma";

async function setupTestData() {
  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DN" },
  });
  const compCat = await prisma.componentCategory.create({
    data: { name: "CPU" },
  });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  const ram = await prisma.componentModel.create({
    data: { name: "16GB DDR4", brand: "金士顿", categoryId: compCat.id },
  });

  // 创建模板和 BOM
  const template = await prisma.deviceTemplate.create({
    data: {
      name: "标准办公电脑",
      categoryId: assetCat.id,
      components: {
        create: [
          { modelId: cpu.id, quantity: 1 },
          { modelId: ram.id, quantity: 2 },
        ],
      },
    },
  });

  return { assetCat, cpu, ram, template };
}

describe("设备实体 CRUD", () => {
  describe("createAsset", () => {
    it("可以按模板生成设备并自动分配编号", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        name: "张三的办公电脑",
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).assetNo).toMatch(/^DN-\d{4}$/);
      expect(unwrap(result).name).toBe("张三的办公电脑");
      expect(unwrap(result).status).toBe("IDLE");
      expect(unwrap(result).templateId).toBe(template.id);
      expect(unwrap(result).components).toHaveLength(2);
      expect(unwrap(result).components[0].modelId).toBe(cpu.id);
      expect(unwrap(result).components[1].quantity).toBe(2);
    });

    it("生成设备时扣减配件库存", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      await createAsset({ templateId: template.id, name: "电脑1", operator: "admin" });

      const cpuStock = await prisma.componentStock.findUnique({
        where: { modelId: cpu.id },
      });
      const ramStock = await prisma.componentStock.findUnique({
        where: { modelId: ram.id },
      });

      expect(cpuStock?.quantity).toBe(9); // 10 - 1
      expect(ramStock?.quantity).toBe(8); // 10 - 2
    });

    it("生成设备时记录生命周期日志", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        name: "电脑1",
        operator: "admin",
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: unwrap(result).id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("CREATED");
      expect(logs[0].operator).toBe("admin");
    });

    it("多台设备编号自动递增", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const r1 = await createAsset({ templateId: template.id, name: "电脑1", operator: "admin" });
      const r2 = await createAsset({ templateId: template.id, name: "电脑2", operator: "admin" });

      expect(unwrap(r1).assetNo).toBe("DN-0001");
      expect(unwrap(r2).assetNo).toBe("DN-0002");
    });

    it("库存不足时生成失败", async () => {
      const { template, cpu } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 0, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        name: "电脑1",
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存不足");
    });

    it("模板不存在时生成失败", async () => {
      const result = await createAsset({
        templateId: 99999,
        name: "电脑1",
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("模板不存在");
    });

    it("设备名称不能为空", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        name: "",
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("getAssets", () => {
    it("可以获取全部设备列表", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      await createAsset({ templateId: template.id, name: "电脑1", operator: "admin" });
      await createAsset({ templateId: template.id, name: "电脑2", operator: "admin" });

      const result = await getAssets();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });

    it("可以按状态筛选", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
      });

      const asset1 = await createAsset({ templateId: template.id, name: "电脑1", operator: "admin" });
      await prisma.asset.update({
        where: { id: unwrap(asset1).id },
        data: { status: "IN_USE", employeeId: emp.id },
      });

      await createAsset({ templateId: template.id, name: "电脑2", operator: "admin" });

      const result = await getAssets({ status: "IDLE" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("电脑2");
    });

    it("可以按分类筛选", async () => {
      const { template, cpu, ram, assetCat } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const cat2 = await prisma.assetCategory.create({
        data: { name: "网络设备", code: "WL" },
      });
      const template2 = await prisma.deviceTemplate.create({
        data: { name: "路由器", categoryId: cat2.id },
      });

      await createAsset({ templateId: template.id, name: "电脑", operator: "admin" });
      await createAsset({ templateId: template2.id, name: "路由器", operator: "admin" });

      const result = await getAssets({ categoryId: assetCat.id });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("电脑");
    });

    it("可以按关键词搜索", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      await createAsset({ templateId: template.id, name: "张三的电脑", operator: "admin" });
      await createAsset({ templateId: template.id, name: "李四的电脑", operator: "admin" });

      const result = await getAssets({ keyword: "张三" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("张三的电脑");
    });

    it("空数据库返回空数组", async () => {
      const result = await getAssets();
      expect(unwrap(result)).toEqual([]);
    });
  });

  describe("getAssetById", () => {
    it("可以根据 ID 获取设备详情（含配置和日志）", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const created = await createAsset({
        templateId: template.id,
        name: "电脑1",
        operator: "admin",
      });

      const result = await getAssetById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("电脑1");
      expect(unwrap(result).components).toHaveLength(2);
      expect(unwrap(result).lifecycleLogs).toHaveLength(1);
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getAssetById(99999);
      expect(result.success).toBe(false);
    });
  });

  describe("updateAsset", () => {
    it("可以更新设备基本信息", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const created = await createAsset({
        templateId: template.id,
        name: "电脑1",
        operator: "admin",
      });

      const result = await updateAsset(unwrap(created).id, {
        name: "新名称",
        location: "办公室 A",
        notes: "备注信息",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("新名称");
      expect(unwrap(result).location).toBe("办公室 A");
      expect(unwrap(result).notes).toBe("备注信息");
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateAsset(99999, { name: "测试" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteAsset", () => {
    it("可以删除设备并级联删除配件配置和日志", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const created = await createAsset({
        templateId: template.id,
        name: "电脑1",
        operator: "admin",
      });

      const result = await deleteAsset(unwrap(created).id);

      expect(result.success).toBe(true);

      const asset = await prisma.asset.findUnique({ where: { id: unwrap(created).id } });
      expect(asset).toBeNull();

      const components = await prisma.assetComponent.findMany({
        where: { assetId: unwrap(created).id },
      });
      expect(components).toHaveLength(0);

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: unwrap(created).id },
      });
      expect(logs).toHaveLength(0);
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteAsset(99999);
      expect(result.success).toBe(false);
    });
  });
});
