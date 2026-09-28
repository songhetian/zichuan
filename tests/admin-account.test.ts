import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createAdmin } from "@/actions/admin.actions";
import { login } from "@/actions/auth.actions";
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

// 自建部门 + 员工（dependency：Employee 必填 departmentId；编号/部门名用递增计数保证全局唯一）
let seedSeq = 0;
async function seedEmployee(name: string) {
  seedSeq += 1;
  const dept = await prisma.department.create({
    data: { name: `测试部-${Date.now()}-${seedSeq}` },
  });
  return prisma.employee.create({
    data: { employeeNo: `SEED-${Date.now()}-${seedSeq}`, name, departmentId: dept.id },
  });
}

describe("账号管理（M1：创建账号 + 角色绑定）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("超管可创建账号并绑定角色", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const deptRole = await seedRole("DEPT_MANAGER", "部门主管", []);
    const emp = await seedEmployee("张三");
    const result = await createAdmin({
      username: "zhangsan",
      password: "pass123",
      roleId: deptRole.id,
      displayName: "张三",
      employeeId: emp.id,
    });

    expect(result.success).toBe(true);
    const admin = await prisma.admin.findUnique({
      where: { username: "zhangsan" },
      include: { role: true },
    });
    expect(admin?.role?.key).toBe("DEPT_MANAGER");
    expect(admin?.displayName).toBe("张三");
    expect(admin?.isActive).toBe(true);
  });

  it("用户名重复时创建失败", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const emp1 = await seedEmployee("张三");
    const emp2 = await seedEmployee("李四");
    await createAdmin({ username: "zhangsan", password: "pass123", roleId: empRole.id, employeeId: emp1.id });
    const result = await createAdmin({ username: "zhangsan", password: "pass456", roleId: empRole.id, employeeId: emp2.id });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("已存在");
  });

  it("新账号可以登录", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const emp = await seedEmployee("李四");
    await createAdmin({ username: "lisi", password: "secret123", roleId: empRole.id, employeeId: emp.id });

    setTestUser(null);
    const result = await login({ username: "lisi", password: "secret123" });
    expect(result.success).toBe(true);
  });

  it("非超管不能创建账号", async () => {
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["asset.view.own"]);
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });
    setTestUser({ id: emp.id, username: "emp1" });

    const hackerEmp = await seedEmployee("黑客");
    const result = await createAdmin({ username: "hacker", password: "pass123", roleId: empRole.id, employeeId: hackerEmp.id });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });

  it("未登录不能创建账号", async () => {
    setTestUser(null);
    const ghostRole = await seedRole("EMPLOYEE", "普通员工", []);
    const ghostEmp = await seedEmployee("幽灵");
    const result = await createAdmin({ username: "ghost", password: "pass123", roleId: ghostRole.id, employeeId: ghostEmp.id });
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("登录");
  });
});
