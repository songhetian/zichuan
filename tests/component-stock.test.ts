import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  purchaseStockIn,
  upgradeReturnStockIn,
  assetBuildStockOut,
  upgradeUseStockOut,
  getStockLogs,
  getStockByModelId,
} from "@/actions/component-stock.actions";
import { createComponentCategory } from "@/actions/component-category.actions";
import { createComponentModel } from "@/actions/component-model.actions";
import { prisma } from "@/lib/prisma";

async function setupTestModel() {
  const cat = await createComponentCategory({ name: "CPU", parentId: null });
  const model = await createComponentModel({
    name: "i7-12700F",
    brand: "Intel",
    categoryId: unwrap(cat).id,
  });
  return unwrap(model);
}

describe("配件库存出入库", () => {
  describe("purchaseStockIn（采购入库）", () => {
    it("采购入库增加库存数量并记录流水", async () => {
      const model = await setupTestModel();

      const result = await purchaseStockIn({
        modelId: model.id,
        quantity: 10,
        operator: "admin",
        remark: "首批采购",
      });

      expect(result.success).toBe(true);

      // 检查库存
      const stock = await getStockByModelId(model.id);
      expect(stock.success).toBe(true);
      expect(unwrap(stock).quantity).toBe(10);

      // 检查流水
      const logs = await getStockLogs({ modelId: model.id });
      expect(logs.success).toBe(true);
      expect(unwrap(logs).length).toBe(1);
      expect(unwrap(logs)[0].type).toBe("PURCHASE_IN");
      expect(unwrap(logs)[0].quantity).toBe(10);
      expect(unwrap(logs)[0].operator).toBe("admin");
      expect(unwrap(logs)[0].remark).toBe("首批采购");
    });

    it("入库数量必须为正整数", async () => {
      const model = await setupTestModel();

      const result = await purchaseStockIn({
        modelId: model.id,
        quantity: 0,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("入库数量不能为负数", async () => {
      const model = await setupTestModel();

      const result = await purchaseStockIn({
        modelId: model.id,
        quantity: -5,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("型号不存在时入库失败", async () => {
      const result = await purchaseStockIn({
        modelId: 99999,
        quantity: 10,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("多次入库数量累加", async () => {
      const model = await setupTestModel();

      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: model.id, quantity: 5, operator: "admin" });

      const stock = await getStockByModelId(model.id);
      expect(unwrap(stock).quantity).toBe(15);
    });
  });

  describe("upgradeReturnStockIn（升级退回入库）", () => {
    it("升级退回的旧配件回库并记录流水", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });

      const result = await upgradeReturnStockIn({
        modelId: model.id,
        quantity: 1,
        operator: "admin",
        remark: "设备升级退回旧CPU",
      });

      expect(result.success).toBe(true);

      const stock = await getStockByModelId(model.id);
      expect(unwrap(stock).quantity).toBe(11);

      const logs = await getStockLogs({ modelId: model.id });
      const returnLog = unwrap(logs).find((l) => l.type === "UPGRADE_RETURN");
      expect(returnLog).toBeDefined();
      expect(returnLog?.quantity).toBe(1);
    });

    it("退回数量必须为正整数", async () => {
      const model = await setupTestModel();

      const result = await upgradeReturnStockIn({
        modelId: model.id,
        quantity: 0,
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("assetBuildStockOut（组装设备出库）", () => {
    it("组装设备扣减库存并记录流水", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });

      const result = await assetBuildStockOut({
        modelId: model.id,
        quantity: 3,
        operator: "admin",
        remark: "组装标准办公电脑 x3",
      });

      expect(result.success).toBe(true);

      const stock = await getStockByModelId(model.id);
      expect(unwrap(stock).quantity).toBe(7);

      const logs = await getStockLogs({ modelId: model.id });
      const outLog = unwrap(logs).find((l) => l.type === "ASSET_BUILD");
      expect(outLog).toBeDefined();
      expect(outLog?.quantity).toBe(-3);
    });

    it("库存不足时出库失败", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 5, operator: "admin" });

      const result = await assetBuildStockOut({
        modelId: model.id,
        quantity: 10,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存不足");
    });

    it("出库数量必须为正整数", async () => {
      const model = await setupTestModel();

      const result = await assetBuildStockOut({
        modelId: model.id,
        quantity: 0,
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });

    it("型号不存在时出库失败", async () => {
      const result = await assetBuildStockOut({
        modelId: 99999,
        quantity: 1,
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("upgradeUseStockOut（升级使用出库）", () => {
    it("升级使用新配件扣减库存并记录流水", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });

      const result = await upgradeUseStockOut({
        modelId: model.id,
        quantity: 1,
        operator: "admin",
        remark: "设备 DN-0001 升级 CPU",
      });

      expect(result.success).toBe(true);

      const stock = await getStockByModelId(model.id);
      expect(unwrap(stock).quantity).toBe(9);

      const logs = await getStockLogs({ modelId: model.id });
      const outLog = unwrap(logs).find((l) => l.type === "UPGRADE_USE");
      expect(outLog).toBeDefined();
      expect(outLog?.quantity).toBe(-1);
    });

    it("库存不足时升级使用失败", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 1, operator: "admin" });

      const result = await upgradeUseStockOut({
        modelId: model.id,
        quantity: 2,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存不足");
    });
  });

  describe("getStockLogs（库存流水查询）", () => {
    it("可以按型号筛选流水", async () => {
      const model1 = await setupTestModel();
      const cat = await createComponentCategory({ name: "内存", parentId: null });
      const model2 = await createComponentModel({
        name: "16GB DDR4",
        categoryId: unwrap(cat).id,
      });

      await purchaseStockIn({ modelId: model1.id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: unwrap(model2).id, quantity: 20, operator: "admin" });

      const logs = await getStockLogs({ modelId: model1.id });
      expect(logs.success).toBe(true);
      expect(unwrap(logs).length).toBe(1);
      expect(unwrap(logs)[0].modelId).toBe(model1.id);
    });

    it("可以按操作类型筛选", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });
      await assetBuildStockOut({ modelId: model.id, quantity: 3, operator: "admin" });

      const inLogs = await getStockLogs({ type: "PURCHASE_IN" });
      expect(unwrap(inLogs).length).toBe(1);
      expect(unwrap(inLogs)[0].type).toBe("PURCHASE_IN");
    });

    it("流水按时间倒序排列", async () => {
      const model = await setupTestModel();
      await purchaseStockIn({ modelId: model.id, quantity: 10, operator: "admin" });
      // 等 1ms 确保时间戳不同
      await new Promise((r) => setTimeout(r, 10));
      await purchaseStockIn({ modelId: model.id, quantity: 5, operator: "admin" });

      const logs = await getStockLogs({ modelId: model.id });
      expect(unwrap(logs).length).toBe(2);
      // 最新的在前，数量为 5 的是后入库的
      expect(unwrap(logs)[0].quantity).toBe(5);
      expect(unwrap(logs)[1].quantity).toBe(10);
    });

    it("没有流水时返回空数组", async () => {
      const model = await setupTestModel();

      const logs = await getStockLogs({ modelId: model.id });
      expect(unwrap(logs)).toEqual([]);
    });
  });

  describe("批量出入库（事务性）", () => {
    it("批量出库时如果任何一个库存不足，全部回滚", async () => {
      const cat = await createComponentCategory({ name: "CPU", parentId: null });
      const cpu = await createComponentModel({
        name: "i7",
        categoryId: unwrap(cat).id,
      });
      const ram = await createComponentModel({
        name: "16GB",
        categoryId: unwrap(cat).id, // 先凑合，实际分类不同
      });

      await purchaseStockIn({ modelId: unwrap(cpu).id, quantity: 10, operator: "admin" });
      await purchaseStockIn({ modelId: unwrap(ram).id, quantity: 1, operator: "admin" }); // 只有 1 条内存

      // 模拟组装 3 台设备，需要 3 条内存，但只有 1 条
      // 直接调用事务性的批量出库函数
      const result = await batchStockOut([
        { modelId: unwrap(cpu).id, quantity: 3, type: "ASSET_BUILD" as const },
        { modelId: unwrap(ram).id, quantity: 3, type: "ASSET_BUILD" as const },
      ], "admin", "组装设备");

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("库存不足");

      // 验证 CPU 库存也没有被扣减（事务回滚）
      const cpuStock = await getStockByModelId(unwrap(cpu).id);
      expect(unwrap(cpuStock).quantity).toBe(10);
    });
  });
});

// 测试批量出库（需要从 action 文件导入）
import { batchStockOut } from "@/actions/component-stock.actions";
