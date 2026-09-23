import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { createAdmin, getAdmins } from "@/actions/admin.actions";
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

async function seedSuperAdmin() {
  const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
  const boss = await prisma.admin.create({
    data: { username: "boss", password: "x", roleId: superRole.id },
  });
  setTestUser({ id: boss.id, username: "boss" });
  return boss;
}

describe("创建账号时绑定员工（M2：全员登录账号）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
    await prisma.employee.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("创建账号时可绑定员工，列表显示绑定关系", async () => {
    await seedSuperAdmin();
    const deptRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    const result = await createAdmin({
      username: "zhangsan",
      password: "pass123",
      roleId: deptRole.id,
      employeeId: emp.id,
    });
    expect(result.success).toBe(true);

    const admins = unwrap(await getAdmins());
    const zhangsan = admins.find((a) => a.username === "zhangsan");
    expect(zhangsan?.employee?.name).toBe("张三");
  });

  it("员工已被其他账号绑定时报错", async () => {
    await seedSuperAdmin();
    const dept = await prisma.department.create({ data: { name: "技术部" } });
    const emp = await prisma.employee.create({
      data: { employeeNo: "E001", name: "张三", departmentId: dept.id },
    });

    await createAdmin({ username: "zhangsan", password: "pass123", employeeId: emp.id });
    const result = await createAdmin({ username: "lisi", password: "pass123", employeeId: emp.id });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("已被");
  });

  it("员工不存在时报错", async () => {
    await seedSuperAdmin();

    const result = await createAdmin({ username: "ghost", password: "pass123", employeeId: 999999 });

    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("员工");
  });
});
