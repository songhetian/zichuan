import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import {
  createAdmin,
  getAdmins,
  updateAdminRole,
  setAdminActive,
} from "@/actions/admin.actions";
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

describe("用户/角色管理（M2）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("超管可列出所有账号（含角色与停用态）", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    await createAdmin({
      username: "zhangsan",
      password: "pass123",
      roleId: empRole.id,
      displayName: "张三",
    });

    const result = await getAdmins();
    expect(result.success).toBe(true);
    const list = unwrap(result);
    expect(list).toHaveLength(2);
    const zs = list.find((a) => a.username === "zhangsan");
    expect(zs?.role?.key).toBe("EMPLOYEE");
    expect(zs?.displayName).toBe("张三");
    expect(zs?.isActive).toBe(true);
  });

  it("超管可修改账号角色", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const deptRole = await seedRole("DEPT_MANAGER", "部门主管", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const created = unwrap(
      await createAdmin({ username: "zhangsan", password: "pass123", roleId: empRole.id })
    );

    const result = await updateAdminRole(created.id, deptRole.id);
    expect(result.success).toBe(true);

    const admin = await prisma.admin.findUnique({
      where: { id: created.id },
      include: { role: true },
    });
    expect(admin?.role?.key).toBe("DEPT_MANAGER");
  });

  it("超管可停用账号，停用后该账号不能登录", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const created = unwrap(
      await createAdmin({ username: "zhangsan", password: "pass123", roleId: empRole.id })
    );
    const disabled = await setAdminActive(created.id, false);
    expect(disabled.success).toBe(true);

    setTestUser(null);
    const loginResult = await login({ username: "zhangsan", password: "pass123" });
    expect(loginResult.success).toBe(false);
    expect(unwrapError(loginResult)).toContain("停用");
  });

  it("不允许停用自己的账号", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const result = await setAdminActive(boss.id, false);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("自己");
  });

  it("roleId 不存在时改角色失败", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const created = unwrap(
      await createAdmin({ username: "zhangsan", password: "pass123", roleId: empRole.id })
    );

    const result = await updateAdminRole(created.id, 99999);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("角色");
  });

  it("非超管调用被拒", async () => {
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });
    setTestUser({ id: emp.id, username: "emp1" });

    const result = await getAdmins();
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });
});
