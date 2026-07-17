import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { allocateAssets } from "@/actions/lifecycle.actions";
import { createAsset } from "@/actions/asset.actions";
import { createDeviceTemplate } from "@/actions/device-template.actions";
import { createEmployee } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

describe("设备分类唯一性约束", () => {
  beforeEach(() => {
    setTestUser({ id: 1, username: "admin" });
  });

  afterEach(() => {
    setTestUser(null);
  });
  // 唯一分类下，同一员工不能分配第二台（即使模板不同）
  it("唯一分类下同一员工不能被分配第二台设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一分配分类", code: "UA", unique: true },
    });
    const dept = await prisma.department.create({
      data: { name: "唯一分配部门" },
    });
    const emp = await createEmployee({
      employeeNo: "U001",
      name: "张唯一",
      departmentId: dept.id,
    });
    const tpl = await createDeviceTemplate({
      name: "唯一笔记本",
      categoryId: cat.id,
      components: [],
    });

    const a1 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "唯一笔记本1",
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "唯一笔记本2",
      operator: "admin",
    });

    // 第一次分配应成功
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);

    // 第二次分配应失败（同一分类下唯一）
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r2.success).toBe(false);
    expect(unwrapError(r2)).toContain("唯一性约束");
  });

  // 非唯一分类下，同一员工可以分配多台
  it("非唯一分类下同一员工可以被分配多台设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "非唯一分类", code: "NU", unique: false },
    });
    const dept = await prisma.department.create({
      data: { name: "非唯一部门" },
    });
    const emp = await createEmployee({
      employeeNo: "U002",
      name: "李非唯一",
      departmentId: dept.id,
    });
    const tpl = await createDeviceTemplate({
      name: "普通电脑",
      categoryId: cat.id,
      components: [],
    });

    const a1 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "电脑1",
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "电脑2",
      operator: "admin",
    });

    const r1 = await allocateAssets({
      assetIds: [unwrap(a1).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  // 唯一分类下，不同模板的设备也算同一分类，不能重复分配
  it("唯一分类下不同模板的设备也不能重复分配给同一员工", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一多模板分类", code: "UM", unique: true },
    });
    const dept = await prisma.department.create({
      data: { name: "唯一多模板部门" },
    });
    const emp = await createEmployee({
      employeeNo: "U004",
      name: "赵多模板",
      departmentId: dept.id,
    });
    // 同一分类下创建两个不同模板
    const tpl1 = await createDeviceTemplate({
      name: "高端电脑",
      categoryId: cat.id,
      components: [],
    });
    const tpl2 = await createDeviceTemplate({
      name: "低端电脑",
      categoryId: cat.id,
      components: [],
    });

    const a1 = await createAsset({
      templateId: unwrap(tpl1).id,
      name: "高端电脑1",
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl2).id,
      name: "低端电脑1",
      operator: "admin",
    });

    // 分配第一台（高端）
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);

    // 分配第二台（低端，不同模板但同分类）应失败
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r2.success).toBe(false);
    expect(unwrapError(r2)).toContain("唯一性约束");
  });

  // 唯一约束不检查已报废设备
  it("唯一约束不检查已报废设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一报废分类", code: "US", unique: true },
    });
    const dept = await prisma.department.create({
      data: { name: "唯一报废部门" },
    });
    const emp = await createEmployee({
      employeeNo: "U003",
      name: "王报废",
      departmentId: dept.id,
    });
    const tpl = await createDeviceTemplate({
      name: "唯一测试机",
      categoryId: cat.id,
      components: [],
    });

    const a1 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "测试机1",
      operator: "admin",
    });
    // 分配第一台
    await allocateAssets({
      assetIds: [unwrap(a1).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    // 报废第一台
    await prisma.asset.update({
      where: { id: unwrap(a1).id },
      data: { status: "SCRAPPED", employeeId: null },
    });
    // 创建第二台并分配
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      name: "测试机2",
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r2.success).toBe(true);
  });

  // 不同分类的设备互不影响
  it("不同唯一分类的设备互不影响", async () => {
    const cat1 = await prisma.assetCategory.create({
      data: { name: "唯一分类A", code: "C1", unique: true },
    });
    const cat2 = await prisma.assetCategory.create({
      data: { name: "唯一分类B", code: "C2", unique: true },
    });
    const dept = await prisma.department.create({
      data: { name: "多分类部门" },
    });
    const emp = await createEmployee({
      employeeNo: "U005",
      name: "孙多分类",
      departmentId: dept.id,
    });
    const tpl1 = await createDeviceTemplate({
      name: "A型设备",
      categoryId: cat1.id,
      components: [],
    });
    const tpl2 = await createDeviceTemplate({
      name: "B型设备",
      categoryId: cat2.id,
      components: [],
    });

    const a1 = await createAsset({
      templateId: unwrap(tpl1).id,
      name: "A型设备1",
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl2).id,
      name: "B型设备1",
      operator: "admin",
    });

    // 两个不同分类的设备都可以分配给同一员工
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});
