"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

// ============================================================
// Schema 校验
// ============================================================

const createSchema = z.object({
  name: z.string().min(1, "分类名称不能为空"),
  parentId: z.number().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1, "分类名称不能为空").optional(),
  parentId: z.number().nullable().optional(),
});

// ============================================================
// 统一返回类型
// ============================================================

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ============================================================
// Actions
// ============================================================

export async function createComponentCategory(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string; parentId: number | null }>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, parentId } = validated.data;

  // 如果有父分类，检查父分类是否存在
  if (parentId != null) {
    const parent = await prisma.componentCategory.findUnique({
      where: { id: parentId },
    });
    if (!parent) {
      return { success: false, error: "父分类不存在" };
    }
  }

  try {
    const category = await prisma.componentCategory.create({
      data: {
        name,
        parentId: parentId ?? null,
      },
      select: { id: true, name: true, parentId: true },
    });
    return { success: true, data: category };
  } catch (e) {
    // 唯一约束冲突
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "分类名称已存在" };
    }
    return { success: false, error: "创建失败" };
  }
}

export async function getComponentCategories(): Promise<
  ActionResult<{ id: number; name: string; parentId: number | null; children?: any[] }[]>
> {
  const categories = await prisma.componentCategory.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, parentId: true },
  });
  return { success: true, data: categories };
}

export async function getComponentCategoryById(
  id: number
): Promise<ActionResult<{ id: number; name: string; parentId: number | null }>> {
  const category = await prisma.componentCategory.findUnique({
    where: { id },
    select: { id: true, name: true, parentId: true },
  });
  if (!category) {
    return { success: false, error: "分类不存在" };
  }
  return { success: true, data: category };
}

export async function updateComponentCategory(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<{ id: number; name: string; parentId: number | null }>> {
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  // 检查分类是否存在
  const existing = await prisma.componentCategory.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "分类不存在" };
  }

  // 不能设自己为父分类
  if (validated.data.parentId === id) {
    return { success: false, error: "不能将自己设为父分类" };
  }

  try {
    const category = await prisma.componentCategory.update({
      where: { id },
      data: validated.data,
      select: { id: true, name: true, parentId: true },
    });
    return { success: true, data: category };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "分类名称已存在" };
    }
    return { success: false, error: "更新失败" };
  }
}

export async function deleteComponentCategory(
  id: number
): Promise<ActionResult<{ id: number }>> {
  // 检查分类是否存在
  const existing = await prisma.componentCategory.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "分类不存在" };
  }

  // 检查是否有子分类
  const childCount = await prisma.componentCategory.count({
    where: { parentId: id },
  });
  if (childCount > 0) {
    return { success: false, error: "该分类下有子分类，无法删除" };
  }

  // 检查是否有关联的配件型号
  const modelCount = await prisma.componentModel.count({
    where: { categoryId: id },
  });
  if (modelCount > 0) {
    return { success: false, error: "该分类下有配件型号，无法删除" };
  }

  await prisma.componentCategory.delete({ where: { id } });
  return { success: true, data: { id } };
}
