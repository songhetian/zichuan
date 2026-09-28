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
    setTestUser({ id: 1, username: "admin", permissions: ["asset.manage", "system.account.manage"] });
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
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      operator: "admin",
    });

    // 第一次分配应成功
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);

    // 第二次分配应失败（同一分类下唯一）
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2)[0].id],
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
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      operator: "admin",
    });

    const r1 = await allocateAssets({
      assetIds: [unwrap(a1)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2)[0].id],
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
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl2).id,
      operator: "admin",
    });

    // 分配第一台（高端）
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);

    // 分配第二台（低端，不同模板但同分类）应失败
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2)[0].id],
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
      operator: "admin",
    });
    // 分配第一台
    await allocateAssets({
      assetIds: [unwrap(a1)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    // 报废第一台
    await prisma.asset.update({
      where: { id: unwrap(a1)[0].id },
      data: { status: "SCRAPPED", employeeId: null },
    });
    // 创建第二台并分配
    const a2 = await createAsset({
      templateId: unwrap(tpl).id,
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2)[0].id],
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
      operator: "admin",
    });
    const a2 = await createAsset({
      templateId: unwrap(tpl2).id,
      operator: "admin",
    });

    // 两个不同分类的设备都可以分配给同一员工
    const r1 = await allocateAssets({
      assetIds: [unwrap(a1)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  // 同批次勾选同唯一分类多台：不能一次分配即绕过唯一约束
  it("同一批次勾选同唯一分类多台设备分配给同一员工：整单被拒", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "批量唯一分类", code: "UB", unique: true },
    });
    const dept = await prisma.department.create({ data: { name: "批量唯一部门" } });
    const emp = await createEmployee({
      employeeNo: "U006",
      name: "周批量",
      departmentId: dept.id,
    });
    const tpl = await createDeviceTemplate({
      name: "批量唯一机",
      categoryId: cat.id,
      components: [],
    });
    const a1 = await createAsset({ templateId: unwrap(tpl).id, operator: "admin" });
    const a2 = await createAsset({ templateId: unwrap(tpl).id, operator: "admin" });

    const r = await allocateAssets({
      assetIds: [unwrap(a1)[0].id, unwrap(a2)[0].id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("唯一性约束");

    // 事务回滚：两台均保持闲置
    const after = await prisma.asset.findMany({
      where: { id: { in: [unwrap(a1)[0].id, unwrap(a2)[0].id] } },
    });
    expect(after.every((a) => a.status === "IDLE" && a.employeeId === null)).toBe(true);
  });

  // 建档即分配（createAsset 带 employeeId）同样受唯一约束
  it("唯一分类建档即分配：员工已持有该分类时被拒", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "建档唯一分类", code: "UC", unique: true },
    });
    const dept = await prisma.department.create({ data: { name: "建档唯一部门" } });
    const emp = await createEmployee({
      employeeNo: "U007",
      name: "吴建档",
      departmentId: dept.id,
    });
    const tpl = await createDeviceTemplate({
      name: "建档唯一机",
      categoryId: cat.id,
      components: [],
    });

    // 第一台：建档即分配给该员工，成功
    const first = await createAsset({
      templateId: unwrap(tpl).id,
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(first.success).toBe(true);

    // 第二台：建档即分配给同一员工（同唯一分类）应被拒
    const second = await createAsset({
      templateId: unwrap(tpl).id,
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(second.success).toBe(false);
    expect(unwrapError(second)).toContain("唯一性约束");

    // 唯一分类不允许一次批量建档多台并分配给同一员工
    const batch = await createAsset({
      templateId: unwrap(tpl).id,
      quantity: 2,
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(batch.success).toBe(false);
  });
});
