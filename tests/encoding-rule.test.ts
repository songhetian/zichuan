import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { createAssetCategory } from "@/actions/asset-category.actions";
import { createAsset } from "@/actions/asset.actions";
import { createComponentCategory } from "@/actions/component-category.actions";
import { createComponentModel } from "@/actions/component-model.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { unwrap } from "./helpers";

// ============================================================
// 测试 seam：编码规则 — generateAssetNo 模板语法
// ============================================================

let _counter = 0;
async function setupTemplate(categoryCode = "DN") {
  const assetCat = await createAssetCategory({
    name: `测试分类_${Date.now()}_${++_counter}`,
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
      name: `测试模板_${Date.now()}`,
      categoryId: cat.id,
      components: {
        create: [{ modelId: cpuModel.id, quantity: 1 }],
      },
    },
  });

  return { category: cat, template };
}

describe("编码规则", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("默认规则（无 numberingRule）", () => {
    it("默认规则为 {prefix}-{####}，生成 4 位序号", async () => {
      const { template, category } = await setupTemplate("DN");

      const a1 = await createAsset({ templateId: template.id, name: "设备1", operator: "admin" });
      const a2 = await createAsset({ templateId: template.id, name: "设备2", operator: "admin" });

      expect(unwrap(a1).assetNo).toMatch(/^DN-\d{4}$/);
      expect(unwrap(a2).assetNo).toMatch(/^DN-\d{4}$/);
    });

    it("序号从 0001 开始递增", async () => {
      const { template } = await setupTemplate("PC");

      const a1 = await createAsset({ templateId: template.id, name: "设备1", operator: "admin" });
      const a2 = await createAsset({ templateId: template.id, name: "设备2", operator: "admin" });
      const a3 = await createAsset({ templateId: template.id, name: "设备3", operator: "admin" });

      expect(unwrap(a1).assetNo).toBe("PC-0001");
      expect(unwrap(a2).assetNo).toBe("PC-0002");
      expect(unwrap(a3).assetNo).toBe("PC-0003");
    });

    it("不同分类的编号独立计数", async () => {
      const { template: t1 } = await setupTemplate("DN");
      const { template: t2 } = await setupTemplate("NB");

      const a1 = await createAsset({ templateId: t1.id, name: "设备1", operator: "admin" });
      const a2 = await createAsset({ templateId: t2.id, name: "设备2", operator: "admin" });

      expect(unwrap(a1).assetNo).toBe("DN-0001");
      expect(unwrap(a2).assetNo).toBe("NB-0001");
    });
  });

  describe("日期模板规则", () => {
    it("{prefix}-{YYYY}{MM}{DD}-{####} 生成含日期的编号", async () => {
      // 先创建分类，再手动设置 numberingRule
      const assetCat = await createAssetCategory({
        name: `日期规则_${Date.now()}`,
        code: "DN",
      });
      const cat = unwrap(assetCat);

      // 设置编号规则
      await prisma.assetCategory.update({
        where: { id: cat.id },
        data: { numberingRule: "{prefix}-{YYYY}{MM}{DD}-{####}" },
      });

      const { template } = await setupTemplateWithCategory(cat);

      const a1 = await createAsset({ templateId: template.id, name: "设备1", operator: "admin" });
      const no = unwrap(a1).assetNo;

      const today = new Date();
      const y = today.getFullYear().toString();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");

      expect(no).toBe(`DN-${y}${m}${d}-0001`);
    });

    it("{prefix}-{YYYY}-{####} 生成年份编号", async () => {
      const assetCat = await createAssetCategory({
        name: `年份规则_${Date.now()}`,
        code: "PC",
      });
      const cat = unwrap(assetCat);

      await prisma.assetCategory.update({
        where: { id: cat.id },
        data: { numberingRule: "{prefix}-{YYYY}-{####}" },
      });

      const { template } = await setupTemplateWithCategory(cat);

      const a1 = await createAsset({ templateId: template.id, name: "设备1", operator: "admin" });
      const no = unwrap(a1).assetNo;

      const y = new Date().getFullYear().toString();
      expect(no).toBe(`PC-${y}-0001`);
    });
  });

  describe("自定义位数", () => {
    it("{####} 支持自定义位数（如 6 位）", async () => {
      const assetCat = await createAssetCategory({
        name: `6位序号_${Date.now()}`,
        code: "WL",
      });
      const cat = unwrap(assetCat);

      await prisma.assetCategory.update({
        where: { id: cat.id },
        data: { numberingRule: "{prefix}-{######}" },
      });

      const { template } = await setupTemplateWithCategory(cat);

      const a1 = await createAsset({ templateId: template.id, name: "设备1", operator: "admin" });
      expect(unwrap(a1).assetNo).toMatch(/^WL-\d{6}$/);
      expect(unwrap(a1).assetNo).toBe("WL-000001");
    });
  });
});

// 用已有分类创建模板
async function setupTemplateWithCategory(cat: { id: number; code: string }) {
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
      name: `测试模板_${Date.now()}`,
      categoryId: cat.id,
      components: {
        create: [{ modelId: cpuModel.id, quantity: 1 }],
      },
    },
  });

  return { category: cat, template };
}