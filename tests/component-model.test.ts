import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createComponentModel,
  getComponentModels,
  getComponentModelById,
  updateComponentModel,
  deleteComponentModel,
} from "@/actions/component-model.actions";
import { createComponentCategory } from "@/actions/component-category.actions";
import { prisma } from "@/lib/prisma";

async function createTestCategory(name = "CPU") {
  const result = await createComponentCategory({ name, parentId: null });
  return unwrap(result);
}

describe("配件型号 CRUD", () => {
  describe("createComponentModel", () => {
    it("可以创建配件型号并自动初始化库存为 0", async () => {
      const cat = await createTestCategory();

      const result = await createComponentModel({
        name: "i7-12700F",
        brand: "Intel",
        categoryId: cat.id,
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("i7-12700F");
      expect(unwrap(result).brand).toBe("Intel");
      expect(unwrap(result).categoryId).toBe(cat.id);
      expect(unwrap(result).stock).toBe(0);
    });

    it("同一分类下型号名称不能重复", async () => {
      const cat = await createTestCategory();

      await createComponentModel({
        name: "i7-12700F",
        categoryId: cat.id,
      });
      const result = await createComponentModel({
        name: "i7-12700F",
        categoryId: cat.id,
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("不同分类下可以有相同名称的型号", async () => {
      const cat1 = await createTestCategory("CPU");
      const cat2 = await createTestCategory("内存");

      const r1 = await createComponentModel({
        name: "16GB",
        categoryId: cat1.id,
      });
      const r2 = await createComponentModel({
        name: "16GB",
        categoryId: cat2.id,
      });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it("型号名称不能为空", async () => {
      const cat = await createTestCategory();

      const result = await createComponentModel({
        name: "",
        categoryId: cat.id,
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("分类不存在时创建失败", async () => {
      const result = await createComponentModel({
        name: "i7",
        categoryId: 99999,
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });
  });

  describe("getComponentModels", () => {
    it("可以获取全部型号列表", async () => {
      const cat = await createTestCategory();
      await createComponentModel({ name: "i5", categoryId: cat.id });
      await createComponentModel({ name: "i7", categoryId: cat.id });

      const result = await getComponentModels();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });

    it("可以按分类筛选", async () => {
      const cat1 = await createTestCategory("CPU");
      const cat2 = await createTestCategory("内存");
      await createComponentModel({ name: "i5", categoryId: cat1.id });
      await createComponentModel({ name: "i7", categoryId: cat1.id });
      await createComponentModel({ name: "16GB", categoryId: cat2.id });

      const result = await getComponentModels({ categoryId: cat1.id });

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
      expect(unwrap(result).every((m) => m.categoryId === cat1.id)).toBe(true);
    });

    it("可以按关键词搜索（型号名或品牌）", async () => {
      const cat = await createTestCategory();
      await createComponentModel({ name: "i7-12700F", brand: "Intel", categoryId: cat.id });
      await createComponentModel({ name: "Ryzen 7", brand: "AMD", categoryId: cat.id });
      await createComponentModel({ name: "i5-12400F", brand: "Intel", categoryId: cat.id });

      const result = await getComponentModels({ keyword: "Intel" });

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });

    it("空数据库返回空数组", async () => {
      const result = await getComponentModels();

      expect(result.success).toBe(true);
      expect(unwrap(result)).toEqual([]);
    });
  });

  describe("getComponentModelById", () => {
    it("可以根据 ID 获取型号详情", async () => {
      const cat = await createTestCategory();
      const created = await createComponentModel({
        name: "i7-12700F",
        brand: "Intel",
        categoryId: cat.id,
      });

      const result = await getComponentModelById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("i7-12700F");
      expect(unwrap(result).brand).toBe("Intel");
      expect(unwrap(result).stock).toBe(0);
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getComponentModelById(99999);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });
  });

  describe("updateComponentModel", () => {
    it("可以更新型号名称和品牌", async () => {
      const cat = await createTestCategory();
      const created = await createComponentModel({
        name: "旧型号",
        brand: "旧品牌",
        categoryId: cat.id,
      });

      const result = await updateComponentModel(unwrap(created).id, {
        name: "新型号",
        brand: "新品牌",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("新型号");
      expect(unwrap(result).brand).toBe("新品牌");
    });

    it("同一分类下更新名称不能与已有型号重复", async () => {
      const cat = await createTestCategory();
      await createComponentModel({ name: "i5", categoryId: cat.id });
      const target = await createComponentModel({
        name: "i7",
        categoryId: cat.id,
      });

      const result = await updateComponentModel(unwrap(target).id, {
        name: "i5",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("可以更改所属分类", async () => {
      const cat1 = await createTestCategory("CPU");
      const cat2 = await createTestCategory("内存");
      const created = await createComponentModel({
        name: "测试型号",
        categoryId: cat1.id,
      });

      const result = await updateComponentModel(unwrap(created).id, {
        categoryId: cat2.id,
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).categoryId).toBe(cat2.id);
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateComponentModel(99999, {
        name: "测试",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });
  });

  describe("deleteComponentModel", () => {
    it("可以删除没有库存流水的型号", async () => {
      const cat = await createTestCategory();
      const created = await createComponentModel({
        name: "待删除",
        categoryId: cat.id,
      });

      const result = await deleteComponentModel(unwrap(created).id);

      expect(result.success).toBe(true);

      const model = await prisma.componentModel.findUnique({
        where: { id: unwrap(created).id },
      });
      expect(model).toBeNull();

      // 关联的库存记录也应该被删除
      const stock = await prisma.componentStock.findUnique({
        where: { modelId: unwrap(created).id },
      });
      expect(stock).toBeNull();
    });

    it("有库存流水时不能删除", async () => {
      const cat = await createTestCategory();
      const created = await createComponentModel({
        name: "有流水",
        categoryId: cat.id,
      });

      // 直接用 prisma 创建一条流水记录
      await prisma.componentStockLog.create({
        data: {
          modelId: unwrap(created).id,
          type: "PURCHASE_IN",
          quantity: 10,
          operator: "admin",
        },
      });

      const result = await deleteComponentModel(unwrap(created).id);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteComponentModel(99999);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toBeDefined();
    });
  });
});
