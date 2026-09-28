import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { unwrap, unwrapError } from "./helpers";
import {
  createDepartmentEmployee,
  updateDepartmentEmployee,
  setEmployeeDevice,
  markEmployeeDepart,
  getDepartmentEmployees,
} from "@/actions/department-employee.actions";
import bcrypt from "bcryptjs";

// ============================================================
// 员工管理（部门主管弹窗）：仅在本人主管的部门内 增/改/离职/设设备编码
// Seam：S1 createDepartmentEmployee / S2 updateDepartmentEmployee
//       S3 setEmployeeDevice / S4 markEmployeeDepart
// 数据范围：dept.data.view + 目标员工必须在本人主管的部门内（不可跨部门）
// ============================================================

async function seedRole(key: string, permissions: string[]) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, isSystem: true },
  });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "employee", name: p },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      update: {},
      create: { roleId: role.id, permissionId: perm.id },
    });
  }
  return role;
}

/** 建一个员工 + 账号（可指定部门/主管） */
async function seedEmployee(employeeNo: string, name: string, departmentId: number, managerId?: number) {
  return prisma.employee.create({
    data: { employeeNo, name, departmentId, managerId },
  });
}

async function seedManagedDeptManager(username: string, deptIds: number[]) {
  // 部门主管：employee.managedDepartments = 本人任 manager 的部门
  const role = await seedRole("DEPT_MANAGER", ["dept.data.view"]);
  const emp = await prisma.employee.create({
    data: { employeeNo: "MGR", name: "部门主管", departmentId: deptIds[0] },
  });
  for (const deptId of deptIds) {
    await prisma.department.update({ where: { id: deptId }, data: { managerId: emp.id } });
  }
  const admin = await prisma.admin.create({ data: { username, password: "x", roleId: role.id, employeeId: emp.id } });
  setTestUser({ id: admin.id, username: admin.username, permissions: ["dept.data.view"] });
  return { emp, admin };
}

/** 建一台可用设备（闲置/在库未分配） */
async function seedIdleAsset(assetNo: string) {
  const assetCat = await prisma.assetCategory.upsert({
    where: { code: "DN" },
    update: {},
    create: { name: "电脑", code: "DN" },
  });
  const existing = await prisma.deviceTemplate.findFirst({
    where: { categoryId: assetCat.id, name: "标准办公电脑" },
  });
  const template =
    existing ??
    (await prisma.deviceTemplate.create({ data: { name: "标准办公电脑", categoryId: assetCat.id } }));
  return prisma.asset.create({
    data: { assetNo, name: "电脑", templateId: template.id, status: "IDLE" },
  });
}

async function seedDepts() {
  const tech = await prisma.department.create({ data: { name: "技术部" } });
  const ops = await prisma.department.create({ data: { name: "运营部" } });
  return { tech, ops };
}

describe("部门主管弹窗管理员工（本部门数据范围）", () => {
  afterEach(() => setTestUser(null));
  beforeEach(async () => {
    // 清理依赖：设备→模板→分类→交接单→员工→部门→账号→角色
    await prisma.handoverOrder.deleteMany();
    await prisma.lifecycleLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  // ---------------- S1 新增员工 ----------------
  it("S1 部门主管可对本部门新增员工，并自动创建默认密码账号(首登强制改密)", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);

    const r = await createDepartmentEmployee({ departmentId: tech.id, name: "新员工", phone: "13800000000" });
    expect(r.success).toBe(true);
    const created = unwrap(r);
    expect(created.departmentId).toBe(tech.id);
    expect(created.employeeNo).toMatch(/^EMP\d+$/); // 自动生成工号

    // 自动建账号：username=工号、默认密码 123456、首登强制改密
    const admin = await prisma.admin.findUniqueOrThrow({ where: { employeeId: created.id } });
    expect(admin.username).toBe(created.employeeNo);
    expect(admin.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("123456", admin.password)).toBe(true);
  });

  it("S1 跨部门新增员工 → 被拒", async () => {
    const { tech, ops } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]); // 仅主管技术部

    const r = await createDepartmentEmployee({ departmentId: ops.id, name: "外人" });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("无权");
  });

  it("S1 无 dept.data.view 权限 → 被拒", async () => {
    const { tech } = await seedDepts();
    const role = await seedRole("EMPLOYEE", []);
    const admin = await prisma.admin.create({ data: { username: "plain", password: "x", roleId: role.id } });
    setTestUser({ id: admin.id, username: "plain", permissions: [] });

    const r = await createDepartmentEmployee({ departmentId: tech.id, name: "某人" });
    expect(r.success).toBe(false);
  });

  // ---------------- S2 修改员工 ----------------
  it("S2 可修改本部门员工资料、重设工号", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const emp = await seedEmployee("E001", "张三", tech.id);

    const r = await updateDepartmentEmployee(emp.id, { name: "张三丰", employeeNo: "E009" });
    expect(r.success).toBe(true);
    const updated = unwrap(r);
    expect(updated.name).toBe("张三丰");
    expect(updated.employeeNo).toBe("E009");
  });

  it("S2 无法修改其他部门的员工（跨部门 → 被拒）", async () => {
    const { tech, ops } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const opsEmp = await seedEmployee("E100", "运营小王", ops.id);

    const r = await updateDepartmentEmployee(opsEmp.id, { name: "改名" });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("无权");
  });

  it("S2 修改员工部门只能指向本人主管的部门（不可跨部门迁移）", async () => {
    const { tech, ops } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const emp = await seedEmployee("E001", "张三", tech.id);

    // 移到未主管的运营部 → 被拒
    const cross = await updateDepartmentEmployee(emp.id, { departmentId: ops.id });
    expect(cross.success).toBe(false);
    // 留在主管的技术部 → 成功
    const same = await updateDepartmentEmployee(emp.id, { departmentId: tech.id });
    expect(same.success).toBe(true);
  });

  // ---------------- S3 分配/解除设备编码 ----------------
  it("S3 可把闲置设备分配给本部门员工（IN_USE + ALLOCATED 日志）", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const emp = await seedEmployee("E001", "张三", tech.id);
    const asset = await seedIdleAsset("DN-0001");
    await prisma.asset.update({ where: { id: asset.id }, data: { employeeId: null } });

    const r = await setEmployeeDevice({ employeeId: emp.id, assetId: asset.id });
    expect(r.success).toBe(true);

    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.status).toBe("IN_USE");
    expect(after.employeeId).toBe(emp.id);
    const log = await prisma.lifecycleLog.findFirst({ where: { assetId: asset.id, action: "ALLOCATED" } });
    expect(log?.toStatus).toBe("IN_USE");
  });

  it("S3 分配给他人或非闲置设备 → 被拒", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const empA = await seedEmployee("E001", "张三", tech.id);
    const empB = await seedEmployee("E002", "李四", tech.id);
    const asset = await seedIdleAsset("DN-0001");
    await prisma.asset.update({ where: { id: asset.id }, data: { status: "IN_USE", employeeId: empA.id } });

    // 设备已在他人在用 → 不可分配
    const r = await setEmployeeDevice({ employeeId: empB.id, assetId: asset.id });
    expect(r.success).toBe(false);
  });

  it("S3 可解除本部门员工名下设备（置闲置 + RETURNED 日志）", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const emp = await seedEmployee("E001", "张三", tech.id);
    const asset = await seedIdleAsset("DN-0001");
    await prisma.asset.update({ where: { id: asset.id }, data: { status: "IN_USE", employeeId: emp.id } });

    const r = await setEmployeeDevice({ employeeId: emp.id, assetId: null });
    expect(r.success).toBe(true);

    const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.status).toBe("IDLE");
    expect(after.employeeId).toBeNull();
    const log = await prisma.lifecycleLog.findFirst({ where: { assetId: asset.id, action: "RETURNED" } });
    expect(log?.toStatus).toBe("IDLE");
  });

  // ---------------- S4 员工离职 ----------------
  it("S4 标记离职 → 员工置 LEFT、停用账号、立即自动回收名下全部设备", async () => {
    const { tech } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const emp = await seedEmployee("E001", "张三", tech.id);
    const account = await prisma.admin.create({
      data: { username: "zhangsan", password: "x", employeeId: emp.id },
    });
    const a1 = await seedIdleAsset("DN-0001");
    const a2 = await seedIdleAsset("DN-0002");
    await prisma.asset.update({ where: { id: a1.id }, data: { status: "IN_USE", employeeId: emp.id } });
    await prisma.asset.update({ where: { id: a2.id }, data: { status: "IN_USE", employeeId: emp.id } });

    const r = await markEmployeeDepart(emp.id, "个人原因");
    expect(r.success).toBe(true);

    // 员工置离职
    const empAfter = await prisma.employee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(empAfter.status).toBe("LEFT");
    // 账号停用
    const accAfter = await prisma.admin.findUniqueOrThrow({ where: { id: account.id } });
    expect(accAfter.isActive).toBe(false);
    // 名下设备全部回收
    const [a1After, a2After] = await Promise.all([
      prisma.asset.findUniqueOrThrow({ where: { id: a1.id } }),
      prisma.asset.findUniqueOrThrow({ where: { id: a2.id } }),
    ]);
    expect(a1After.status).toBe("IDLE");
    expect(a1After.employeeId).toBeNull();
    expect(a2After.status).toBe("IDLE");
    expect(a2After.employeeId).toBeNull();
    // RETURNED 日志
    const logs = await prisma.lifecycleLog.findMany({ where: { assetId: { in: [a1.id, a2.id] }, action: "RETURNED" } });
    expect(logs).toHaveLength(2);
  });

  it("S4 跨部门标记离职 → 被拒", async () => {
    const { tech, ops } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const opsEmp = await seedEmployee("E100", "运营小王", ops.id);
    const r = await markEmployeeDepart(opsEmp.id);
    expect(r.success).toBe(false);
  });

  // ---------------- 部门主管可见的本部门员工列表 ----------------
  it("列表只返回本人主管部门下的在职员工", async () => {
    const { tech, ops } = await seedDepts();
    await seedManagedDeptManager("deptmgr", [tech.id]);
    const e1 = await seedEmployee("E001", "张三", tech.id);
    const e2 = await seedEmployee("E002", "李四", tech.id);
    const opsEmp = await seedEmployee("E100", "运营小王", ops.id);
    // 离职的不再出现
    await prisma.employee.update({ where: { id: e2.id }, data: { status: "LEFT" } });

    const r = await getDepartmentEmployees({});
    expect(r.success).toBe(true);
    const ids = unwrap(r).map((e) => e.id);
    expect(ids).toContain(e1.id);
    expect(ids).not.toContain(e2.id);
    expect(ids).not.toContain(opsEmp.id);
  });
});

// ============================================================
// 部门范围口径：asset.manage / SPEC 走统一口径，非特权路径保持 fail-closed
// ============================================================
describe("部门范围统一口径（asset.manage / SPEC / fail-closed）", () => {
  afterEach(() => setTestUser(null));
  beforeEach(async () => {
    await prisma.lifecycleLog.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  /** 建一个绑定到指定部门的账号（可指定账号级部门范围） */
  async function seedBoundAdmin(
    username: string,
    perms: string[],
    deptId: number,
    scope?: "ALL" | "SPEC" | "EXACT"
  ) {
    const role = await seedRole(`ROLE_${username}`, perms);
    const emp = await prisma.employee.create({
      data: { employeeNo: `NO_${username}`, name: username, departmentId: deptId },
    });
    const admin = await prisma.admin.create({
      data: {
        username,
        password: "x",
        roleId: role.id,
        employeeId: emp.id,
        ...(scope ? { departmentScope: scope } : {}),
      },
    });
    setTestUser({ id: admin.id, username, permissions: perms });
    return { admin, emp };
  }

  it("资产管理员（asset.manage，未设 SPEC）：可在本部门操作员工（旧口径会被误拒）", async () => {
    const { tech } = await seedDepts();
    await seedBoundAdmin("am", ["asset.manage"], tech.id);

    const r = await createDepartmentEmployee({ departmentId: tech.id, name: "本部门新员工" });
    expect(r.success).toBe(true);
    expect(unwrap(r).departmentId).toBe(tech.id);
  });

  it("资产管理员（asset.manage）：仍不可跨部门操作员工", async () => {
    const { tech, ops } = await seedDepts();
    await seedBoundAdmin("am2", ["asset.manage"], tech.id);

    const r = await createDepartmentEmployee({ departmentId: ops.id, name: "外人" });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("无权");
  });

  it("SPEC 为「本部门 + 扩展部门」追加语义：本人所属部门与勾选扩展部门都可操作", async () => {
    const { tech, ops } = await seedDepts();
    const { admin } = await seedBoundAdmin("am3", ["asset.manage"], tech.id, "SPEC");
    // 仅勾选运营部作为扩展
    await prisma.adminDepartment.create({ data: { adminId: admin.id, departmentId: ops.id } });

    // 扩展部门可操作
    const inOps = await createDepartmentEmployee({ departmentId: ops.id, name: "运营新员工" });
    expect(inOps.success).toBe(true);
    // 本人所属部门同样可操作（追加语义，旧「仅取扩展部门」会误拒）
    const inTech = await createDepartmentEmployee({ departmentId: tech.id, name: "技术新员工" });
    expect(inTech.success).toBe(true);
  });

  it("非特权账号（无 asset.manage / system.account.manage / dept.data.view）：即使绑了员工仍被拒（fail-closed）", async () => {
    const { tech } = await seedDepts();
    await seedBoundAdmin("plain2", [], tech.id);

    const r = await createDepartmentEmployee({ departmentId: tech.id, name: "某人" });
    expect(r.success).toBe(false);
    expect(unwrapError(r)).toContain("没有本部门数据权限");
  });

  it("资产管理员无任何部门归属：回退「不限」（可操作任意部门）", async () => {
    const { ops } = await seedDepts();
    const role = await seedRole("ROLE_am4", ["asset.manage"]);
    const admin = await prisma.admin.create({ data: { username: "am4", password: "x", roleId: role.id } });
    setTestUser({ id: admin.id, username: "am4", permissions: ["asset.manage"] });

    const r = await createDepartmentEmployee({ departmentId: ops.id, name: "任意部门新员工" });
    expect(r.success).toBe(true);
  });
});