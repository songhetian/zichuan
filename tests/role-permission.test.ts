import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { getRoles, updateRolePermissions } from "@/actions/admin.actions";
import { hasPermission } from "@/lib/permissions";
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

describe("角色权限配置（M2：可配置权限点）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("超管可列出角色及各自的权限点", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["approval.submit"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const result = await getRoles();
    expect(result.success).toBe(true);
    const roles = unwrap(result);
    const emp = roles.find((r) => r.key === "EMPLOYEE");
    // getRoles 返回「父级含子级」展开后的有效权限集
    expect(emp?.permissions).toEqual(["approval.submit", "approval.new.view", "approval.my.view"]);
  });

  it("超管可重设角色权限并立即生效", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });

    const result = await updateRolePermissions(empRole.id, [
      "approval.submit",
      "asset.view.own",
    ]);
    expect(result.success).toBe(true);

    expect(await hasPermission({ id: emp.id }, "approval.submit")).toBe(true);
    expect(await hasPermission({ id: emp.id }, "asset.view.own")).toBe(true);
  });

  it("重设后移除的权限立即失效", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", ["asset.view.own", "approval.submit"]);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });

    const result = await updateRolePermissions(empRole.id, ["asset.view.own"]);
    expect(result.success).toBe(true);

    expect(await hasPermission({ id: emp.id }, "approval.submit")).toBe(false);
    expect(await hasPermission({ id: emp.id }, "asset.view.own")).toBe(true);
  });

  it("权限 key 不存在时报错", async () => {
    const superRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const boss = await prisma.admin.create({
      data: { username: "boss", password: "x", roleId: superRole.id },
    });
    setTestUser({ id: boss.id, username: "boss" });

    const result = await updateRolePermissions(empRole.id, ["no.such.permission"]);
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });

  it("非超管调用被拒", async () => {
    const empRole = await seedRole("EMPLOYEE", "普通员工", []);
    const emp = await prisma.admin.create({
      data: { username: "emp1", password: "x", roleId: empRole.id },
    });
    setTestUser({ id: emp.id, username: "emp1" });

    const result = await getRoles();
    expect(result.success).toBe(false);
    expect(unwrapError(result)).toContain("权限");
  });
});
