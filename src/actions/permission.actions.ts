"use server";

import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth";
import { expandEffective, ROLE_PERMISSION_MATRIX, RoleKey } from "@/lib/permissions";

/** 当前登录账号的权限点集合（已展开为页面/操作级）与角色 key（前端菜单裁剪 / 路由拦截用） */
export async function getMyPermissions(): Promise<
  ActionResult<{ role: RoleKey | null; permissions: string[] }>
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "未登录" };

  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });

  const role = (admin?.role?.key as RoleKey | undefined) ?? null;
  // 存在显式配置则取角色-权限关联；否则回退内置角色矩阵（兜底，保证默认角色可用）
  const explicit = admin?.role?.permissions.map((rp) => rp.permission.key) ?? [];
  const fallback = role ? [...(ROLE_PERMISSION_MATRIX[role as RoleKey] ?? [])] : [];
  const granted = explicit.length > 0 ? explicit : fallback;
  // 父级含子级：展开为有效权限集合（页面/操作级）
  const permissions = Array.from(expandEffective(granted));

  return { success: true, data: { role, permissions } };
}