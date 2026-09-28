import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unwrap, unwrapError } from "./helpers";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import { resolveDepartmentScope } from "@/lib/permissions";
import { setAccountDepartmentScope, getAdmins } from "@/actions/admin.actions";
import { getAssets } from "@/actions/asset.actions";
import { getUpgradeAssetOptions } from "@/lib/approval-scope";

/** 建角色（仅权限，不承载部门范围）；permissions = 拥有的权限 key */
async function seedRole(key: string, name: string, permissions: string[]) {
  const role = await prisma.role.create({
    data: { key, name, isSystem: true },
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

describe("账号部门范围（d4：账号可操作哪些部门，范围下放到账号级）", () => {
  beforeEach(async () => {
    await prisma.adminDepartment.deleteMany();
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

  describe("resolveDepartmentScope", () => {
    it("账号 departmentScope=SPEC 时返回关联部门 id 列表", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const admin = await prisma.admin.create({
        data: { username: "am", password: "x", roleId: role.id, departmentScope: "SPEC", departmentLinks: { create: [{ departmentId: d1 }, { departmentId: d2 }] } },
      });

      expect(await resolveDepartmentScope({ id: admin.id })).toEqual([d1, d2]);
    });

    it("账号 departmentScope=EXACT（迁移旧精确限定）时仅返回 departmentLinks，不含主管部门/所属部门", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      // 账号属于 d1、管辖 d1，但 EXACT 仅关联 d2 → 只返回 d2，结构与旧「角色级精确限定」一致（收窄）
      const emp = await prisma.employee.create({
        data: { employeeNo: "E9", name: "管理员", departmentId: d1, managedDepartments: { connect: [{ id: d1 }] } },
      });
      const admin = await prisma.admin.create({
        data: {
          username: "exact-am",
          password: "x",
          roleId: role.id,
          employeeId: emp.id,
          departmentScope: "EXACT",
          departmentLinks: { create: [{ departmentId: d2 }] },
        },
      });

      expect(await resolveDepartmentScope({ id: admin.id })).toEqual([d2]);
    });

    it("账号 departmentScope=EXACT 且无关联部门时回退 'ALL'", async () => {
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const admin = await prisma.admin.create({ data: { username: "exact-empty", password: "x", roleId: role.id, departmentScope: "EXACT" } });

      expect(await resolveDepartmentScope({ id: admin.id })).toBe("ALL");
    });

    it("账号默认范围（非SPEC）返回本人所属部门", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const emp = await prisma.employee.create({ data: { employeeNo: "E1", name: "张三", departmentId: d1 } });
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id, employeeId: emp.id } });

      expect(await resolveDepartmentScope({ id: admin.id })).toEqual([d1]);
    });

    it("账号默认范围含主管部门（managedDepartments）", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("DEPARTMENT_MANAGER", "部门主管", ["dept.data.view"]);
      const emp = await prisma.employee.create({
        data: { employeeNo: "E2", name: "李四", departmentId: d1, managedDepartments: { connect: [{ id: d2 }] } },
      });
      const admin = await prisma.admin.create({ data: { username: "dm", password: "x", roleId: role.id, employeeId: emp.id } });

      expect(await resolveDepartmentScope({ id: admin.id })).toEqual(expect.arrayContaining([d1, d2]));
    });

    it("无任何部门归属（未绑员工/未设扩展）时回退 'ALL'，避免资产管理员被限空", async () => {
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const admin = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });

      expect(await resolveDepartmentScope({ id: admin.id })).toBe("ALL");
    });

    it("拥有 system.account.manage（超管）返回 'ALL'，不受 SPEC 影响", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const role = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const admin = await prisma.admin.create({
        data: { username: "boss", password: "x", roleId: role.id, departmentScope: "SPEC", departmentLinks: { create: [{ departmentId: d1 }] } },
      });

      expect(await resolveDepartmentScope({ id: admin.id })).toBe("ALL");
    });
  });

  describe("setAccountDepartmentScope", () => {
    it("可设置 SPEC + 指定部门，getAdmins 能读到", async () => {
      const [d1, d2] = await seedDepartments(["技术部", "财务部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const target = await prisma.admin.create({ data: { username: "am", password: "x", roleId: role.id } });
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setAccountDepartmentScope(target.id, { scope: "SPEC", departmentIds: [d1, d2] });
      expect(res.success).toBe(true);

      const admins = unwrap(await getAdmins());
      const am = admins.find((a) => a.id === target.id)!;
      expect(am.departmentScope).toBe("SPEC");
      expect(am.departmentIds).toEqual([d1, d2]);
    });

    it("可切回 ALL 并清空部门关联", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const role = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const target = await prisma.admin.create({
        data: { username: "am", password: "x", roleId: role.id, departmentScope: "SPEC", departmentLinks: { create: [{ departmentId: d1 }] } },
      });
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setAccountDepartmentScope(target.id, { scope: "ALL", departmentIds: [] });
      expect(res.success).toBe(true);

      const admins = unwrap(await getAdmins());
      const am = admins.find((a) => a.id === target.id)!;
      expect(am.departmentScope).toBe("ALL");
      expect(am.departmentIds).toEqual([]);
    });

    it("超级管理员账号不可限定部门范围", async () => {
      const [d1] = await seedDepartments(["技术部"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });

      const res = await setAccountDepartmentScope(boss.id, { scope: "SPEC", departmentIds: [d1] });
      expect(res.success).toBe(false);
      expect(unwrapError(res)).toContain("不可限定部门范围");
    });

    it("无账号管理权限者被拒绝", async () => {
      setTestUser({ id: 999, username: "tester", permissions: ["asset.view.own"] });
      const res = await setAccountDepartmentScope(1, { scope: "SPEC", departmentIds: [] });
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
      return { dept1, a1: a1 as { id: number }, a2: a2 as { id: number }, aIdle: aIdle as { id: number } };
    }

    it("账号限定到技术部时，仅见技术部持有设备（不含财务部/闲置机）", async () => {
      const { dept1, a1, a2, aIdle } = await setupSpecAssets();
      const amRole = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const am = await prisma.admin.create({ data: { username: "am", password: "x", roleId: amRole.id } });
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" }); // 以超管身份设置账号范围
      await setAccountDepartmentScope(am.id, { scope: "SPEC", departmentIds: [dept1] });
      setTestUser({ id: am.id, username: "am" }); // 无注入权限 → 走真实 DB 角色判定

      const list = unwrap(await getAssets());
      expect(list.some((x) => x.id === a1.id)).toBe(true);
      expect(list.some((x) => x.id === a2.id)).toBe(false);
      expect(list.some((x) => x.id === aIdle.id)).toBe(false);
    });

    it("发起申请可选设备同样受部门范围限制", async () => {
      const { dept1, a1, a2 } = await setupSpecAssets();
      const amRole = await seedRole("ASSET_MANAGER", "资产管理员", ["asset.manage"]);
      const bossRole = await seedRole("SUPER_ADMIN", "超级管理员", ["system.account.manage"]);
      const am = await prisma.admin.create({ data: { username: "am", password: "x", roleId: amRole.id } });
      const boss = await prisma.admin.create({ data: { username: "boss", password: "x", roleId: bossRole.id } });
      setTestUser({ id: boss.id, username: "boss" });
      await setAccountDepartmentScope(am.id, { scope: "SPEC", departmentIds: [dept1] });
      setTestUser(null);

      const options = await getUpgradeAssetOptions(am.id);
      const ids = options.map((o) => o.id);
      expect(ids).toContain(a1.id);
      expect(ids).not.toContain(a2.id);
    });
  });
});