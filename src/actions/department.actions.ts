"use server";

import { ActionResult } from "@/lib/types";
import { handleUniqueViolation } from "@/lib/prisma-error";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

const createSchema = z.object({
  name: z.string().min(1, "部门名称不能为空"),
});

const updateSchema = z.object({
  name: z.string().min(1, "部门名称不能为空").optional(),
});

export async function createDepartment(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string }>> {
  requireAuth();
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

export async function getDepartments(): Promise<
  ActionResult<{ id: number; name: string }[]>
> {
  const depts = await prisma.department.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  return { success: true, data: depts };
}

export async function getDepartmentById(
  id: number
): Promise<ActionResult<{ id: number; name: string }>> {
  const dept = await prisma.department.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!dept) {
    return { success: false, error: "部门不存在" };
  }
  return { success: true, data: dept };
}

export async function updateDepartment(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<{ id: number; name: string }>> {
  requireAuth();
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "部门不存在" };
  }

  try {
    const dept = await prisma.department.update({
      where: { id },
      data: validated.data,
      select: { id: true, name: true },
    });
    return { success: true, data: dept };
  } catch (e) {
    return handleUniqueViolation(e, { name: "部门名称已存在" }, "更新失败");
  }
}

export async function deleteDepartment(
  id: number
): Promise<ActionResult<{ id: number }>> {
  requireAuth();
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
