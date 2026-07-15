import { describe, it, expect } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createAssetCategory,
  getAssetCategories,
  getAssetCategoryById,
  updateAssetCategory,
  deleteAssetCategory,
} from "@/actions/asset-category.actions";
import { prisma } from "@/lib/prisma";

describe("设备分类 CRUD", () => {
  describe("createAssetCategory", () => {
    it("可以创建一级分类", async () => {
      const result = await createAssetCategory({
        name: "计算机设备",
        code: "DN",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("计算机设备");
      expect(unwrap(result).code).toBe("DN");
    });

    it("可以创建二级子分类", async () => {
      const parent = await createAssetCategory({ name: "计算机设备", code: "DN" });
      const child = await createAssetCategory({
        name: "笔记本电脑",
        code: "NB",
        parentId: unwrap(parent).id,
      });

      expect(child.success).toBe(true);
      expect(unwrap(child).parentId).toBe(unwrap(parent).id);
    });

    it("分类名称不能重复", async () => {
      await createAssetCategory({ name: "计算机", code: "A" });
      const result = await createAssetCategory({ name: "计算机", code: "B" });
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已存在");
    });

    it("分类编码不能重复", async () => {
      await createAssetCategory({ name: "计算机", code: "DN" });
      const result = await createAssetCategory({ name: "服务器", code: "DN" });
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("编码已存在");
    });

    it("名称不能为空，编码为空时自动生成", async () => {
      const r1 = await createAssetCategory({ name: "", code: "DN" });
      expect(r1.success).toBe(false);

      const r2 = await createAssetCategory({ name: "测试", code: "" });
      expect(r2.success).toBe(true);
      expect(unwrap(r2).code).toBeTruthy();
    });
  });

  describe("getAssetCategories", () => {
    it("可以获取全部分类列表", async () => {
      await createAssetCategory({ name: "计算机", code: "DN" });
      await createAssetCategory({ name: "网络", code: "WL" });

      const result = await getAssetCategories();
      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(2);
    });
  });

  describe("getAssetCategoryById", () => {
    it("可以根据 ID 获取分类", async () => {
      const created = await createAssetCategory({ name: "计算机", code: "DN" });
      const result = await getAssetCategoryById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("计算机");
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getAssetCategoryById(99999);
      expect(result.success).toBe(false);
    });
  });

  describe("updateAssetCategory", () => {
    it("可以更新分类名称和编码", async () => {
      const created = await createAssetCategory({ name: "旧名称", code: "OLD" });
      const result = await updateAssetCategory(unwrap(created).id, {
        name: "新名称",
        code: "NEW",
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("新名称");
      expect(unwrap(result).code).toBe("NEW");
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateAssetCategory(99999, { name: "测试" });
      expect(result.success).toBe(false);
    });
  });

  describe("deleteAssetCategory", () => {
    it("可以删除没有子分类和模板的分类", async () => {
      const created = await createAssetCategory({ name: "待删除", code: "DEL" });
      const result = await deleteAssetCategory(unwrap(created).id);

      expect(result.success).toBe(true);
      const check = await prisma.assetCategory.findUnique({ where: { id: unwrap(created).id } });
      expect(check).toBeNull();
    });

    it("有子分类时删除失败", async () => {
      const parent = await createAssetCategory({ name: "父", code: "P" });
      await createAssetCategory({ name: "子", code: "C", parentId: unwrap(parent).id });

      const result = await deleteAssetCategory(unwrap(parent).id);
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("子分类");
    });

    it("有关联设备模板时删除失败", async () => {
      const cat = await createAssetCategory({ name: "计算机", code: "DN" });
      await prisma.deviceTemplate.create({
        data: { name: "测试模板", categoryId: unwrap(cat).id },
      });

      const result = await deleteAssetCategory(unwrap(cat).id);
      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("模板");
    });
  });
});
