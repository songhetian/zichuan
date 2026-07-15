import { describe, it, expect, beforeEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { allocateAssets } from "@/actions/lifecycle.actions";
import { createAsset } from "@/actions/asset.actions";
import {
  createDeviceTemplate,
  updateDeviceTemplate,
  getDeviceTemplates,
} from "@/actions/device-template.actions";
import { createEmployee } from "@/actions/employee.actions";
import { prisma } from "@/lib/prisma";

describe("设备模板唯一性约束", () => {
  // RED: 创建唯一模板时可以设置 unique 字段
  it("创建模板时支持设置 unique 字段", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一测试分类", code: "UQ" },
    });
    const result = await createDeviceTemplate({
      name: "唯一电脑",
      categoryId: cat.id,
      components: [],
      unique: true,
    });
    expect(result.success).toBe(true);
    expect(unwrap(result).unique).toBe(true);
  });

  // RED: 更新模板时可以修改 unique 字段
  it("更新模板时可以修改 unique 字段", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一更新分类", code: "UU" },
    });
    const created = await createDeviceTemplate({
      name: "普通模板",
      categoryId: cat.id,
      components: [],
    });
    const updated = await updateDeviceTemplate(unwrap(created).id, {
      unique: true,
    });
    expect(updated.success).toBe(true);
    expect(unwrap(updated).unique).toBe(true);
  });

  // RED: 唯一模板下，同一员工不能分配第二台
  it("唯一模板下同一员工不能被分配第二台设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一分配分类", code: "UA" },
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
      unique: true,
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

    // 第二次分配应失败
    const r2 = await allocateAssets({
      assetIds: [unwrap(a2).id],
      employeeId: unwrap(emp).id,
      operator: "admin",
    });
    expect(r2.success).toBe(false);
    expect(unwrapError(r2)).toContain("唯一性约束");
  });

  // RED: 非唯一模板下，同一员工可以分配多台
  it("非唯一模板下同一员工可以被分配多台设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "非唯一分类", code: "NU" },
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
      unique: false,
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

  // RED: 唯一约束只检查非报废设备（报废的不算）
  it("唯一约束不检查已报废设备", async () => {
    const cat = await prisma.assetCategory.create({
      data: { name: "唯一报废分类", code: "US" },
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
      unique: true,
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
});
