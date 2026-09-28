"use server";

import { ActionResult } from "@/lib/types";
import { handleUniqueViolation } from "@/lib/prisma-error";
import { generateEmployeeNo } from "@/lib/employee-no";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireAuthSafe } from "@/lib/auth";
import { guardPermission, resolveEmployeeScope } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { createNotifications } from "@/lib/notification";
import { pushNotificationLive } from "@/lib/socket-pusher";
import bcrypt from "bcryptjs";

const createSchema = z.object({
  // 工号可选：不传时自动生成（如 EMP0001），传了则使用自定义工号
  employeeNo: z.string().min(1, "工号不能为空").optional(),
  name: z.string().min(1, "姓名不能为空"),
  departmentId: z.number(),
  phone: z.string().optional(),
  email: z.string().optional(),
  // 角色（仅拥有账号管理权限时生效，默认普通员工）；null = 不分配角色
  roleId: z.number().int().positive().nullable().optional(),
});

const updateSchema = z.object({
  employeeNo: z.string().min(1, "工号不能为空").optional(),
  name: z.string().min(1, "姓名不能为空").optional(),
  departmentId: z.number().optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  // 修改员工时同步调整绑定账号的角色
  roleId: z.number().int().positive().nullable().optional(),
});

const querySchema = z.object({
  departmentId: z.number().optional(),
  keyword: z.string().optional(),
});

type EmployeeWithDept = {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  departmentName: string;
  phone: string | null;
  email: string | null;
  assetCount: number;
  createdAt: string;
};

type PrismaEmployee = {
  id: number;
  employeeNo: string;
  name: string;
  departmentId: number;
  createdAt: Date;
  department: { name: string } | null;
  phone: string | null;
  email: string | null;
  _count?: { assets: number };
};

function formatEmployee(emp: PrismaEmployee): EmployeeWithDept {
  return {
    id: emp.id,
    employeeNo: emp.employeeNo,
    name: emp.name,
    departmentId: emp.departmentId,
    departmentName: emp.department?.name ?? "",
    phone: emp.phone ?? null,
    email: emp.email ?? null,
    assetCount: emp._count?.assets ?? 0,
    createdAt: emp.createdAt.toISOString(),
  };
}

/** 新建员工自动创建登录账号（登录名=工号、默认密码 123456、首登强制改密） */
export async function createEmployee(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardPermission(user, "system.account.manage", "员工与账号管理需要账号管理权限");
    if (denied) return denied;

    const validated = createSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
    }

    const { employeeNo: inputNo, name, departmentId, phone, email, roleId } = validated.data;

    // 检查部门是否存在
    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) {
      return { success: false, error: "部门不存在" };
    }

    // 角色解析：显式传角色需账号管理权限；未传时默认普通员工（EMPLOYEE）
    let effectiveRoleId: number | null = null;
    if (roleId != null) {
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role) return { success: false, error: "角色不存在" };
      effectiveRoleId = roleId;
    } else {
      const empRole = await prisma.role.findUnique({ where: { key: "EMPLOYEE" } });
      effectiveRoleId = empRole?.id ?? null;
    }

    // 未提供工号时自动生成（EMP + 4 位序号）
    let employeeNo = inputNo;
    if (!employeeNo) {
      const existingNos = await prisma.employee.findMany({ select: { employeeNo: true } });
      employeeNo = generateEmployeeNo(existingNos.map((e) => e.employeeNo));
    }

    // 登录名=工号，占用则不可重复建账号
    const existingAccount = await prisma.admin.findUnique({ where: { username: employeeNo } });
    if (existingAccount) {
      return { success: false, error: "账号已存在" };
    }

    const hashed = await bcrypt.hash("123456", 10);
    try {
      const emp = await prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            employeeNo,
            name,
            departmentId,
            phone: phone ?? null,
            email: email ?? null,
          },
          include: { department: { select: { name: true } } },
        });
        // 自动创建登录账号：登录名=工号、默认密码 123456、首登强制改密
        await tx.admin.create({
          data: {
            username: employeeNo,
            password: hashed,
            roleId: effectiveRoleId,
            displayName: name,
            employeeId: created.id,
            mustChangePassword: true,
          },
        });
        return created;
      });
      return { success: true, data: formatEmployee(emp) };
    } catch (e) {
      return handleUniqueViolation(
        e,
        { employeeNo: "工号已存在", username: "账号已存在" },
        "创建失败"
      );
    }
  });
}

export async function getEmployees(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<EmployeeWithDept[]>> {
  const user = await requireAuth();

  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { departmentId, keyword } = validated.data;

  // 数据范围过滤（统一口径）：与资产列表一致地按部门收敛可见员工
  const scope = await resolveEmployeeScope(user.id);

  const where: Prisma.EmployeeWhereInput = {};
  if (departmentId != null) {
    where.departmentId = departmentId;
  }
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { employeeNo: { contains: keyword } },
    ];
  }

  const emps = await prisma.employee.findMany({
    where: scope ? { AND: [where, scope] } : where,
    orderBy: { createdAt: "desc" },
    include: {
      department: { select: { name: true } },
      _count: { select: { assets: true } },
    },
  });

  return { success: true, data: emps.map(formatEmployee) };
}

export async function getEmployeeById(
  id: number
): Promise<ActionResult<EmployeeWithDept>> {
  const user = await requireAuth();

  // 数据范围过滤（统一口径）：范围外员工按「不存在」处理，避免越权读取
  const scope = await resolveEmployeeScope(user.id);
  const emp = await prisma.employee.findFirst({
    where: { AND: [{ id }, ...(scope ? [scope] : [])] },
    include: { department: { select: { name: true } } },
  });
  if (!emp) {
    return { success: false, error: "员工不存在" };
  }
  return { success: true, data: formatEmployee(emp) };
}

/** 修改员工（可同步调整绑定账号的角色，需账号管理权限） */
export async function updateEmployee(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<EmployeeWithDept>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardPermission(user, "system.account.manage", "员工与账号管理需要账号管理权限");
    if (denied) return denied;

    const validated = updateSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
    }

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: "员工不存在" };
    }

    // 如果改部门，检查新部门是否存在
    if (validated.data.departmentId != null) {
      const dept = await prisma.department.findUnique({
        where: { id: validated.data.departmentId },
      });
      if (!dept) {
        return { success: false, error: "目标部门不存在" };
      }
    }

    // 角色变更：仅账号管理权限可改，且需校验角色存在
    let roleChanged = false;
    let newRole: { name: string } | null = null;
    if (validated.data.roleId != null) {
      const role = await prisma.role.findUnique({ where: { id: validated.data.roleId } });
      if (!role) return { success: false, error: "角色不存在" };
      newRole = role;
      roleChanged = true;
    }

    // 变更角色时，查找绑定账号（含当前角色），用于通知被修改的员工本人
    let targetAccount: { id: number; roleId: number | null; role: { name: string } | null } | null = null;
    if (roleChanged) {
      targetAccount = await prisma.admin.findUnique({
        where: { employeeId: id },
        select: { id: true, roleId: true, role: { select: { name: true } } },
      });
      if (!targetAccount) {
        return { success: false, error: "该员工没有登录账号，无法修改角色，请先通过新建员工自动创建账号" };
      }
      // 角色未变化时不发通知、不重复更新
      if (targetAccount.roleId === validated.data.roleId) {
        roleChanged = false;
      }
    }

    const { roleId, employeeNo, ...restEmpData } = validated.data;

    // 工号变更时同步绑定账号登录名（登录名=工号），并预检新工号是否被其他员工占用
    let accountLoginChanged = false;
    if (employeeNo != null && employeeNo !== existing.employeeNo) {
      const occupied = await prisma.employee.findUnique({ where: { employeeNo } });
      if (occupied && occupied.id !== id) {
        return { success: false, error: "工号已存在" };
      }
      accountLoginChanged = true;
    }
    const empData = employeeNo != null ? { ...restEmpData, employeeNo } : restEmpData;

    try {
      const emp = await prisma.$transaction(async (tx) => {
        const updated = await tx.employee.update({
          where: { id },
          data: empData,
          include: { department: { select: { name: true } } },
        });
        // 工号变更 → 同步登录账号登录名，保证「登录名=工号」一致
        if (accountLoginChanged) {
          await tx.admin.updateMany({ where: { employeeId: id }, data: { username: employeeNo! } });
        }
        // 同步更新绑定账号的角色（一个员工最多一个账号），并通知被修改的员工本人
        if (roleChanged) {
          await tx.admin.updateMany({ where: { employeeId: id }, data: { roleId } });
          if (targetAccount) {
            await createNotifications(tx, [
              {
                adminId: targetAccount.id,
                requestId: null,
                type: "SYSTEM",
                title: "角色变更通知",
                content: `您的账号角色已由「${targetAccount.role?.name ?? "未分配"}」调整为「${newRole?.name ?? ""}」。`,
              },
            ]);
          }
        }
        return updated;
      });

      // 事务提交后触发实时推送（目标不在线时静默跳过）
      if (roleChanged && targetAccount && newRole) {
        pushNotificationLive(targetAccount.id, {
          requestId: null,
          title: "角色变更通知",
          content: `您的账号角色已由「${targetAccount.role?.name ?? "未分配"}」调整为「${newRole.name}」。`,
          createdAt: new Date().toISOString(),
        });
      }

      return { success: true, data: formatEmployee(emp) };
    } catch (e) {
      return handleUniqueViolation(e, { employeeNo: "工号已存在" }, "更新失败");
    }
  });
}

/**
 * 重置员工登录密码为 123456（需账号管理权限）。
 * 重置后该员工下次登录需强制修改密码。
 */
export async function resetEmployeePassword(
  employeeId: number
): Promise<ActionResult<{ id: number }>> {
  return requireAuthSafe(async (user) => {
    const denied = await guardPermission(user, "system.account.manage", "重置密码需要账号管理权限");
    if (denied) return denied;

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return { success: false, error: "员工不存在" };
    const account = await prisma.admin.findUnique({ where: { employeeId } });
    if (!account) return { success: false, error: "该员工没有登录账号" };

    const hashed = await bcrypt.hash("123456", 10);
    await prisma.admin.update({
      where: { id: account.id },
      data: { password: hashed, mustChangePassword: true },
    });
    return { success: true, data: { id: account.id } };
  });
}

export type EmployeeAsset = {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  templateName: string;
  categoryName: string;
  location: string | null;
  purchaseDate: Date | string | null;
  warrantyMonths: number | null;
  notes: string | null;
};

export async function getEmployeeAssets(
  employeeId: number
): Promise<ActionResult<EmployeeAsset[]>> {
  await requireAuth();

  const assets = await prisma.asset.findMany({
    where: { employeeId },
    select: {
      id: true,
      assetNo: true,
      name: true,
      status: true,
      location: true,
      purchaseDate: true,
      warrantyMonths: true,
      notes: true,
      template: { select: { name: true, category: { select: { name: true } } } },
    },
    orderBy: { id: "asc" },
  });

  return {
    success: true,
    data: assets.map((a) => ({
      id: a.id,
      assetNo: a.assetNo,
      name: a.name,
      status: a.status,
      templateName: a.template.name,
      categoryName: a.template.category.name,
      location: a.location,
      purchaseDate: a.purchaseDate,
      warrantyMonths: a.warrantyMonths,
      notes: a.notes,
    })),
  };
}

/** 查询某台主机的详细配置（配件清单：品牌/型号/分类/数量） */
export async function getAssetComponents(
  assetId: number
): Promise<ActionResult<{ modelName: string; modelBrand: string | null; categoryName: string; quantity: number }[]>> {
  await requireAuth();
  const rows = await prisma.assetComponent.findMany({
    where: { assetId },
    orderBy: { id: "asc" },
    include: { model: { include: { category: true } } },
  });
  return {
    success: true,
    data: rows.map((r) => ({
      modelName: r.model.name,
      modelBrand: r.model.brand ?? null,
      categoryName: r.model.category?.name ?? "",
      quantity: r.quantity,
    })),
  };
}

export async function deleteEmployee(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "system.account.manage", "员工与账号管理需要账号管理权限");
  if (denied) return denied;

  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "员工不存在" };
  }

  // 检查是否有关联设备
  const assetCount = await prisma.asset.count({
    where: { employeeId: id },
  });
  if (assetCount > 0) {
    return { success: false, error: "该员工有关联设备，无法删除" };
  }

  // 账号完全绑定在员工上：删除员工时级联删除其登录账号，避免留下孤儿账号
  try {
    await prisma.$transaction(async (tx) => {
      const account = await tx.admin.findUnique({ where: { employeeId: id } });
      if (account) {
        // 先清掉账号的关联数据（通知/待办等以账号为主键的级联由数据库 onDelete: Cascade 处理）
        await tx.admin.delete({ where: { id: account.id } });
      }
      await tx.employee.delete({ where: { id } });
    });
  } catch (e) {
    return handleUniqueViolation(e, {}, "删除失败");
  }
  return { success: true, data: { id } };
}
