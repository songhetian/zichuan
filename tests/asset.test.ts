import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createAsset,
  getAssets,
  getAssetById,
  updateAsset,
  deleteAsset,
} from "@/actions/asset.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { allocateAssets } from "@/actions/lifecycle.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

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
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("createAsset", () => {
    it("按模板生成设备：名称取模板名，状态为库存", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        operator: "admin",
      });

      expect(result.success).toBe(true);
      const [asset] = unwrap(result);
      expect(asset.assetNo).toMatch(/^DN-\d{4}$/);
      // 名称由系统维护：不填使用人即入闲置池，名称取模板名
      expect(asset.name).toBe("标准办公电脑");
      expect(asset.status).toBe("IDLE");
      expect(asset.templateId).toBe(template.id);
      // 复制模板 BOM 配件到设备
      expect(asset.components).toHaveLength(2);
    });

    it("传 quantity 时批量生成 N 台，编号连续递增且名称均为模板名", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        quantity: 3,
        operator: "admin",
      });

      const assets = unwrap(result);
      expect(assets).toHaveLength(3);
      expect(assets.map((a) => a.assetNo)).toEqual(["DN-0001", "DN-0002", "DN-0003"]);
      expect(assets.every((a) => a.name === "标准办公电脑")).toBe(true);
      expect(assets.every((a) => a.status === "IDLE")).toBe(true);
    });

    it("按模板 BOM × 数量扣减配件库存", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        quantity: 3,
        operator: "admin",
      });

      expect(result.success).toBe(true);
      // 模板每台用 1 CPU + 2 内存，3 台共出库 3 / 6
      const cpuStock = await prisma.componentStock.findUnique({ where: { modelId: cpu.id } });
      const ramStock = await prisma.componentStock.findUnique({ where: { modelId: ram.id } });
      expect(cpuStock?.quantity).toBe(7);
      expect(ramStock?.quantity).toBe(4);
    });

    it("扣减库存时写入 ASSET_BUILD（组装设备出库）流水", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      await createAsset({ templateId: template.id, quantity: 2, operator: "admin" });

      const logs = await prisma.componentStockLog.findMany({
        where: { type: "ASSET_BUILD" },
      });
      expect(logs).toHaveLength(2);
      expect(logs.find((l) => l.modelId === cpu.id)?.quantity).toBe(-2);
      expect(logs.find((l) => l.modelId === ram.id)?.quantity).toBe(-4);
    });

    it("配件库存不足时整单拒绝，不产生任何设备、不扣任何库存", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 3, operator: "admin" });

      // 3 台需 3 CPU + 6 内存 → 内存不够
      const result = await createAsset({
        templateId: template.id,
        quantity: 3,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      // 提示停留在模板口径：最多还能建几台、卡在哪个配件上（不把配件账本摊给操作者）
      expect(unwrapError(result)).toContain("最多可建 1 台");
      expect(unwrapError(result)).toContain("本次要建 3 台");
      expect(unwrapError(result)).toContain("16GB DDR4");

      expect(await prisma.asset.count()).toBe(0);
      // 只有两条入库流水，没有半台设备的出库记录
      expect(await prisma.componentStockLog.count()).toBe(2);
      const cpuStock = await prisma.componentStock.findUnique({ where: { modelId: cpu.id } });
      const ramStock = await prisma.componentStock.findUnique({ where: { modelId: ram.id } });
      expect(cpuStock?.quantity).toBe(10);
      expect(ramStock?.quantity).toBe(3);
    });

    it("无 BOM 的外设模板不扣库存即可批量建档", async () => {
      const category = await prisma.assetCategory.create({
        data: { name: "显示器", code: "MON" },
      });
      const template = await prisma.deviceTemplate.create({
        data: { name: "戴尔显示器", categoryId: category.id },
      });

      const result = await createAsset({
        templateId: template.id,
        quantity: 5,
        operator: "admin",
      });

      const assets = unwrap(result);
      expect(assets).toHaveLength(5);
      expect(assets[0].assetNo).toBe("MON-0001");
      expect(assets[4].assetNo).toBe("MON-0005");
      expect(assets.every((a) => a.name === "戴尔显示器")).toBe(true);
    });

    it("生成设备时记录生命周期日志", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        operator: "admin",
      });

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: unwrap(result)[0].id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("CREATED");
      expect(logs[0].operator).toBe("admin");
    });

    it("填了使用人即建档即分配：状态「在用」，名称改为「{使用人}的{设备分类}」", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });
      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const employee = await prisma.employee.create({
        data: { employeeNo: "E1001", name: "张三", departmentId: dept.id },
      });

      const result = await createAsset({
        templateId: template.id,
        employeeId: employee.id,
        operator: "admin",
      });

      const asset = unwrap(result)[0];
      expect(asset.status).toBe("IN_USE");
      expect(asset.employeeId).toBe(employee.id);
      expect(asset.name).toBe("张三的计算机设备");

      const logs = await prisma.lifecycleLog.findMany({ where: { assetId: asset.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("ALLOCATED");
      expect(logs[0].toStatus).toBe("IN_USE");
    });

    it("使用人不存在时拒绝建档", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const result = await createAsset({
        templateId: template.id,
        employeeId: 99999,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBe("使用人不存在");
      expect(await prisma.asset.count()).toBe(0);
    });

    it("模板不存在时生成失败", async () => {
      const result = await createAsset({
        templateId: 99999,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("模板不存在");
    });

    it("未选择模板时给出明确错误", async () => {
      const result = await createAsset({ operator: "admin" } as never);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("设备模板");
    });

    it("数量必须为正整数", async () => {
      const { template } = await setupTestData();

      const result = await createAsset({
        templateId: template.id,
        quantity: 0,
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

      await createAsset({ templateId: template.id, operator: "admin" });
      await createAsset({ templateId: template.id, operator: "admin" });

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

      // 建档默认闲置，其中一台改成在用
      const asset1 = await createAsset({ templateId: template.id, operator: "admin" });
      await prisma.asset.update({
        where: { id: unwrap(asset1)[0].id },
        data: { status: "IN_USE", employeeId: emp.id },
      });

      const asset2 = await createAsset({ templateId: template.id, operator: "admin" });

      const result = await getAssets({ status: "IDLE" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].assetNo).toBe(unwrap(asset2)[0].assetNo);
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

      const pc = await createAsset({ templateId: template.id, operator: "admin" });
      await createAsset({ templateId: template2.id, operator: "admin" });

      const result = await getAssets({ categoryId: assetCat.id });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].assetNo).toBe(unwrap(pc)[0].assetNo);
    });

    it("可以按关键词搜索到使用人名下的设备", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E002", name: "张三", departmentId: dept.id },
      });

      const mine = await createAsset({ templateId: template.id, operator: "admin" });
      await createAsset({ templateId: template.id, operator: "admin" });
      // 分配后设备名变为「{使用人}的{设备分类}」
      await allocateAssets({
        assetIds: [unwrap(mine)[0].id],
        employeeId: emp.id,
        operator: "admin",
      });

      const result = await getAssets({ keyword: "张三" });

      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("张三的计算机设备");
    });

    it("空数据库返回空数组", async () => {
      const result = await getAssets();
      expect(unwrap(result)).toEqual([]);
    });

    it("可以按内存容量筛选设备", async () => {
      // 创建测试数据
      const assetCat = await prisma.assetCategory.create({
        data: { name: "计算机设备", code: "DN" },
      });
      const cpuCat = await prisma.componentCategory.create({
        data: { name: "CPU" },
      });
      const memoryCat = await prisma.componentCategory.create({
        data: { name: "内存" },
      });
      const diskCat = await prisma.componentCategory.create({
        data: { name: "硬盘" },
      });

      const cpu = await prisma.componentModel.create({
        data: { name: "i5-12400", brand: "Intel", categoryId: cpuCat.id },
      });
      const mem8gb = await prisma.componentModel.create({
        data: { name: "8GB DDR4", brand: "Kingston", categoryId: memoryCat.id },
      });
      const mem16gb = await prisma.componentModel.create({
        data: { name: "16GB DDR4", brand: "ADATA", categoryId: memoryCat.id },
      });
      const ssd512 = await prisma.componentModel.create({
        data: { name: "512GB NVMe SSD", brand: "Samsung", categoryId: diskCat.id },
      });
      const ssd1tb = await prisma.componentModel.create({
        data: { name: "1TB NVMe SSD", brand: "Samsung", categoryId: diskCat.id },
      });

      // 补充库存
      await prisma.componentStock.createMany({
        data: [
          { modelId: cpu.id, quantity: 10 },
          { modelId: mem8gb.id, quantity: 20 },
          { modelId: mem16gb.id, quantity: 10 },
          { modelId: ssd512.id, quantity: 10 },
          { modelId: ssd1tb.id, quantity: 10 },
        ],
      });

      // 创建模板1：8GB内存 + 512GB硬盘
      const template1 = await prisma.deviceTemplate.create({
        data: {
          name: "低配办公电脑",
          categoryId: assetCat.id,
          components: {
            create: [
              { modelId: cpu.id, quantity: 1 },
              { modelId: mem8gb.id, quantity: 1 },
              { modelId: ssd512.id, quantity: 1 },
            ],
          },
        },
      });

      // 创建模板2：16GB内存 + 1TB硬盘
      const template2 = await prisma.deviceTemplate.create({
        data: {
          name: "高配办公电脑",
          categoryId: assetCat.id,
          components: {
            create: [
              { modelId: cpu.id, quantity: 1 },
              { modelId: mem16gb.id, quantity: 1 },
              { modelId: ssd1tb.id, quantity: 1 },
            ],
          },
        },
      });

      // 创建设备
      await createAsset({ templateId: template1.id, operator: "admin" });
      const highMem = await createAsset({ templateId: template2.id, operator: "admin" });

      // 测试：筛选内存 >= 16GB 的设备
      const result1 = await getAssets({ memoryMinGB: 16 });
      expect(result1.success).toBe(true);
      const data1 = unwrap(result1);
      expect(data1.length).toBe(1);
      expect(data1[0].assetNo).toBe(unwrap(highMem)[0].assetNo);

      // 测试：筛选内存 >= 8GB 的设备（应该都满足）
      const result2 = await getAssets({ memoryMinGB: 8 });
      expect(result2.success).toBe(true);
      expect(unwrap(result2).length).toBe(2);

      // 测试：筛选内存 >= 32GB 的设备（应该没有）
      const result3 = await getAssets({ memoryMinGB: 32 });
      expect(result3.success).toBe(true);
      expect(unwrap(result3).length).toBe(0);
    });

    it("可以按硬盘容量筛选设备", async () => {
      // 创建测试数据
      const assetCat = await prisma.assetCategory.create({
        data: { name: "计算机设备", code: "DN" },
      });
      const cpuCat = await prisma.componentCategory.create({
        data: { name: "CPU" },
      });
      const memoryCat = await prisma.componentCategory.create({
        data: { name: "内存" },
      });
      const diskCat = await prisma.componentCategory.create({
        data: { name: "硬盘" },
      });

      const cpu = await prisma.componentModel.create({
        data: { name: "i5-12400", brand: "Intel", categoryId: cpuCat.id },
      });
      const mem8gb = await prisma.componentModel.create({
        data: { name: "8GB DDR4", brand: "Kingston", categoryId: memoryCat.id },
      });
      const ssd256 = await prisma.componentModel.create({
        data: { name: "256GB SATA SSD", brand: "Kingston", categoryId: diskCat.id },
      });
      const ssd1tb = await prisma.componentModel.create({
        data: { name: "1TB NVMe SSD", brand: "Samsung", categoryId: diskCat.id },
      });

      // 补充库存
      await prisma.componentStock.createMany({
        data: [
          { modelId: cpu.id, quantity: 10 },
          { modelId: mem8gb.id, quantity: 10 },
          { modelId: ssd256.id, quantity: 10 },
          { modelId: ssd1tb.id, quantity: 10 },
        ],
      });

      // 创建模板1：256GB硬盘
      const template1 = await prisma.deviceTemplate.create({
        data: {
          name: "低配电脑",
          categoryId: assetCat.id,
          components: {
            create: [
              { modelId: cpu.id, quantity: 1 },
              { modelId: mem8gb.id, quantity: 1 },
              { modelId: ssd256.id, quantity: 1 },
            ],
          },
        },
      });

      // 创建模板2：1TB硬盘
      const template2 = await prisma.deviceTemplate.create({
        data: {
          name: "高配电脑",
          categoryId: assetCat.id,
          components: {
            create: [
              { modelId: cpu.id, quantity: 1 },
              { modelId: mem8gb.id, quantity: 1 },
              { modelId: ssd1tb.id, quantity: 1 },
            ],
          },
        },
      });

      // 创建设备
      await createAsset({ templateId: template1.id, operator: "admin" });
      const bigDisk = await createAsset({ templateId: template2.id, operator: "admin" });

      // 测试：筛选硬盘 >= 500GB 的设备
      const result1 = await getAssets({ diskMinGB: 500 });
      expect(result1.success).toBe(true);
      const data1 = unwrap(result1);
      expect(data1.length).toBe(1);
      expect(data1[0].assetNo).toBe(unwrap(bigDisk)[0].assetNo);

      // 测试：筛选硬盘 >= 200GB 的设备（应该都满足）
      const result2 = await getAssets({ diskMinGB: 200 });
      expect(result2.success).toBe(true);
      expect(unwrap(result2).length).toBe(2);
    });

    it("多条内存时按总容量筛选", async () => {
      // 创建测试数据：两条8GB内存 = 16GB总容量
      const assetCat = await prisma.assetCategory.create({
        data: { name: "计算机设备", code: "DN" },
      });
      const cpuCat = await prisma.componentCategory.create({
        data: { name: "CPU" },
      });
      const memoryCat = await prisma.componentCategory.create({
        data: { name: "内存" },
      });

      const cpu = await prisma.componentModel.create({
        data: { name: "i5-12400", brand: "Intel", categoryId: cpuCat.id },
      });
      const mem8gbKingston = await prisma.componentModel.create({
        data: { name: "8GB DDR4", brand: "Kingston", categoryId: memoryCat.id },
      });
      const mem8gbAdata = await prisma.componentModel.create({
        data: { name: "8GB DDR4", brand: "ADATA", categoryId: memoryCat.id },
      });

      // 补充库存
      await prisma.componentStock.createMany({
        data: [
          { modelId: cpu.id, quantity: 10 },
          { modelId: mem8gbKingston.id, quantity: 10 },
          { modelId: mem8gbAdata.id, quantity: 10 },
        ],
      });

      // 创建模板：两条8GB不同品牌的内存
      const template = await prisma.deviceTemplate.create({
        data: {
          name: "双通道电脑",
          categoryId: assetCat.id,
          components: {
            create: [
              { modelId: cpu.id, quantity: 1 },
              { modelId: mem8gbKingston.id, quantity: 1 },
              { modelId: mem8gbAdata.id, quantity: 1 },
            ],
          },
        },
      });

      // 创建设备
      await createAsset({ templateId: template.id, operator: "admin" });

      // 测试：筛选内存 >= 16GB 的设备（两条8GB = 16GB，应该满足）
      const result1 = await getAssets({ memoryMinGB: 16 });
      expect(result1.success).toBe(true);
      const data1 = unwrap(result1);
      expect(data1.length).toBe(1);

      // 测试：筛选内存 >= 17GB 的设备（不满足）
      const result2 = await getAssets({ memoryMinGB: 17 });
      expect(result2.success).toBe(true);
      expect(unwrap(result2).length).toBe(0);
    });
  });

  describe("getAssetById", () => {
    it("可以根据 ID 获取设备详情（含配置和日志）", async () => {
      const { template, cpu, ram } = await setupTestData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const created = await createAsset({
        templateId: template.id,
        operator: "admin",
      });

      const result = await getAssetById(unwrap(created)[0].id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("标准办公电脑");
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
        operator: "admin",
      });

      const result = await updateAsset(unwrap(created)[0].id, {
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
        operator: "admin",
      });

      const result = await deleteAsset(unwrap(created)[0].id);

      expect(result.success).toBe(true);

      const asset = await prisma.asset.findUnique({ where: { id: unwrap(created)[0].id } });
      expect(asset).toBeNull();

      const components = await prisma.assetComponent.findMany({
        where: { assetId: unwrap(created)[0].id },
      });
      expect(components).toHaveLength(0);

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: unwrap(created)[0].id },
      });
      expect(logs).toHaveLength(0);
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteAsset(99999);
      expect(result.success).toBe(false);
    });
  });
});
