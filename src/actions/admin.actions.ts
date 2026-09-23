"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireAuthSafe } from "@/lib/auth";
import { guardPermission, PERMISSIONS, expandEffective } from "@/lib/permissions";

const createAdminSchema = z.object({
  username: z.string().min(1, "用户名不能为空"),
  password: z.string().min(6, "密码至少 6 位"),
  roleId: z.number().int().positive().optional(),
  displayName: z.string().optional(),
  employeeId: z.number().int().positive().optional(),
});

const updateAdminRoleSchema = z.object({
  roleId: z.number().int().positive().nullable(),
});

export async function createAdmin(
  input: z.infer<typeof createAdminSchema>
): Promise<ActionResult<{ id: number; username: string }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    const validated = createAdminSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
    }

    const { username, password, roleId, displayName, employeeId } = validated.data;

    const existing = await prisma.admin.findUnique({ where: { username } });
    if (existing) {
      return { success: false, error: "用户名已存在" };
    }

    if (employeeId != null) {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });
      if (!emp) {
        return { success: false, error: "员工不存在" };
      }
      const bound = await prisma.admin.findUnique({ where: { employeeId } });
      if (bound) {
        return { success: false, error: "该员工已被其他账号绑定" };
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await prisma.admin.create({
      data: { username, password: hashed, roleId, displayName, employeeId },
    });

    return { success: true, data: { id: admin.id, username: admin.username } };
  });
}

/** 守卫：仅拥有「账号与权限管理」权限点的账号可操作（统一走 guardPermission） */
async function guardAccountManage(user: { id: number }): Promise<ActionResult<never> | null> {
  return guardPermission(user, "system.account.manage", "没有管理账号的权限");
}

/** 全部账号列表（含角色/显示名/停用态/关联员工） */
export async function getAdmins(): Promise<
  ActionResult<
    {
      id: number;
      username: string;
      displayName: string | null;
      isActive: boolean;
      role: { key: string; name: string } | null;
      employee: { id: number; name: string } | null;
    }[]
  >
> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    const admins = await prisma.admin.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
        role: { select: { key: true, name: true } },
        employee: { select: { id: true, name: true } },
      },
    });
    return { success: true, data: admins };
  });
}

/** 修改账号角色（roleId 传 null = 移除角色） */
export async function updateAdminRole(
  id: number,
  roleId: number | null
): Promise<ActionResult<{ id: number }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    if (roleId != null) {
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) return { success: false, error: "角色不存在" };
    }
    const target = await prisma.admin.findUnique({ where: { id } });
    if (!target) return { success: false, error: "账号不存在" };

    await prisma.admin.update({ where: { id }, data: { roleId } });
    return { success: true, data: { id } };
  });
}

/** 停用/启用账号（离职即停用，不删账号）；不允许操作自己的账号 */
export async function setAdminActive(
  id: number,
  isActive: boolean
): Promise<ActionResult<{ id: number; isActive: boolean }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    if (user.id === id) {
      return { success: false, error: "不能停用或修改自己的账号" };
    }
    const target = await prisma.admin.findUnique({ where: { id } });
    if (!target) return { success: false, error: "账号不存在" };

    await prisma.admin.update({ where: { id }, data: { isActive } });
    return { success: true, data: { id, isActive } };
  });
}

/** 角色列表（含各自权限点 key） */
export async function getRoles(): Promise<
  ActionResult<
    {
      id: number;
      key: string;
      name: string;
      isSystem: boolean;
      departmentScope: string;
      departmentIds: number[];
      permissions: string[];
    }[]
  >
> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    const roles = await prisma.role.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        isSystem: true,
        departmentScope: true,
        departments: { select: { departmentId: true } },
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    return {
      success: true,
      data: roles.map((r) => ({
        ...r,
        departmentIds: r.departments.map((d) => d.departmentId),
        permissions: Array.from(expandEffective(r.permissions.map((x) => x.permission.key))),
      })),
    };
  });
}

/** 重设角色权限点（全量覆盖：传入的 key 集合即该角色最终权限） */
export async function updateRolePermissions(
  roleId: number,
  permissionKeys: string[]
): Promise<ActionResult<{ id: number }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return { success: false, error: "角色不存在" };

    // 以代码目录 PERMISSIONS 为准校验 key 合法性（防止写入目录外的权限点）
    const unknownKey = permissionKeys.find(
      (k) => !PERMISSIONS.some((p) => p.key === k)
    );
    if (unknownKey) {
      return { success: false, error: "包含不存在的权限点" };
    }

    // 父级含子级在 UI 交互与读取时展开；此处按当前勾选集合原样保存，
    // 从而支持“保留父级、单独取消某个子级”的细化控制。
    const effective = permissionKeys;

    await prisma.$transaction(async (tx) => {
      // 逐 key 确保权限行存在（新 key 自动建档，元数据取自代码目录）
      const permRows: { id: number }[] = [];
      for (const def of PERMISSIONS.filter((p) => effective.includes(p.key))) {
        const row = await tx.permission.upsert({
          where: { key: def.key },
          update: { module: def.module, name: def.name },
          create: { key: def.key, module: def.module, name: def.name },
        });
        permRows.push(row);
      }
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: permRows.map((p) => ({ roleId, permissionId: p.id })),
      });
    });
    return { success: true, data: { id: roleId } };
  });
}

const roleScopeSchema = z.object({
  // 'ALL'（不限，沿用权限矩阵默认范围）| 'SPEC'（仅 departments 关联部门）
  scope: z.enum(["ALL", "SPEC"]),
  departmentIds: z.array(z.number().int().positive()).default([]),
});

/**
 * 设置角色数据范围（部门范围）：
 * - scope='ALL'：清除部门限定（角色沿用权限矩阵默认范围）
 * - scope='SPEC'：把角色限定到所列部门（资产见部门内持有设备、人员仅这些部门）
 * 超级管理员（SUPER_ADMIN）不可限定部门。
 */
export async function setRoleDepartmentScope(
  roleId: number,
  input: z.infer<typeof roleScopeSchema>
): Promise<ActionResult<{ id: number }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardAccountManage(user);
    if (denied) return denied;

    const validated = roleScopeSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return { success: false, error: "角色不存在" };
    if (role.key === "SUPER_ADMIN" && validated.data.scope === "SPEC") {
      return { success: false, error: "超级管理员不可限定部门范围" };
    }

    const deptIds = validated.data.departmentIds;
    if (validated.data.scope === "SPEC" && deptIds.length > 0) {
      const count = await prisma.department.count({ where: { id: { in: deptIds } } });
      if (count !== deptIds.length) return { success: false, error: "包含不存在的部门" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.roleDepartment.deleteMany({ where: { roleId } });
      await tx.role.update({ where: { id: roleId }, data: { departmentScope: validated.data.scope } });
      if (validated.data.scope === "SPEC" && deptIds.length > 0) {
        await tx.roleDepartment.createMany({
          data: deptIds.map((departmentId) => ({ roleId, departmentId })),
        });
      }
    });
    return { success: true, data: { id: roleId } };
  });
}
