import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createDeviceTemplate,
  getDeviceTemplates,
  getDeviceTemplateById,
  updateDeviceTemplate,
  deleteDeviceTemplate,
} from "@/actions/device-template.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

async function setupTestData() {
  const assetCat = await prisma.assetCategory.create({
    data: { name: "计算机设备", code: "DN" },
  });
  const compCat = await prisma.componentCategory.create({
    data: { name: "CPU" },
  });
  const cpu = await prisma.componentModel.create({
    data: { name: "i7-12700F", brand: "Intel", categoryId: compCat.id },
  });
  const ram = await prisma.componentModel.create({
    data: { name: "16GB DDR4", brand: "金士顿", categoryId: compCat.id },
  });
  return { assetCat, compCat, cpu, ram };
}

describe("设备模板 CRUD", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("createDeviceTemplate", () => {
    it("可以创建带有 BOM 配件清单的设备模板", async () => {
      const { assetCat, cpu, ram } = await setupTestData();

      const result = await createDeviceTemplate({
        name: "标准办公电脑",
        categoryId: assetCat.id,
        components: [
          { modelId: cpu.id, quantity: 1 },
          { modelId: ram.id, quantity: 2 },
        ],
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("标准办公电脑");
      expect(unwrap(result).categoryId).toBe(assetCat.id);
      expect(unwrap(result).components).toHaveLength(2);
      expect(unwrap(result).components[0].quantity).toBe(1);
      expect(unwrap(result).components[1].quantity).toBe(2);
    });

    it("可以创建没有配件清单的空模板", async () => {
      const { assetCat } = await setupTestData();

      const result = await createDeviceTemplate({
        name: "空模板",
        categoryId: assetCat.id,
        components: [],
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).components).toHaveLength(0);
    });

    it("同一分类下模板名称不能重复", async () => {
      const { assetCat } = await setupTestData();

      await createDeviceTemplate({
        name: "标准办公电脑",
        categoryId: assetCat.id,
        components: [],
      });
      const result = await createDeviceTemplate({
        name: "标准办公电脑",
        categoryId: assetCat.id,
        components: [],
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已存在");
    });

    it("不同分类下可以有相同名称的模板", async () => {
      const { assetCat } = await setupTestData();
      const cat2 = await prisma.assetCategory.create({
        data: { name: "网络设备", code: "WL" },
      });

      const r1 = await createDeviceTemplate({
        name: "标准配置",
        categoryId: assetCat.id,
        components: [],
      });
      const r2 = await createDeviceTemplate({
        name: "标准配置",
        categoryId: cat2.id,
        components: [],
      });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it("模板名称不能为空", async () => {
      const { assetCat } = await setupTestData();

      const result = await createDeviceTemplate({
        name: "",
        categoryId: assetCat.id,
        components: [],
      });

      expect(result.success).toBe(false);
    });

    it("分类不存在时创建失败", async () => {
      const result = await createDeviceTemplate({
        name: "测试",
        categoryId: 99999,
        components: [],
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("分类不存在");
    });

    it("BOM 中包含不存在的配件型号时创建失败", async () => {
      const { assetCat } = await setupTestData();

      const result = await createDeviceTemplate({
        name: "测试",
        categoryId: assetCat.id,
        components: [{ modelId: 99999, quantity: 1 }],
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("配件型号不存在");
    });

    it("BOM 中配件数量必须为正整数", async () => {
      const { assetCat, cpu } = await setupTestData();

      const result = await createDeviceTemplate({
        name: "测试",
        categoryId: assetCat.id,
        components: [{ modelId: cpu.id, quantity: 0 }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("getDeviceTemplates", () => {
    it("可以获取全部模板列表（含 BOM 明细）", async () => {
      const { assetCat, cpu } = await setupTestData();
      await createDeviceTemplate({
        name: "标准办公电脑",
        categoryId: assetCat.id,
        components: [{ modelId: cpu.id, quantity: 1 }],
      });

      const result = await getDeviceTemplates();

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].components).toHaveLength(1);
    });

    it("可以按分类筛选", async () => {
      const { assetCat } = await setupTestData();
      const cat2 = await prisma.assetCategory.create({
        data: { name: "网络设备", code: "WL" },
      });

      await createDeviceTemplate({
        name: "电脑模板",
        categoryId: assetCat.id,
        components: [],
      });
      await createDeviceTemplate({
        name: "网络模板",
        categoryId: cat2.id,
        components: [],
      });

      const result = await getDeviceTemplates({ categoryId: assetCat.id });

      expect(result.success).toBe(true);
      expect(unwrap(result).length).toBe(1);
      expect(unwrap(result)[0].name).toBe("电脑模板");
    });

    it("空数据库返回空数组", async () => {
      const result = await getDeviceTemplates();

      expect(result.success).toBe(true);
      expect(unwrap(result)).toEqual([]);
    });
  });

  describe("getDeviceTemplateById", () => {
    it("可以根据 ID 获取模板详情（含 BOM）", async () => {
      const { assetCat, cpu } = await setupTestData();
      const created = await createDeviceTemplate({
        name: "标准办公电脑",
        categoryId: assetCat.id,
        components: [{ modelId: cpu.id, quantity: 1 }],
      });

      const result = await getDeviceTemplateById(unwrap(created).id);

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("标准办公电脑");
      expect(unwrap(result).components).toHaveLength(1);
    });

    it("ID 不存在时返回失败", async () => {
      const result = await getDeviceTemplateById(99999);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不存在");
    });
  });

  describe("updateDeviceTemplate", () => {
    it("可以更新模板名称和 BOM", async () => {
      const { assetCat, cpu, ram } = await setupTestData();
      const created = await createDeviceTemplate({
        name: "旧模板",
        categoryId: assetCat.id,
        components: [{ modelId: cpu.id, quantity: 1 }],
      });

      const result = await updateDeviceTemplate(unwrap(created).id, {
        name: "新模板",
        components: [
          { modelId: cpu.id, quantity: 1 },
          { modelId: ram.id, quantity: 2 },
        ],
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).name).toBe("新模板");
      expect(unwrap(result).components).toHaveLength(2);
    });

    it("更新 BOM 时会替换原有清单", async () => {
      const { assetCat, cpu, ram } = await setupTestData();
      const created = await createDeviceTemplate({
        name: "测试",
        categoryId: assetCat.id,
        components: [
          { modelId: cpu.id, quantity: 1 },
          { modelId: ram.id, quantity: 1 },
        ],
      });

      // 更新后只保留 CPU
      const result = await updateDeviceTemplate(unwrap(created).id, {
        components: [{ modelId: cpu.id, quantity: 1 }],
      });

      expect(result.success).toBe(true);
      expect(unwrap(result).components).toHaveLength(1);
      expect(unwrap(result).components[0].modelId).toBe(cpu.id);
    });

    it("同一分类下更新名称不能与已有模板重复", async () => {
      const { assetCat } = await setupTestData();
      await createDeviceTemplate({
        name: "模板A",
        categoryId: assetCat.id,
        components: [],
      });
      const target = await createDeviceTemplate({
        name: "模板B",
        categoryId: assetCat.id,
        components: [],
      });

      const result = await updateDeviceTemplate(unwrap(target).id, {
        name: "模板A",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("已存在");
    });

    it("ID 不存在时更新失败", async () => {
      const result = await updateDeviceTemplate(99999, {
        name: "测试",
      });

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不存在");
    });
  });

  describe("deleteDeviceTemplate", () => {
    it("可以删除没有关联设备的模板", async () => {
      const { assetCat } = await setupTestData();
      const created = await createDeviceTemplate({
        name: "待删除",
        categoryId: assetCat.id,
        components: [],
      });

      const result = await deleteDeviceTemplate(unwrap(created).id);

      expect(result.success).toBe(true);

      const check = await prisma.deviceTemplate.findUnique({
        where: { id: unwrap(created).id },
      });
      expect(check).toBeNull();
    });

    it("删除模板时级联删除 BOM 配件清单", async () => {
      const { assetCat, cpu } = await setupTestData();
      const created = await createDeviceTemplate({
        name: "待删除",
        categoryId: assetCat.id,
        components: [{ modelId: cpu.id, quantity: 1 }],
      });

      await deleteDeviceTemplate(unwrap(created).id);

      const boms = await prisma.templateComponent.findMany({
        where: { templateId: unwrap(created).id },
      });
      expect(boms).toHaveLength(0);
    });

    it("有关联设备时不能删除", async () => {
      const { assetCat } = await setupTestData();
      const dept = await prisma.department.create({ data: { name: "技术部" } });
      const emp = await prisma.employee.create({
        data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
      });
      const template = await createDeviceTemplate({
        name: "有设备",
        categoryId: assetCat.id,
        components: [],
      });

      // 直接用 prisma 创建一个关联设备
      await prisma.asset.create({
        data: {
          assetNo: "DN-0001",
          name: "测试设备",
          templateId: unwrap(template).id,
          employeeId: emp.id,
          status: "IN_USE",
        },
      });

      const result = await deleteDeviceTemplate(unwrap(template).id);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("有关联设备");
    });

    it("ID 不存在时删除失败", async () => {
      const result = await deleteDeviceTemplate(99999);

      expect(result.success).toBe(false);
      expect(unwrapError(result)).toContain("不存在");
    });
  });
});
