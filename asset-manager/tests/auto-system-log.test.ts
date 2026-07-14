import { describe, it, expect } from "vitest";
import {
  allocateAssets,
  returnAssets,
  transferAssets,
  upgradeAssetComponent,
  scrapAssets,
} from "@/actions/lifecycle.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { createAsset } from "@/actions/asset.actions";
import { createEmployee } from "@/actions/employee.actions";
import { getSystemLogs } from "@/actions/system-log.actions";
import { prisma } from "@/lib/prisma";

// ============================================================
// 测试 seam：lifecycle / stock actions 的公开接口
// 验证：执行操作后，系统日志自动写入 SystemLog
// ============================================================

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

  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: {
      name: "标准办公电脑",
      categoryId: assetCat.id,
      components: {
        create: [{ modelId: cpu.id, quantity: 1 }],
      },
    },
  });

  return { dept, emp, cpu, assetCat, template };
}

async function createIdleAsset(template: any, name: string) {
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
    data: { assetNo, name, templateId: template.id, status: "IDLE" },
  });
}

describe("系统日志自动记录", () => {
  describe("分配操作自动记录系统日志", () => {
    it("分配设备后自动生成系统日志", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");

      await allocateAssets({
        assetIds: [asset.id],
        employeeId: emp.data!.id,
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "分配" });
      expect(logs.success).toBe(true);
      expect(logs.data!.length).toBeGreaterThanOrEqual(1);
      const allocLog = logs.data!.find((l) => l.detail.includes(asset.assetNo));
      expect(allocLog).toBeDefined();
      expect(allocLog!.operator).toBe("admin");
    });
  });

  describe("归还操作自动记录系统日志", () => {
    it("归还设备后自动生成系统日志", async () => {
      const { emp, template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: emp.data!.id },
      });

      await returnAssets({
        assetIds: [asset.id],
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "归还" });
      expect(logs.success).toBe(true);
      const returnLog = logs.data!.find((l) => l.detail.includes(asset.assetNo));
      expect(returnLog).toBeDefined();
    });
  });

  describe("调拨操作自动记录系统日志", () => {
    it("调拨设备后自动生成系统日志", async () => {
      const { emp, template } = await setupFullData();
      const emp2 = await createEmployee({
        employeeNo: "E002",
        name: "李四",
        departmentId: emp.data!.departmentId,
      });
      const asset = await createIdleAsset(template, "电脑1");
      await prisma.asset.update({
        where: { id: asset.id },
        data: { status: "IN_USE", employeeId: emp.data!.id },
      });

      await transferAssets({
        assetIds: [asset.id],
        toEmployeeId: emp2.data!.id,
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "调拨" });
      expect(logs.success).toBe(true);
      const transferLog = logs.data!.find((l) => l.detail.includes(asset.assetNo));
      expect(transferLog).toBeDefined();
    });
  });

  describe("报废操作自动记录系统日志", () => {
    it("报废设备后自动生成系统日志", async () => {
      const { template } = await setupFullData();
      const asset = await createIdleAsset(template, "电脑1");

      await scrapAssets({
        assetIds: [asset.id],
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "报废" });
      expect(logs.success).toBe(true);
      const scrapLog = logs.data!.find((l) => l.detail.includes(asset.assetNo));
      expect(scrapLog).toBeDefined();
    });
  });

  describe("升级操作自动记录系统日志", () => {
    it("升级设备配件后自动生成系统日志", async () => {
      const { template, cpu } = await setupFullData();
      await purchaseStockIn({ modelId: cpu.id, quantity: 10, operator: "admin" });
      const newCpu = await prisma.componentModel.create({
        data: { name: "i9-13900K", brand: "Intel", categoryId: cpu.categoryId },
      });
      await purchaseStockIn({ modelId: newCpu.id, quantity: 5, operator: "admin" });

      const asset = await createIdleAsset(template, "电脑1");
      await prisma.assetComponent.create({
        data: { assetId: asset.id, modelId: cpu.id, quantity: 1 },
      });

      await upgradeAssetComponent({
        assetId: asset.id,
        modelId: cpu.id,
        newModelId: newCpu.id,
        quantity: 1,
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "升级" });
      expect(logs.success).toBe(true);
      const upgradeLog = logs.data!.find((l) => l.detail.includes(asset.assetNo));
      expect(upgradeLog).toBeDefined();
    });
  });

  describe("入库操作自动记录系统日志", () => {
    it("采购入库后自动生成系统日志", async () => {
      const compCat = await prisma.componentCategory.create({ data: { name: "内存" } });
      const ram = await prisma.componentModel.create({
        data: { name: "16GB DDR4", brand: "金士顿", categoryId: compCat.id },
      });

      await purchaseStockIn({
        modelId: ram.id,
        quantity: 10,
        operator: "admin",
      });

      const logs = await getSystemLogs({ module: "入库" });
      expect(logs.success).toBe(true);
      expect(logs.data!.length).toBeGreaterThanOrEqual(1);
      const stockLog = logs.data!.find((l) => l.detail.includes("16GB DDR4"));
      expect(stockLog).toBeDefined();
    });
  });
});
