import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { getApprovalDelegationTargets } from "@/lib/approval-scope";

// ============================================================
// 主管代申数据范围：getApprovalDelegationTargets
//   - 无 dept.data.view / system.account.manage → []
//   - 部门主管：仅本人主管部门的在职员工及其名下设备、配件类别
//   - system.account.manage：全部部门在职员工
//   - RESERVED 设备不参与
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, isSystem: true } });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({ where: { key: p }, update: {}, create: { key: p, module: "m", name: p } });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

async function seedAsset(employeeId: number, assetNo: string, status: string) {
  const cat = await prisma.assetCategory.upsert({ where: { code: "DN" }, update: {}, create: { name: "电脑", code: "DN" } });
  const tmpl = await prisma.deviceTemplate.upsert({
    where: { categoryId_name: { categoryId: cat.id, name: "标准" } },
    update: {},
    create: { name: "标准", categoryId: cat.id },
  });
  return prisma.asset.create({
    data: { assetNo, name: assetNo, status: status as never, employeeId, templateId: tmpl.id },
  });
}

describe("代申数据范围 getApprovalDelegationTargets", () => {
  afterEach(() => setTestUser(null));
  beforeEach(async () => {
    await prisma.lifecycleLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.assetComponent.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  it("普通员工（无 dept.data.view/canManageAll）→ 空数组", async () => {
    const empRole = await seedRole("EMP", []);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({ data: { employeeNo: "E001", name: "员工", departmentId: dept.id } });
    const admin = await prisma.admin.create({ data: { username: "emp", password: "x", roleId: empRole.id, employeeId: emp.id } });
    setTestUser({ id: admin.id, username: "emp", permissions: [] });
    expect(await getApprovalDelegationTargets(admin.id)).toEqual([]);
  });

  it("部门主管：返回本人主管部门在职员工及其名下设备与配件类别（含本人）", async () => {
    const dmRole = await seedRole("DM", ["dept.data.view"]);
    const amRole = await seedRole("AM", ["asset.manage"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    // 主管本人
    const dmEmp = await prisma.employee.create({ data: { employeeNo: "M99", name: "主管", departmentId: dept.id } });
    const dm = await prisma.admin.create({ data: { username: "dm", password: "x", roleId: dmRole.id, employeeId: dmEmp.id } });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: dmEmp.id } });
    // 下属张三 + 其名下一台 IN_USE 设备 + 一台 RESERVED 设备
    const empA = await prisma.employee.create({ data: { employeeNo: "A001", name: "张三", departmentId: dept.id } });
    const activeAsset = await seedAsset(empA.id, "DN-0001", "IN_USE");
    await seedAsset(empA.id, "DN-0002", "RESERVED");
    // 另一部门在职员工不应出现
    const otherDept = await prisma.department.create({ data: { name: "运营部" } });
    await prisma.employee.create({ data: { employeeNo: "B001", name: "李四", departmentId: otherDept.id } });

    setTestUser({ id: dm.id, username: "dm", permissions: ["dept.data.view"] });
    const targets = await getApprovalDelegationTargets(dm.id);

    const empNos = targets.map((t) => t.employeeNo);
    expect(empNos).toEqual(expect.arrayContaining(["A001", "M99"]));
    expect(empNos).not.toContain("B001");

    const zhang = targets.find((t) => t.employeeNo === "A001")!;
    expect(zhang.assets.map((a) => a.assetNo)).toEqual([activeAsset.assetNo]);
    expect(zhang.assets.every((a) => a.id !== undefined)).toBe(true);
  });

  it("资产管理员 SPEC：代申范围 = 主管部门 ∪ 扩展部门（追加式，与 resolveDepartmentScope 一致）", async () => {
    const amRole = await seedRole("AM", ["asset.manage", "dept.data.view"]);
    const d1 = await prisma.department.create({ data: { name: "技术部" } });
    const d2 = await prisma.department.create({ data: { name: "运营部" } });
    const d3 = await prisma.department.create({ data: { name: "拓展部" } });
    const amEmp = await prisma.employee.create({ data: { employeeNo: "M01", name: "管理员", departmentId: d1.id } });
    const am = await prisma.admin.create({ data: { username: "am", password: "x", roleId: amRole.id, employeeId: amEmp.id } });
    // 技术部管辖 + 扩展运营部；拓展部不在范围内
    await prisma.department.update({ where: { id: d1.id }, data: { managerId: amEmp.id } });
    await prisma.adminDepartment.create({ data: { adminId: am.id, departmentId: d2.id } });
    await prisma.admin.update({ where: { id: am.id }, data: { departmentScope: "SPEC" } });
    const e1 = await prisma.employee.create({ data: { employeeNo: "E001", name: "员工A", departmentId: d1.id } });
    const e2 = await prisma.employee.create({ data: { employeeNo: "E002", name: "员工B", departmentId: d2.id } });
    await prisma.employee.create({ data: { employeeNo: "E003", name: "员工C", departmentId: d3.id } });

    setTestUser({ id: am.id, username: "am", permissions: ["asset.manage", "dept.data.view"] });
    const targets = await getApprovalDelegationTargets(am.id);
    const empNos = targets.map((t) => t.employeeNo);
    expect(empNos).toEqual(expect.arrayContaining(["M01", "E001", "E002"]));
    expect(empNos).not.toContain("E003");
  });

  it("具备 system.account.manage 时返回全部部门在职员工", async () => {
    const allRole = seedRole("ALL", ["system.account.manage"]);
    const d1 = await prisma.department.create({ data: { name: "技术部" } });
    const d2 = await prisma.department.create({ data: { name: "运营部" } });
    const e1 = await prisma.employee.create({ data: { employeeNo: "C001", name: "张三", departmentId: d1.id } });
    const e2 = await prisma.employee.create({ data: { employeeNo: "C002", name: "李四", departmentId: d2.id } });
    const admin = await prisma.admin.create({ data: { username: "all", password: "x", roleId: (await allRole).id } });

    setTestUser({ id: admin.id, username: "all", permissions: ["system.account.manage"] });
    const targets = await getApprovalDelegationTargets(admin.id);
    expect(targets.map((t) => t.employeeNo)).toEqual(expect.arrayContaining(["C001", "C002"]));
  });

  it("代申目标名下设备可携带其配件类别（升级用）", async () => {
    const dmRole = await seedRole("DM", ["dept.data.view"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const mgrEmp = await prisma.employee.create({ data: { employeeNo: "M01", name: "主管", departmentId: dept.id } });
    const mgr = await prisma.admin.create({ data: { username: "mgr", password: "x", roleId: dmRole.id, employeeId: mgrEmp.id } });
    await prisma.department.update({ where: { id: dept.id }, data: { managerId: mgrEmp.id } });
    const empA = await prisma.employee.create({ data: { employeeNo: "A001", name: "张三", departmentId: dept.id } });
    const asset = await seedAsset(empA.id, "DN-0001", "IN_USE");

    const memCat = await prisma.componentCategory.upsert({ where: { name: "内存" }, update: {}, create: { name: "内存" } });
    const compModel = await prisma.componentModel.create({ data: { name: "8G", categoryId: memCat.id } });
    await prisma.assetComponent.create({ data: { assetId: asset.id, modelId: compModel.id } });

    setTestUser({ id: mgr.id, username: "mgr", permissions: ["dept.data.view"] });
    const targets = await getApprovalDelegationTargets(mgr.id);
    const zhang = targets.find((t) => t.employeeNo === "A001")!;
    expect(zhang.assetCats).toEqual([{ assetId: asset.id, categoryId: memCat.id, categoryName: "内存" }]);
  });
});