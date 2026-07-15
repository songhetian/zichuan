"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

function generateCodeFromName(name: string): string {
  const chars = name.split("");
  let code = "";
  for (let i = 0; i < chars.length && code.length < 6; i++) {
    const ch = chars[i];
    if (/[a-zA-Z0-9]/.test(ch)) {
      code += ch.toUpperCase();
    }
  }
  if (code.length === 0) {
    code = `CAT${Math.floor(Math.random() * 900 + 100)}`;
  }
  return code;
}

const createSchema = z.object({
  name: z.string().min(1, "分类名称不能为空"),
  code: z.string().optional(),
  parentId: z.number().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1, "分类名称不能为空").optional(),
  code: z.string().min(1, "分类编码不能为空").optional(),
});

const moveSchema = z.object({
  parentId: z.number().nullable(),
});

function isDescendant(parentId: number, childId: number, categories: { id: number; parentId: number | null }[]): boolean {
  let currentId: number | null = childId;
  const visited = new Set<number>();
  while (currentId != null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    if (currentId === parentId) return true;
    const cat = categories.find((c) => c.id === currentId);
    if (!cat) return false;
    currentId = cat.parentId;
  }
  return false;
}

export async function moveAssetCategory(
  id: number,
  input: z.infer<typeof moveSchema>
): Promise<ActionResult<{ id: number; parentId: number | null }>> {
  const validated = moveSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.assetCategory.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "设备分类不存在" };

  const { parentId } = validated.data;

  if (parentId != null) {
    if (parentId === id) {
      return { success: false, error: "不能将分类移动到自身下" };
    }
    const parent = await prisma.assetCategory.findUnique({ where: { id: parentId } });
    if (!parent) return { success: false, error: "父分类不存在" };

    const allCats = await prisma.assetCategory.findMany({
      select: { id: true, parentId: true },
    });
    if (isDescendant(id, parentId, allCats)) {
      return { success: false, error: "不能将分类移动到其子分类下" };
    }
  }

  try {
    const cat = await prisma.assetCategory.update({
      where: { id },
      data: { parentId },
      select: { id: true, parentId: true },
    });
    return { success: true, data: cat };
  } catch {
    return { success: false, error: "移动分类失败" };
  }
}

export async function createAssetCategory(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string; code: string; parentId: number | null }>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, parentId } = validated.data;
  let code = validated.data.code;
  if (code === undefined || code === "") {
    code = generateCodeFromName(name);
  }

  if (parentId != null) {
    const parent = await prisma.assetCategory.findUnique({ where: { id: parentId } });
    if (!parent) return { success: false, error: "父分类不存在" };
  }

  try {
    const cat = await prisma.assetCategory.create({
      data: { name, code, parentId: parentId ?? null },
      select: { id: true, name: true, code: true, parentId: true },
    });
    return { success: true, data: cat };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      const target = (e as any).meta?.target as string[];
      if (target?.includes("name")) return { success: false, error: "分类名称已存在" };
      if (target?.includes("code")) return { success: false, error: "分类编码已存在" };
    }
    return { success: false, error: "创建失败" };
  }
}

export async function getAssetCategories(): Promise<
  ActionResult<{ id: number; name: string; code: string; parentId: number | null }[]>
> {
  const cats = await prisma.assetCategory.findMany({
    orderBy: { id: "asc" },
    select: { id: true, name: true, code: true, parentId: true },
  });
  return { success: true, data: cats };
}

export async function getAssetCategoryById(
  id: number
): Promise<ActionResult<{ id: number; name: string; code: string; parentId: number | null }>> {
  const cat = await prisma.assetCategory.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, parentId: true },
  });
  if (!cat) return { success: false, error: "设备分类不存在" };
  return { success: true, data: cat };
}

export async function updateAssetCategory(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<{ id: number; name: string; code: string; parentId: number | null }>> {
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.assetCategory.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "设备分类不存在" };

  try {
    const cat = await prisma.assetCategory.update({
      where: { id },
      data: validated.data,
      select: { id: true, name: true, code: true, parentId: true },
    });
    return { success: true, data: cat };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      const target = (e as any).meta?.target as string[];
      if (target?.includes("name")) return { success: false, error: "分类名称已存在" };
      if (target?.includes("code")) return { success: false, error: "分类编码已存在" };
    }
    return { success: false, error: "更新失败" };
  }
}

export async function deleteAssetCategory(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const existing = await prisma.assetCategory.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "设备分类不存在" };

  const childCount = await prisma.assetCategory.count({ where: { parentId: id } });
  if (childCount > 0) return { success: false, error: "该分类下有子分类，无法删除" };

  const templateCount = await prisma.deviceTemplate.count({ where: { categoryId: id } });
  if (templateCount > 0) return { success: false, error: "该分类下有设备模板，无法删除" };

  await prisma.assetCategory.delete({ where: { id } });
  return { success: true, data: { id } };
}
