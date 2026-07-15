import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  allocateAssets,
  returnAssets,
  transferAssets,
  upgradeAssetComponent,
  scrapAssets,
} from "@/actions/lifecycle.actions";
import { createAsset } from "@/actions/asset.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { createEmployee } from "@/actions/employee.actions";
import { createDepartment } from "@/actions/department.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupFullData() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp = await createEmployee({
    employeeNo: "E001",
    name: "张三",
    departmentId: dept.id,
  });

  const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  const ramCat = await prisma.componentCategory.create({ data: { name: "内存" } });
  const ram = await prisma.componentModel.create({
    data: { name: "16GB DDR4", brand: "金士顿", categoryId: ramCat.id },
  });

  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DN" },
  });
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

  return { dept, emp, cpu, ram, assetCat, template };
}

async function createIdleAsset(template: any, name: string) {
  // 手动创建闲置设备（不经过 createAsset，避免每次都检查库存）
  const cat = await prisma.assetCategory.findUnique({
    where: { id: template.categoryId },
  });
  const prefix = cat!.code;

  const lastAsset = await prisma.asset.findFirst({
    where: { assetNo: { startsWith: prefix + "-" } },
    orderBy: { assetNo: "desc" },
  });
  let nextNum = 1;
  if (lastAsset) {
    const match = lastAsset.assetNo.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  const assetNo = `${prefix}-${String(nextNum).padStart(4, "0")}`;

  return prisma.asset.create({
    data: {
      assetNo,
      name,
      templateId: template.id,
      status: "IDLE",
    },
  });
}

describe("分配", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("allocateAssets — 从设备池分配闲置设备", () => {
    it("可以将闲置设备分配给员工", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");

      const result = await allocateAssets({
        assetIds: [asset.id],
        employeeId: unwrap(emp).id,
        operator: "admin",
        remark: "新人入职",
      });

      expect(result.success).toBe(true);

      // 验证设备状态和员工
      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("IN_USE");
      expect(updated?.employeeId).toBe(unwrap(emp).id);

      // 验证生命周期日志
      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("ALLOCATED");
      expect(logs[0].fromStatus).toBe("IDLE");
      expect(logs[0].toStatus).toBe("IN_USE");
      expect(logs[0].employeeId).toBe(unwrap(emp).id);
      expect(logs[0].operator).toBe("admin");
      expect(logs[0].remark).toBe("新人入职");
    });

    it("可以批量分配多台设备给同一个员工", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");
      const asset3 = await createIdleAsset(template, "电脑3");

      const result = await allocateAssets({
        assetIds: [asset1.id, asset2.id, asset3.id],
        employeeId: unwrap(emp).id,
        operator: "admin",
        remark: "批量分配",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).allocatedCount).toBe(3);

      // 验证所有设备都分配了
      const assets = await prisma.asset.findMany({
        where: { id: { in: [asset1.id, asset2.id, asset3.id] } },
      });
      expect(assets.every((a) => a.status === "IN_USE")).toBe(true);
      expect(assets.every((a) => a.employeeId === unwrap(emp).id)).toBe(true);
    });

    it("只有闲置设备才能分配", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE" },
      });

      const result = await allocateAssets({
        assetIds: [asset.id],
        employeeId: unwrap(emp).id,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("非闲置");
    });

    it("已报废的设备不能分配", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "SCRAPPED" },
      });

      const result = await allocateAssets({
        assetIds: [asset.id],
        employeeId: unwrap(emp).id,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("非闲置");
    });

    it("员工不存在时分配失败", async () => {
      const { template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");

      const result = await allocateAssets({
        assetIds: [asset.id],
        employeeId: 99999,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("员工不存在");
    });

    it("部分设备不可分配时全部回滚", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");
      // asset2 设为在用状态
      await prisma.asset.update({
        where: { id: asset2.id },
        data: { status: "IN_USE" },
      });

      const result = await allocateAssets({
        assetIds: [asset1.id, asset2.id],
        employeeId: unwrap(emp).id,
        operator: "admin",
      });

      expect(result.success).toBe(false);

      // 验证 asset1 也没有被分配（回滚）
      const a1 = await prisma.asset.findUnique({ where: { id: asset1.id } });
      expect(a1?.status).toBe("IDLE");
      expect(a1?.employeeId).toBeNull();
    });

    it("空设备列表返回错误", async () => {
      const { emp } = await setupFullData();

      const result = await allocateAssets({
        assetIds: [],
        employeeId: unwrap(emp).id,
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("归还", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("returnAssets — 批量归还设备", () => {
    it("可以将员工的在用设备批量归还", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");

      // 先分配
      await prisma.asset.updateMany({
        where: { id: { in: [asset1.id, asset2.id] } },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await returnAssets({
        assetIds: [asset1.id, asset2.id],
        operator: "admin",
        remark: "员工离职",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).returnedCount).toBe(2);

      // 验证设备状态
      const assets = await prisma.asset.findMany({
        where: { id: { in: [asset1.id, asset2.id] } },
      });
      expect(assets.every((a) => a.status === "IDLE")).toBe(true);
      expect(assets.every((a) => a.employeeId === null)).toBe(true);

      // 验证日志
      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset1.id, action: "RETURNED" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].fromStatus).toBe("IN_USE");
      expect(logs[0].toStatus).toBe("IDLE");
      expect(logs[0].remark).toBe("员工离职");
    });

    it("只有 IN_USE 状态的设备才能归还", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      // 状态是 IDLE，不是 IN_USE

      const result = await returnAssets({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("非在用");
    });

    it("部分设备不可归还时全部回滚", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");

      // asset1 在用，asset2 闲置
      await prisma.asset.update({
        where: { id: asset1.id },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await returnAssets({
        assetIds: [asset1.id, asset2.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);

      // asset1 也没有归还（回滚）
      const a1 = await prisma.asset.findUnique({ where: { id: asset1.id } });
      expect(a1?.status).toBe("IN_USE");
    });
  });
});

describe("调拨", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("transferAssets — 批量调拨设备", () => {
    it("可以将设备从一个员工调拨给另一个员工", async () => {
      const { emp, template } = await setupFullData();
      const emp2 = await createEmployee({
        employeeNo: "E002",
        name: "李四",
        departmentId: unwrap(emp).departmentId,
      });
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await transferAssets({
        assetIds: [asset.id],
        toEmployeeId: unwrap(emp2).id,
        operator: "admin",
        remark: "部门调动",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("IN_USE");
      expect(updated?.employeeId).toBe(unwrap(emp2).id);

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset.id, action: "TRANSFERRED" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].fromEmployeeId).toBe(unwrap(emp).id);
      expect(logs[0].employeeId).toBe(unwrap(emp2).id);
    });

    it("可以批量调拨多台设备", async () => {
      const { emp, template } = await setupFullData();
      const emp2 = await createEmployee({
        employeeNo: "E002",
        name: "李四",
        departmentId: unwrap(emp).departmentId,
      });
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");
      await prisma.asset.updateMany({
        where: { id: { in: [asset1.id, asset2.id] } },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await transferAssets({
        assetIds: [asset1.id, asset2.id],
        toEmployeeId: unwrap(emp2).id,
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).transferredCount).toBe(2);
    });

    it("只有 IN_USE 状态的设备才能调拨", async () => {
      const { emp, template } = await setupFullData();
      const emp2 = await createEmployee({
        employeeNo: "E002",
        name: "李四",
        departmentId: unwrap(emp).departmentId,
      });
      const asset = await createIdleAsset(template, "电脑1");
      // 状态是 IDLE

      const result = await transferAssets({
        assetIds: [asset.id],
        toEmployeeId: unwrap(emp2).id,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("非在用");
    });

    it("目标员工不存在时调拨失败", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await transferAssets({
        assetIds: [asset.id],
        toEmployeeId: 99999,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("员工不存在");
    });
  });
});

describe("升级", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("upgradeAssetComponent — 更换设备配件", () => {
    it("可以更换设备配件并更新库存", async () => {
      const { emp, template, cpu, ram } = await setupFullData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      // 创建第二种 CPU 型号
      const newCpu = await prisma.componentModel.create({
        data: { name: "i9-13900K", brand: "Intel", categoryId: cpu.categoryId },
      });
      await purchaseStockIn({ modelId: newCpu.id, quantity: 5, operator: "admin" });

      // 创建设备（有旧 CPU + 内存）
      const asset = await createIdleAsset(template, "电脑1");
      // 加上配件配置
      await prisma.assetComponent.createMany({
        data: [
          { assetId: asset.id, modelId: cpu.id, quantity: 1 },
          { assetId: asset.id, modelId: ram.id, quantity: 2 },
        ],
      });

      const result = await upgradeAssetComponent({
        assetId: asset.id,
        modelId: cpu.id,          // 换掉旧 CPU
        newModelId: newCpu.id,   // 换成新 CPU
        quantity: 1,
        operator: "admin",
        remark: "CPU 升级",
      });

      expect(result.success).toBe(true);

      // 验证设备配件配置：应该有新 CPU + 内存（没有旧 CPU）
      const components = await prisma.assetComponent.findMany({
        where: { assetId: asset.id },
      });
      const modelIds = components.map((c) => c.modelId);
      expect(modelIds).toContain(newCpu.id);
      expect(modelIds).not.toContain(cpu.id);

      // 验证库存：新 CPU 减 1，旧 CPU 加 1（原有库存 10 + 退回 1 = 11）
      const newCpuStock = await prisma.componentStock.findUnique({
        where: { modelId: newCpu.id },
      });
      const oldCpuStock = await prisma.componentStock.findUnique({
        where: { modelId: cpu.id },
      });
      expect(newCpuStock?.quantity).toBe(4); // 5 - 1
      expect(oldCpuStock?.quantity).toBe(11); // 10 + 1（退回）

      // 验证生命周期日志
      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset.id, action: "UPGRADED" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].remark).toBe("CPU 升级");
    });

    it("新配件库存不足时升级失败", async () => {
      const { emp, template, cpu } = await setupFullData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });

      const newCpu = await prisma.componentModel.create({
        data: { name: "i9", brand: "Intel", categoryId: cpu.categoryId },
      });
      await purchaseStockIn({ modelId: newCpu.id, quantity: 0, operator: "admin" }); // 库存为 0

      const asset = await createIdleAsset(template, "电脑1");
      await prisma.assetComponent.create({
        data: { assetId: asset.id, modelId: cpu.id, quantity: 1 },
      });

      const result = await upgradeAssetComponent({
        assetId: asset.id,
        modelId: cpu.id,
        newModelId: newCpu.id,
        quantity: 1,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存不足");
    });

    it("设备上没有该配件时升级失败", async () => {
      const { emp, template, cpu, ram } = await setupFullData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: ram.id, quantity: 10, operator: "admin" });

      const asset = await createIdleAsset(template, "电脑1");
      // 设备上只有内存，没有 CPU
      await prisma.assetComponent.create({
        data: { assetId: asset.id, modelId: ram.id, quantity: 2 },
      });

      const result = await upgradeAssetComponent({
        assetId: asset.id,
        modelId: cpu.id, // 设备上没有这个配件
        newModelId: ram.id,
        quantity: 1,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("设备上不存在该配件");
    });
  });
});

describe("报废", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("scrapAssets — 批量报废设备", () => {
    it("可以将在用设备报废", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await scrapAssets({
        assetIds: [asset.id],
        operator: "admin",
        remark: "设备老化",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("SCRAPPED");
      expect(updated?.employeeId).toBeNull();

      const logs = await prisma.lifecycleLog.findMany({
        where: { assetId: asset.id, action: "SCRAPPED" },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].fromStatus).toBe("IN_USE");
      expect(logs[0].toStatus).toBe("SCRAPPED");
    });

    it("闲置设备也可以报废", async () => {
      const { template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");

      const result = await scrapAssets({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(true);

      const updated = await prisma.asset.findUnique({ where: { id: asset.id } });
      expect(updated?.status).toBe("SCRAPPED");
    });

    it("已报废的设备不能重复报废", async () => {
      const { template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "SCRAPPED" },
      });

      const result = await scrapAssets({
        assetIds: [asset.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已报废");
    });

    it("批量报废多台设备", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");
      await prisma.asset.updateMany({
        where: { id: { in: [asset1.id, asset2.id] } },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });

      const result = await scrapAssets({
        assetIds: [asset1.id, asset2.id],
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).scrappedCount).toBe(2);
    });

    it("部分设备不可报废时全部回滚", async () => {
      const { emp, template } = await setupFullData();
      const asset1 = await createIdleAsset(template, "电脑1");
      const asset2 = await createIdleAsset(template, "电脑2");
      await prisma.asset.update({
        where: { id: asset1.id },
        data: { status: "IN_USE", employeeId: unwrap(emp).id },
      });
      await prisma.asset.update({
        where: { id: asset2.id },
        data: { status: "SCRAPPED" }, // 已报废
      });

      const result = await scrapAssets({
        assetIds: [asset1.id, asset2.id],
        operator: "admin",
      });

      expect(result.success).toBe(false);

      // asset1 也没报废（回滚）
      const a1 = await prisma.asset.findUnique({ where: { id: asset1.id } });
      expect(a1?.status).toBe("IN_USE");
    });
  });
});
