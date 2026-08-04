import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { createAssetCategory } from "@/actions/asset-category.actions";
import { createComponentCategory } from "@/actions/component-category.actions";
import { createComponentModel } from "@/actions/component-model.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { batchCreateAssets, getAssets } from "@/actions/asset.actions";
import { unwrap } from "./helpers";

// ============================================================
// 测试 seam：batchCreateAssets — 批量入库生成 IN_STOCK 设备
// ============================================================

let _counter = 0;

async function setupTemplate(categoryCode = "DN") {
  const assetCat = await createAssetCategory({
    name: `批量入库分类_${Date.now()}_${++_counter}`,
    code: categoryCode,
  });
  const cat = unwrap(assetCat);

  const compCat = await createComponentCategory({ name: `CPU_${Date.now()}_${++_counter}` });
  const cpuCat = unwrap(compCat);
  const cpu = await createComponentModel({
    name: "i5-12400",
    brand: "Intel",
    categoryId: cpuCat.id,
  });
  const cpuModel = unwrap(cpu);
  await purchaseStockIn({ modelId: cpuModel.id, quantity: 100, operator: "admin" });

  const template = await prisma.deviceTemplate.create({
    data: {
      name: `批量入库模板_${Date.now()}_${_counter}`,
      categoryId: cat.id,
      components: {
        create: [{ modelId: cpuModel.id, quantity: 1 }],
      },
    },
  });

  return { category: cat, template };
}

describe("批量入库", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("batchCreateAssets", () => {
    it("批量创建 5 台设备，全部为 IN_STOCK 状态", async () => {
      const { template } = await setupTemplate("DN");

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 5,
        operator: "admin",
      });
      const assets = unwrap(result);

      expect(assets).toHaveLength(5);
      for (const asset of assets) {
        expect(asset.status).toBe("IN_STOCK");
      }
    });

    it("生成的设备编号连续递增", async () => {
      const { template, category } = await setupTemplate("PC");

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 3,
        operator: "admin",
      });
      const assets = unwrap(result);

      expect(assets[0].assetNo).toBe("PC-0001");
      expect(assets[1].assetNo).toBe("PC-0002");
      expect(assets[2].assetNo).toBe("PC-0003");
    });

    it("批量入库不扣减配件库存", async () => {
      const { template, category } = await setupTemplate("WL");

      // 记录配件库存初始值
      const stockBefore = await prisma.componentStock.findMany();
      const stockMap = new Map(stockBefore.map((s) => [s.modelId, s.quantity]));

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 10,
        operator: "admin",
      });
      expect(result.success).toBe(true);

      // 验证配件库存未变化
      const stockAfter = await prisma.componentStock.findMany();
      for (const s of stockAfter) {
        const before = stockMap.get(s.modelId) ?? 0;
        expect(s.quantity).toBe(before);
      }
    });

    it("设备不绑定员工，employeeId 为 null", async () => {
      const { template } = await setupTemplate("NB");

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 2,
        operator: "admin",
      });
      const assets = unwrap(result);

      for (const asset of assets) {
        expect(asset.employeeId).toBeNull();
      }
    });

    it("每台设备复制模板 BOM 配件（仅记录配置，不扣减库存）", async () => {
      const { template } = await setupTemplate("SV");

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 2,
        operator: "admin",
      });
      const assets = unwrap(result);

      for (const asset of assets) {
        const comps = await prisma.assetComponent.findMany({
          where: { assetId: asset.id },
        });
        expect(comps.length).toBe(1);
      }
    });

    it("模板不存在时返回错误", async () => {
      const result = await batchCreateAssets({
        templateId: 99999,
        count: 1,
        operator: "admin",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("设备模板不存在");
      }
    });

    it("count 为 0 时返回错误", async () => {
      const { template } = await setupTemplate("ER");

      const result = await batchCreateAssets({
        templateId: template.id,
        count: 0,
        operator: "admin",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("getAssets 按 IN_STOCK 筛选", () => {
    it("status=IN_STOCK 只返回库存设备", async () => {
      const { template } = await setupTemplate("FL");

      // 批量入库 3 台
      await batchCreateAssets({
        templateId: template.id,
        count: 3,
        operator: "admin",
      });

      const result = await getAssets({ status: "IN_STOCK" });
      const assets = unwrap(result);

      expect(assets.length).toBeGreaterThanOrEqual(3);
      for (const asset of assets) {
        expect(asset.status).toBe("IN_STOCK");
      }
    });
  });
});