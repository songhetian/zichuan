import { describe, it, expect } from "vitest";
import {
  createComponentCategory,
  getComponentCategories,
  getComponentCategoryById,
  updateComponentCategory,
  deleteComponentCategory,
} from "@/actions/component-category.actions";
import { prisma } from "@/lib/prisma";

describe("配件分类 CRUD", () => {
  describe("createComponentCategory", () => {
    it("可以创建一级分类", async () => {
      const result = await createComponentCategory({
        name: "存储设备",
        parentId: null,
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("存储设备");
      expect(result.data?.parentId).toBeNull();
    });

    it("可以创建二级子分类", async () => {
      const parent = await createComponentCategory({
        name: "存储设备",
        parentId: null,
      });

      const child = await createComponentCategory({
        name: "固态硬盘",
        parentId: parent.data!.id,
      });

      expect(child.success).toBe(true);
      expect(child.data?.name).toBe("固态硬盘");
      expect(child.data?.parentId).toBe(parent.data!.id);
    });

    it("分类名称不能重复", async () => {
      await createComponentCategory({ name: "CPU", parentId: null });
      const result = await createComponentCategory({
        name: "CPU",
        parentId: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("名称不能为空", async () => {
      const result = await createComponentCategory({
        name: "",
        parentId: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("父分类不存在时创建失败", async () => {
      const result = await createComponentCategory({
        name: "CPU",
        parentId: 99999,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("getComponentCategories", () => {
    it("可以获取全部分类列表", async () => {
      await createComponentCategory({ name: "CPU", parentId: null });
      await createComponentCategory({ name: "内存", parentId: null });

      const result = await getComponentCategories();

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it("空数据库返回空数组", async () => {
      const result = await getComponentCategories();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("getComponentCategoryById", () => {
    it("可以根据 ID 获取分类详情", async () => {
      const created = await createComponentCategory({
        name: "CPU",
        parentId: null,
      });

      const result = await getComponentCategoryById(created.data!.id);

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("CPU");
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getComponentCategoryById(99999);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("updateComponentCategory", () => {
    it("可以更新分类名称", async () => {
      const created = await createComponentCategory({
        name: "旧名称",
        parentId: null,
      });

      const result = await updateComponentCategory(created.data!.id, {
        name: "新名称",
      });

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("新名称");
    });

    it("更新名称不能与已有分类重复", async () => {
      await createComponentCategory({ name: "CPU", parentId: null });
      const target = await createComponentCategory({
        name: "内存",
        parentId: null,
      });

      const result = await updateComponentCategory(target.data!.id, {
        name: "CPU",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateComponentCategory(99999, {
        name: "测试",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("deleteComponentCategory", () => {
    it("可以删除没有子分类和型号的分类", async () => {
      const created = await createComponentCategory({
        name: "待删除",
        parentId: null,
      });

      const result = await deleteComponentCategory(created.data!.id);

      expect(result.success).toBe(true);

      const check = await prisma.componentCategory.findUnique({
        where: { id: created.data!.id },
      });
      expect(check).toBeNull();
    });

    it("有子分类时删除失败", async () => {
      const parent = await createComponentCategory({
        name: "父分类",
        parentId: null,
      });
      await createComponentCategory({
        name: "子分类",
        parentId: parent.data!.id,
      });

      const result = await deleteComponentCategory(parent.data!.id);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("有关联配件型号时删除失败", async () => {
      const cat = await createComponentCategory({
        name: "CPU",
        parentId: null,
      });

      // 直接用 prisma 创建型号（因为型号 action 还没写）
      await prisma.componentModel.create({
        data: {
          name: "i7-12700",
          categoryId: cat.data!.id,
        },
      });

      const result = await deleteComponentCategory(cat.data!.id);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteComponentCategory(99999);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
