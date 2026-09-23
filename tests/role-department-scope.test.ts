import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { resolveRoleDepartmentScope } from "@/lib/permissions";
import { setRoleDepartmentScope, getRoles } from "@/actions/admin.actions";
import { getAssets } from "@/actions/asset.actions";
import { getUpgradeAssetOptions } from "@/lib/approval-scope";

/** 建角色（可带显式部门范围）；permissions = 拥有的权限 key */
async function seedRole(
  key: string,
  name: string,
  permissions: string[],
  opts: { scope?: "ALL" | "SPEC"; departmentIds?: number[] } = {}
) {
  const role = await prisma.role.create({
    data: {
      key,
      name,
      isSystem: true,
      departmentScope: opts.scope ?? "ALL",
      departments: opts.departmentIds
        ? { create: opts.departmentIds.map((departmentId) => ({ departmentId })) }
        : undefined,
    },
  });
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

async function seedDepartments(names: string[]) {
  const ids: number[] = [];
  for (const n of names) {
    const d = await prisma.department.create({ data: { name: n } });
    ids.push(d.id);
  }
  return ids;
}

describe("角色部门范围（d4：资产管理员可操作哪些部门）", () => {
  beforeEach(async () => {
    await prisma.roleDepartment.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.deviceTemplate.deleteMany();
    await prisma.assetCategory.deleteMany();
    await prisma.employee.deleteMany();
    await prisma.department.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  describe("resolveRoleDepartmentScope", () => {
    it("角色 departmentScope=SPEC 时返回关联部门 id 列表", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"], {
        scope: "SPEC",
        departmentIds: [d1, d2],
      });
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });

      expect(await resolveRoleDepartmentScope({ id: admin.id })).toEqual([d1, d2]);
    });

    it("角色默认范围（ALL）返回 'ALL'", async () => {
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });

      expect(await resolveRoleDepartmentScope({ id: admin.id })).toBe("ALL");
    });

    it("拥有 system.account.manage（超管）返回 'ALL'，不受 SPEC 影响", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const role = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"], {
        scope: "SPEC",
        departmentIds: [d1],
      });
      const admin = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: role.id } });

      expect(await resolveRoleDepartmentScope({ id: admin.id })).toBe("ALL");
    });
  });

  describe("setRoleDepartmentScope", () => {
    it("可设置 SPEC + 指定部门，getRoles 能读到", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setRoleDepartmentScope(role.id, { scope: "SPEC", departmentIds: [d1, d2] });
      expect(res.success).toBe(true);

      const roles = unwrap(await getRoles());
      const am = roles.find((r) => r.id === role.id)!;
      expect(am.departmentScope).toBe("SPEC");
      expect(am.departmentIds).toEqual([d1, d2]);
    });

    it("可切回 ALL 并清空部门关联", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"], {
        scope: "SPEC",
        departmentIds: [d1],
      });
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setRoleDepartmentScope(role.id, { scope: "ALL", departmentIds: [] });
      expect(res.success).toBe(true);

      const roles = unwrap(await getRoles());
      const am = roles.find((r) => r.id === role.id)!;
      expect(am.departmentScope).toBe("ALL");
      expect(am.departmentIds).toEqual([]);
    });

    it("超级管理员不可限定部门范围", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setRoleDepartmentScope(bossRole.id, { scope: "SPEC", departmentIds: [d1] });
      expect(res.success).toBe(false);
      expect(unwrapError(res)).toContain("超级管理员");
    });

    it("无账号管理权限者被拒绝", async () => {
      setTestUser({ id: 999, username: "tester", permissions: ["asset.view.own"] });
      const res = await setRoleDepartmentScope(1, { scope: "SPEC", departmentIds: [] });
      expect(res.success).toBe(false);
      expect(unwrapError(res)).toContain("权限");
    });
  });

  describe("数据隔离集成（getAssets / getUpgradeAssetOptions）", () => {
    /** 造：技术部、财务部两部门，各 1 名员工各 1 台设备，另加 1 台闲置机 */
    async function setupSpecAssets() {
      const [dept1, dept2] = await seedDepartments(["技术部", "财务部"]);
      const e1 = await prisma.employee.create({ data: { employeeNo: "E1", name: "张三", departmentId: dept1 } });
      const e2 = await prisma.employee.create({ data: { employeeNo: "E2", name: "李四", departmentId: dept2 } });
      const cat = await prisma.assetCategory.create({ data: { name: "电脑", code: "DN" } });
      const template = await prisma.deviceTemplate.create({ data: { name: "标准办公电脑", categoryId: cat.id } });
      const a1 = await prisma.asset.create({
        data: { assetNo: "DN-1", name: "技术部设备", templateId: template.id, status: "IN_USE", employeeId: e1.id },
      });
      const a2 = await prisma.asset.create({
        data: { assetNo: "DN-2", name: "财务部设备", templateId: template.id, status: "IN_USE", employeeId: e2.id },
      });
      const aIdle = await prisma.asset.create({
        data: { assetNo: "DN-X", name: "闲置机", templateId: template.id, status: "IDLE" },
      });
      return { dept1, dept2, a1: a1 as { id: number }, a2: a2 as { id: number }, aIdle: aIdle as { id: number } };
    }

    it("资产管理员限定到技术部时，仅见技术部持有设备（不含财务部/闲置机）", async () => {
      const { dept1, a1, a2, aIdle } = await setupSpecAssets();
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"], {
        scope: "SPEC",
        departmentIds: [dept1],
      });
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });
      setTestUser({ id: admin.id, username: "am" }); // 无注入权限 → 走真实 DB 角色判定

      const list = unwrap(await getAssets());
      expect(list.some((x) => x.id === a1.id)).toBe(true);
      expect(list.some((x) => x.id === a2.id)).toBe(false);
      expect(list.some((x) => x.id === aIdle.id)).toBe(false);
    });

    it("发起申请可选设备同样受部门范围限制", async () => {
      const { dept1, a1, a2 } = await setupSpecAssets();
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"], {
        scope: "SPEC",
        departmentIds: [dept1],
      });
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });

      const options = await getUpgradeAssetOptions(admin.id);
      const ids = options.map((o) => o.id);
      expect(ids).toContain(a1.id);
      expect(ids).not.toContain(a2.id);
    });
  });
});