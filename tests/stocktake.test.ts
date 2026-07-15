import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createStocktakeSession,
  getStocktakeSessions,
  getStocktakeSessionById,
  updateStocktakeRecord,
  completeStocktakeSession,
} from "@/actions/stocktake.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupAssetData() {
  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机", code: "DN" },
  });
  const template = await prisma.deviceTemplate.create({
    data: { name: "标准电脑", categoryId: assetCat.id },
  });

  const a1 = await prisma.asset.create({
    data: { assetNo: "DN-0001", name: "电脑1", templateId: template.id, status: "IDLE" },
  });
  const a2 = await prisma.asset.create({
    data: { assetNo: "DN-0002", name: "电脑2", templateId: template.id, status: "IN_USE" },
  });
  const a3 = await prisma.asset.create({
    data: { assetNo: "DN-0003", name: "电脑3", templateId: template.id, status: "IDLE" },
  });

  return { assetCat, template, assets: [a1, a2, a3] };
}

describe("库存盘点", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("createStocktakeSession", () => {
    it("可以创建盘点任务并自动生成盘点明细", async () => {
      const { assets } = await setupAssetData();

      const result = await createStocktakeSession({
        name: "月度盘点",
        description: "2026年7月盘点",
        operator: "admin",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("月度盘点");
      expect(unwrap(result).status).toBe("OPEN");

      // 验证明细记录数量
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(result).id },
      });
      expect(records).toHaveLength(3);
      expect(records.every((r) => r.actualStatus === "NORMAL")).toBe(true);
    });

    it("可以指定按状态筛选盘点范围", async () => {
      const { assets } = await setupAssetData();

      // 只盘闲置设备
      const result = await createStocktakeSession({
        name: "闲置盘点",
        operator: "admin",
        statusFilter: "IDLE",
      });

      expect(result.success).toBe(true);
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(result).id },
      });
      expect(records).toHaveLength(2); // DN-0001 和 DN-0003 是 IDLE
    });

    it("可以按设备分类筛选盘点范围", async () => {
      const { template } = await setupAssetData();

      // 创建第二个分类和模板
      const cat2 = await prisma.assetCategory.create({
        data: { name: "网络设备", code: "WL" },
      });
      const template2 = await prisma.deviceTemplate.create({
        data: { name: "交换机", categoryId: cat2.id },
      });
      const a4 = await prisma.asset.create({
        data: { assetNo: "WL-0001", name: "交换机1", templateId: template2.id, status: "IDLE" },
      });

      // 只盘网络设备分类
      const result = await createStocktakeSession({
        name: "网络设备盘点",
        operator: "admin",
        categoryId: cat2.id,
      });

      expect(result.success).toBe(true);
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(result).id },
      });
      expect(records).toHaveLength(1);
    });

    it("可以按部门筛选盘点范围", async () => {
      const { template } = await setupAssetData();

      // 创建部门和员工，把一台设备分配给该员工
      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
      });
      // DN-0002 是 IN_USE 状态，需要设 employeeId
      await prisma.asset.update({
        where: { assetNo: "DN-0002" },
        data: { employeeId: emp.id },
      });

      // 只盘技术部的设备
      const result = await createStocktakeSession({
        name: "技术部盘点",
        operator: "admin",
        departmentId: dept.id,
      });

      expect(result.success).toBe(true);
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(result).id },
      });
      expect(records).toHaveLength(1); // 只有 DN-0002 属于技术部员工
    });

    it("可以组合按状态和分类筛选", async () => {
      const { template } = await setupAssetData();

      const cat = await prisma.assetCategory.findFirst();
      // 只盘分类下闲置的设备
      const result = await createStocktakeSession({
        name: "分类闲置盘点",
        operator: "admin",
        categoryId: cat!.id,
        statusFilter: "IDLE",
      });

      expect(result.success).toBe(true);
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(result).id },
      });
      expect(records).toHaveLength(2); // DN-0001 和 DN-0003
    });
  });

  describe("getStocktakeSessions", () => {
    it("可以获取全部盘点任务列表", async () => {
      await setupAssetData();
      await createStocktakeSession({ name: "盘点1", operator: "admin" });
      await createStocktakeSession({ name: "盘点2", operator: "admin" });

      const result = await getStocktakeSessions();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });
  });

  describe("getStocktakeSessionById", () => {
    it("可以获取盘点任务详情（含明细）", async () => {
      const { assets } = await setupAssetData();
      const created = await createStocktakeSession({ name: "测试", operator: "admin" });

      const result = await getStocktakeSessionById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("测试");
      expect(unwrap(result).records).toHaveLength(3);
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getStocktakeSessionById(99999);
      expect(result.success).toBe(false);
    });
  });

  describe("updateStocktakeRecord", () => {
    it("可以标记设备为盘亏", async () => {
      const { assets } = await setupAssetData();
      const session = await createStocktakeSession({ name: "测试", operator: "admin" });
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(session).id },
      });

      const result = await updateStocktakeRecord(records[0].id, {
        actualStatus: "MISSING",
        remark: "找不到设备",
      });

      expect(result.success).toBe(true);
      const updated = await prisma.stocktakeRecord.findUnique({
        where: { id: records[0].id },
      });
      expect(updated?.actualStatus).toBe("MISSING");
      expect(updated?.remark).toBe("找不到设备");
    });

    it("可以标记设备为正常", async () => {
      const { assets } = await setupAssetData();
      const session = await createStocktakeSession({ name: "测试", operator: "admin" });
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(session).id },
      });

      // 所有记录初始为 NORMAL，再设 NORMAL 也是合法的
      const result = await updateStocktakeRecord(records[0].id, {
        actualStatus: "NORMAL",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("completeStocktakeSession", () => {
    it("可以完成盘点并统计盘盈盘亏", async () => {
      const { assets } = await setupAssetData();
      const session = await createStocktakeSession({ name: "测试", operator: "admin" });
      const records = await prisma.stocktakeRecord.findMany({
        where: { sessionId: unwrap(session).id },
      });

      // 标记第一台为盘亏
      await updateStocktakeRecord(records[0].id, { actualStatus: "MISSING" });

      const result = await completeStocktakeSession(unwrap(session).id);

      expect(result.success).toBe(true);

      // 验证状态
      const updated = await prisma.stocktakeSession.findUnique({
        where: { id: unwrap(session).id },
      });
      expect(updated?.status).toBe("COMPLETED");
      expect(updated?.completedAt).not.toBeNull();
    });

    it("未完成的任务不能重复完成", async () => {
      const { assets } = await setupAssetData();
      const session = await createStocktakeSession({ name: "测试", operator: "admin" });

      await completeStocktakeSession(unwrap(session).id);

      const result = await completeStocktakeSession(unwrap(session).id);
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已完成");
    });
  });
});
