"use server";

import { ActionResult } from "@/lib/types";
import { handleUniqueViolation } from "@/lib/prisma-error";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";

const createSchema = z.object({
  name: z.string().min(1, "部门名称不能为空"),
});

const updateSchema = z.object({
  name: z.string().min(1, "部门名称不能为空").optional(),
  // 部门主管（指向员工档案）；null = 清除主管
  managerId: z.number().int().positive().nullable().optional(),
});

export async function createDepartment(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "department.create", "没有新增部门的权限");
  if (denied) return denied;

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  try {
    const dept = await prisma.department.create({
      data: { name: validated.data.name },
      select: { id: true, name: true },
    });
    return { success: true, data: dept };
  } catch (e) {
    return handleUniqueViolation(e, { name: "部门名称已存在" }, "创建失败");
  }
}

const deptWithManager = {
  id: true,
  name: true,
  managerId: true,
  manager: { select: { id: true, name: true } },
} as const;

export async function getDepartments(): Promise<
  ActionResult<
    { id: number; name: string; managerId: number | null; manager: { id: number; name: string } | null }[]
  >
> {
  await requireAuth();

  const depts = await prisma.department.findMany({
    orderBy: { id: "asc" },
    select: deptWithManager,
  });
  return { success: true, data: depts };
}

export async function getDepartmentById(
  id: number
): Promise<
  ActionResult<{ id: number; name: string; managerId: number | null; manager: { id: number; name: string } | null }>
> {
  await requireAuth();

  const dept = await prisma.department.findUnique({
    where: { id },
    select: deptWithManager,
  });
  if (!dept) {
    return { success: false, error: "部门不存在" };
  }
  return { success: true, data: dept };
}

export async function updateDepartment(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<
  ActionResult<{ id: number; name: string; managerId: number | null; manager: { id: number; name: string } | null }>
> {
  const user = await requireAuth();
  const forbidden = await guardPermission(user, "department.update", "没有编辑部门的权限");
  if (forbidden) return forbidden;

  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "部门不存在" };
  }

  // managerId 非空时校验员工存在（避免外键报错不友好）
  if (validated.data.managerId != null) {
    const manager = await prisma.employee.findUnique({
      where: { id: validated.data.managerId },
      select: { id: true },
    });
    if (!manager) {
      return { success: false, error: "指定的部门主管员工不存在" };
    }
  }

  try {
    const dept = await prisma.department.update({
      where: { id },
      data: validated.data,
      select: deptWithManager,
    });
    return { success: true, data: dept };
  } catch (e) {
    return handleUniqueViolation(e, { name: "部门名称已存在" }, "更新失败");
  }
}

export async function deleteDepartment(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "department.delete", "没有删除部门的权限");
  if (denied) return denied;

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "部门不存在" };
  }

  const empCount = await prisma.employee.count({ where: { departmentId: id } });
  if (empCount > 0) {
    return { success: false, error: "该部门下有员工，无法删除" };
  }

  await prisma.department.delete({ where: { id } });
  return { success: true, data: { id } };
}
