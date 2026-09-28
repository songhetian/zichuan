import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap } from "./helpers";
import { getStockReconciliation } from "@/actions/stats.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupModel(stockQty: number) {
  const cat = await prisma.componentCategory.create({ data: { name: "CPU" } });
  const model = await prisma.componentModel.create({
    data: { name: "i7", brand: "Intel", categoryId: cat.id },
  });
  await prisma.componentStock.create({ data: { modelId: model.id, quantity: stockQty } });
  return { cat, model };
}

async function addLog(modelId: number, type: "PURCHASE_IN" | "UPGRADE_RETURN" | "ASSET_BUILD" | "UPGRADE_USE", quantity: number) {
  await prisma.componentStockLog.create({
    data: { modelId, type, quantity, operator: "admin" },
  });
}

describe("出入库流水对账", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage"] });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("getStockReconciliation", () => {
    it("按型号汇总出入库流水签量，并与实际结存对比给出差异", async () => {
      const { model } = await setupModel(5);
      // 流水：入库 +10、出库 -3、退回 +2 → 流水结存 = 9，当前库存 = 5 → 差异 -4（账面少于流水）
      await addLog(model.id, "PURCHASE_IN", 10);
      await addLog(model.id, "ASSET_BUILD", -3);
      await addLog(model.id, "UPGRADE_RETURN", 2);

      const result = await getStockReconciliation();
      expect(result.success).toBe(true);
      const data = unwrap(result);

      const row = data.rows.find((r) => r.modelId === model.id)!;
      expect(row.loggedBalance).toBe(9);
      expect(row.stockQuantity).toBe(5);
      expect(row.difference).toBe(-4);
      expect(row.isBalanced).toBe(false);
      expect(data.matchedCount).toBe(0);
      expect(data.discrepantCount).toBe(1);
    });

    it("流水结存与实际一致时判定为已对平", async () => {
      const { model } = await setupModel(7);
      await addLog(model.id, "PURCHASE_IN", 10);
      await addLog(model.id, "ASSET_BUILD", -3);

      const result = await getStockReconciliation();
      expect(result.success).toBe(true);
      const data = unwrap(result);

      const row = data.rows.find((r) => r.modelId === model.id)!;
      expect(row.loggedBalance).toBe(7);
      expect(row.difference).toBe(0);
      expect(row.isBalanced).toBe(true);
      expect(data.matchedCount).toBe(1);
      expect(data.discrepantCount).toBe(0);
    });
  });
});