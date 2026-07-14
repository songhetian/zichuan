import { describe, it, expect } from "vitest";
import { getAssetStats, getStockStats, getLifecycleTrend } from "@/actions/stats.actions";
import { prisma } from "@/lib/prisma";

async function setupStatsData() {
  const dept = await prisma.department.create({ data: { name: "技术部" } });
  const emp1 = await prisma.employee.create({
    data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
  });
  const emp2 = await prisma.employee.create({
    data: { employeeNo: "E002", name: "李四", departmentId: dept.id },
  });

  const compCat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7", brand: "Intel", categoryId: compCat.id },
  });
  const ram = await prisma.componentModel.create({
    data: { name: "16GB", brand: "Kingston", categoryId: compCat.id },
  });

  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机", code: "DN" },
  });
  const cat2 = await prisma.assetCategory.create({
    data: { name: "网络设备", code: "WL" },
  });
  const template1 = await prisma.deviceTemplate.create({
    data: { name: "电脑", categoryId: assetCat.id },
  });
  const template2 = await prisma.deviceTemplate.create({
    data: { name: "路由器", categoryId: cat2.id },
  });

  // 创建不同状态的设备
  await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "电脑1", templateId: template1.id, status: "IDLE" },
  });
  await prisma.asset.create({
    data: { assetNo: "DN-0002", name: "电脑2", templateId: template1.id, status: "IN_USE", employeeId: emp1.id },
  });
  await prisma.asset.create({
    data: { assetNo: "DN-0003", name: "电脑3", templateId: template1.id, status: "IN_USE", employeeId: emp2.id },
  });
  await prisma.asset.create({
    data: { assetNo: "DN-0004", name: "电脑4", templateId: template1.id, status: "IN_MAINTENANCE" },
  });
  await prisma.asset.create({
    data: { assetNo: "DN-0005", name: "电脑5", templateId: template1.id, status: "SCRAPPED" },
  });
  await prisma.asset.create({
    data: { assetNo: "WL-0001", name: "路由器1", templateId: template2.id, status: "IN_USE", employeeId: emp1.id },
  });

  return { dept, emp1, emp2, cpu, ram, assetCat, cat2, template1, template2 };
}

describe("统计报表", () => {
  describe("getAssetStats — 按状态统计", () => {
    it("可以按设备状态分组统计", async () => {
      await setupStatsData();

      const result = await getAssetStats();

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.total).toBe(6);
      expect(data.byStatus.IDLE).toBe(1);
      expect(data.byStatus.IN_USE).toBe(3);
      expect(data.byStatus.IN_MAINTENANCE).toBe(1);
      expect(data.byStatus.SCRAPPED).toBe(1);
    });
  });

  describe("getAssetStats — 按分类统计", () => {
    it("可以按设备分类分组统计", async () => {
      await setupStatsData();

      const result = await getAssetStats({ groupBy: "category" });

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.byCategory).toBeDefined();
      expect(data.byCategory!.length).toBe(2);
    });
  });

  describe("getAssetStats — 按部门统计", () => {
    it("可以按部门分组统计（通过员工在用设备）", async () => {
      await setupStatsData();

      const result = await getAssetStats({ groupBy: "department" });

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.byDepartment).toBeDefined();
    });
  });

  describe("getStockStats — 配件库存统计", () => {
    it("可以统计所有配件型号的库存", async () => {
      const { cpu, ram } = await setupStatsData();
      await prisma.componentStock.upsert({
        where: { modelId: cpu.id },
        update: { quantity: 10 },
        create: { modelId: cpu.id, quantity: 10 },
      });
      await prisma.componentStock.upsert({
        where: { modelId: ram.id },
        update: { quantity: 20 },
        create: { modelId: ram.id, quantity: 20 },
      });

      const result = await getStockStats();

      expect(result.success).toBe(true);
      expect(result.data?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getLifecycleTrend — 流转趋势", () => {
    it("可以统计最近 N 个月的流转趋势", async () => {
      await setupStatsData();

      // 创建一些生命周期日志
      const asset1 = await prisma.asset.findFirst({ where: { assetNo: "DN-0001" } });
      await prisma.lifecycleLog.create({
        data: {
          assetId: asset1!.id,
          action: "ALLOCATED",
          fromStatus: "IDLE",
          toStatus: "IN_USE",
          operator: "admin",
        },
      });

      const result = await getLifecycleTrend({ months: 6 });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe("getAssetStats — 按员工统计", () => {
    it("可以按员工统计持有设备数", async () => {
      const { emp1, emp2 } = await setupStatsData();

      const result = await getAssetStats({ groupBy: "employee" });

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.byEmployee).toBeDefined();
      expect(data.byEmployee!.length).toBe(2);

      const emp1Stats = data.byEmployee!.find((e: any) => e.employeeId === emp1.id);
      expect(emp1Stats).toBeDefined();
      expect(emp1Stats!.count).toBe(2); // DN-0002 + WL-0001

      const emp2Stats = data.byEmployee!.find((e: any) => e.employeeId === emp2.id);
      expect(emp2Stats).toBeDefined();
      expect(emp2Stats!.count).toBe(1); // DN-0003
    });
  });
});
