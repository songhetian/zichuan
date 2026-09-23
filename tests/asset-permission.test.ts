import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createAsset, deleteAsset, getAssets, getAssetById } from "@/actions/asset.actions";
import { importAssetsAuto } from "@/actions/auto-import.actions";
import { importAssetsFromExcel } from "@/actions/excel.actions";
import { createComponentModel } from "@/actions/component-model.actions";
import { purchaseStockIn } from "@/actions/component-stock.actions";
import { createDeviceTemplate } from "@/actions/device-template.actions";
import { createStocktakeSession } from "@/actions/stocktake.actions";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";

/** 建一个角色（测试自建，不依赖种子）；permissions = 该角色拥有的权限 key */
async function seedRole(key: string, name: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { key, name, isSystem: true } });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "system", name: p },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  }
  return role;
}

describe("资产写操作权限（M2：asset.manage 接权）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("普通员工（无 asset.manage）不能创建设备", async () => {
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });
    setTestUser({ id: emp.id, username: "emp1" });

    const result = await createAsset({} as never);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });

  it("资产管理员（有 asset.manage）不被权限拦截", async () => {
    const amRole = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
    const am = await prisma.admin.create({
      data: { username: "am", password: "x", roleId: amRole.id },
    });
    setTestUser({ id: am.id, username: "am" });

    const result = await createAsset({} as never);
    // 已通过权限守卫，不应再报权限错误（此处应走到参数校验报「参数错误」）
    expect(result.success).toBe(false);
    expect(unwrapError(result)).not.toContain("权限");
  });

  it("测试注入显式权限（无 DB 账号行）可通过守卫", async () => {
    setTestUser({ id: 999, username: "tester", permissions: ["asset.manage"] });

    const result = await createAsset({} as never);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).not.toContain("权限");
  });

  it("测试注入无权限时被拒", async () => {
    setTestUser({ id: 999, username: "tester", permissions: ["asset.view.own"] });

    const result = await deleteAsset(1);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });

  it("配件/库存/模板/盘点类写操作同样被守卫", async () => {
    setTestUser({ id: 999, username: "tester", permissions: [] });

    const results = await Promise.all([
      createComponentModel({} as never),
      purchaseStockIn({} as never),
      createDeviceTemplate({} as never),
      createStocktakeSession({} as never),
      deleteAsset(1),
    ]);
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(unwrapError(r)).toContain("权限");
    }
  });

  it("设备导入（自动/Excel）均需 asset.manage 写权限守卫", async () => {
    setTestUser({ id: 999, username: "tester", permissions: ["asset.view.own"] });

    const auto = await importAssetsAuto({ assets: [] });
    expect(auto.success).toBe(false);
    expect(unwrapError(auto)).toContain("权限");

    const excel = await importAssetsFromExcel({ buffer: [] });
    expect(excel.success).toBe(false);
    expect(unwrapError(excel)).toContain("权限");
  });
});

describe("资产读数据范围（getAssets / getAssetById 越权防护）", () => {
  beforeEach(async () => {
    await prisma.assetComponent.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  /** 造：1 部门 + 2 员工 + 3 台设备（张三1台、李四1台、未分配1台）+ 绑定张三的账号 */
  async function setupScopedAssets() {
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp1 = await prisma.employee.create({
      data: { employeeNo: "E1", name: "张三", departmentId: dept.id },
    });
    const emp2 = await prisma.employee.create({
      data: { employeeNo: "E2", name: "李四", departmentId: dept.id },
    });
    const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
    const template = await prisma.deviceTemplate.create({
      data: { name: "标准办公电脑", categoryId: assetCat.id },
    });
    const myAsset = await prisma.asset.create({
      data: { assetNo: "DN-MY", name: "张三的电脑", templateId: template.id, status: "IN_USE", employeeId: emp1.id },
    });
    const otherAsset = await prisma.asset.create({
      data: { assetNo: "DN-O", name: "李四的电脑", templateId: template.id, status: "IN_USE", employeeId: emp2.id },
    });
    await prisma.asset.create({
      data: { assetNo: "DN-X", name: "闲置电脑", templateId: template.id, status: "IDLE" },
    });
    const admin = await prisma.admin.create({
      data: { username: "zhang", password: "x", employeeId: emp1.id },
    });
    return { dept, emp1, emp2, template, myAsset: myAsset as { id: number }, otherAsset: otherAsset as { id: number }, admin };
  }

  it("普通员工仅能查看本人名下设备（asset.view.own）", async () => {
    const { admin, myAsset, otherAsset } = await setupScopedAssets();
    setTestUser({ id: admin.id, username: "zhang", permissions: ["asset.view.own"] });

    const list = unwrap(await getAssets());
    expect(list.some((a) => a.id === myAsset.id)).toBe(true);
    expect(list.some((a) => a.id === otherAsset.id)).toBe(false);

    // 越权读他人设备详情 → 视为不存在
    const detail = await getAssetById(otherAsset.id);
    expect(detail.success).toBe(false);
    expect(unwrapError(detail)).toContain("不存在");
  });

  it("资产管理员（asset.manage）可查看全部设备", async () => {
    const { admin, myAsset, otherAsset } = await setupScopedAssets();
    setTestUser({ id: admin.id, username: "zhang", permissions: ["asset.manage"] });

    const list = unwrap(await getAssets());
    expect(list.some((a) => a.id === myAsset.id)).toBe(true);
    expect(list.some((a) => a.id === otherAsset.id)).toBe(true);

    const detail = await getAssetById(otherAsset.id);
    expect(detail.success).toBe(true);
  });

  /** 造：两个部门，各 1 名员工 + 各 1 台设备；技术部部长账号绑定技术部员工 */
  async function setupDeptScopedAssets() {
    const dept1 = await prisma.department.create({ data: { name: "技术部" } });
    const dept2 = await prisma.department.create({ data: { name: "财务部" } });
    const d1Emp = await prisma.employee.create({
      data: { employeeNo: "D1", name: "张三", departmentId: dept1.id },
    });
    const d2Emp = await prisma.employee.create({
      data: { employeeNo: "D2", name: "李四", departmentId: dept2.id },
    });
    const assetCat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
    const template = await prisma.deviceTemplate.create({
      data: { name: "标准办公电脑", categoryId: assetCat.id },
    });
    const d1Asset = await prisma.asset.create({
      data: { assetNo: "DN-1", name: "技术部设备", templateId: template.id, status: "IN_USE", employeeId: d1Emp.id },
    });
    const d2Asset = await prisma.asset.create({
      data: { assetNo: "DN-2", name: "财务部设备", templateId: template.id, status: "IN_USE", employeeId: d2Emp.id },
    });
    await prisma.asset.create({
      data: { assetNo: "DN-X", name: "闲置电脑", templateId: template.id, status: "IDLE" },
    });
    const manager = await prisma.admin.create({
      data: { username: "d1mgr", password: "x", employeeId: d1Emp.id },
    });
    return {
      dept1,
      dept2,
      d1Emp,
      d2Emp,
      d1Asset: d1Asset as { id: number },
      d2Asset: d2Asset as { id: number },
      manager,
    };
  }

  it("部门主管（dept.data.view）可查看本部门全部资产，但不能跨部门", async () => {
    const { d1Asset, d2Asset, manager } = await setupDeptScopedAssets();
    setTestUser({ id: manager.id, username: "d1mgr", permissions: ["dept.data.view"] });

    // 本部门 1 台设备可见，且含同部门闲置判空不干扰
    const list = unwrap(await getAssets());
    expect(list.some((a) => a.id === d1Asset.id)).toBe(true);
    // 财务部设备不可见
    expect(list.some((a) => a.id === d2Asset.id)).toBe(false);

    // 跨部门读取详情 → 视为不存在
    const detail = await getAssetById(d2Asset.id);
    expect(detail.success).toBe(false);
    expect(unwrapError(detail)).toContain("不存在");
  });

  it("同部门同事的设备对本部门主管可见，本人能不依赖 asset.manage 查看", async () => {
    const { dept1, d1Emp, manager, d1Asset } = await setupDeptScopedAssets();
    // 技术部再补一台给张三，确保能看”自己 + 同事“的整部门资产
    const template = await prisma.deviceTemplate.findFirstOrThrow({ where: { name: "标准办公电脑" } });
    const sameDeptAsset = await prisma.asset.create({
      data: {
        assetNo: "DN-1B",
        name: "张三的第二台",
        templateId: template.id,
        status: "IN_USE",
        employeeId: d1Emp.id,
      },
    });
    const otherDept2Emp = await prisma.employee.create({
      data: { employeeNo: "D3", name: "技术部二号", departmentId: dept1.id },
    });
    const colleagueAsset = await prisma.asset.create({
      data: {
        assetNo: "DN-1C",
        name: "同事设备",
        templateId: template.id,
        status: "IN_USE",
        employeeId: otherDept2Emp.id,
      },
    });
    setTestUser({ id: manager.id, username: "d1mgr", permissions: ["dept.data.view"] });

    const list = unwrap(await getAssets());
    expect(list.some((a) => a.id === d1Asset.id)).toBe(true);
    expect(list.some((a) => a.id === sameDeptAsset.id)).toBe(true);
    expect(list.some((a) => a.id === colleagueAsset.id)).toBe(true);
  });
});
