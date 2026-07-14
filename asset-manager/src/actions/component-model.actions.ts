"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

// ============================================================
// Schema 校验
// ============================================================

const createSchema = z.object({
  name: z.string().min(1, "型号名称不能为空"),
  brand: z.string().optional(),
  categoryId: z.number(),
});

const updateSchema = z.object({
  name: z.string().min(1, "型号名称不能为空").optional(),
  brand: z.string().optional().nullable(),
  categoryId: z.number().optional(),
});

const querySchema = z.object({
  categoryId: z.number().optional(),
  keyword: z.string().optional(),
});

// ============================================================
// 统一返回类型
// ============================================================

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type ComponentModelWithStock = {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number;
  stock: number;
};

// ============================================================
// Helpers
// ============================================================

function formatModel(model: any): ComponentModelWithStock {
  return {
    id: model.id,
    name: model.name,
    brand: model.brand,
    categoryId: model.categoryId,
    stock: model.stock?.quantity ?? 0,
  };
}

// ============================================================
// Actions
// ============================================================

export async function createComponentModel(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<ComponentModelWithStock>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, brand, categoryId } = validated.data;

  // 检查分类是否存在
  const category = await prisma.componentCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) {
    return { success: false, error: "配件分类不存在" };
  }

  try {
    const model = await prisma.componentModel.create({
      data: {
        name,
        brand: brand ?? null,
        categoryId,
        stock: {
          create: { quantity: 0 },
        },
      },
      include: { stock: true },
    });
    return { success: true, data: formatModel(model) };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "该分类下已存在相同名称的型号" };
    }
    return { success: false, error: "创建失败" };
  }
}

export async function getComponentModels(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<ComponentModelWithStock[]>> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { categoryId, keyword } = validated.data;

  const where: any = {};
  if (categoryId != null) {
    where.categoryId = categoryId;
  }
  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { brand: { contains: keyword } },
    ];
  }

  const models = await prisma.componentModel.findMany({
    where,
    include: { stock: true },
    orderBy: { id: "asc" },
  });

  return { success: true, data: models.map(formatModel) };
}

export async function getComponentModelById(
  id: number
): Promise<ActionResult<ComponentModelWithStock>> {
  const model = await prisma.componentModel.findUnique({
    where: { id },
    include: { stock: true },
  });
  if (!model) {
    return { success: false, error: "配件型号不存在" };
  }
  return { success: true, data: formatModel(model) };
}

export async function updateComponentModel(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<ComponentModelWithStock>> {
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  // 检查型号是否存在
  const existing = await prisma.componentModel.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "配件型号不存在" };
  }

  // 如果改分类，检查新分类是否存在
  if (validated.data.categoryId != null && validated.data.categoryId !== existing.categoryId) {
    const category = await prisma.componentCategory.findUnique({
      where: { id: validated.data.categoryId },
    });
    if (!category) {
      return { success: false, error: "目标分类不存在" };
    }
  }

  try {
    const model = await prisma.componentModel.update({
      where: { id },
      data: validated.data,
      include: { stock: true },
    });
    return { success: true, data: formatModel(model) };
  } catch (e) {
    if (e instanceof Error && "code" in (e as any) && (e as any).code === "P2002") {
      return { success: false, error: "该分类下已存在相同名称的型号" };
    }
    return { success: false, error: "更新失败" };
  }
}

export async function deleteComponentModel(
  id: number
): Promise<ActionResult<{ id: number }>> {
  // 检查型号是否存在
  const existing = await prisma.componentModel.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "配件型号不存在" };
  }

  // 检查是否有库存流水
  const logCount = await prisma.componentStockLog.count({
    where: { modelId: id },
  });
  if (logCount > 0) {
    return { success: false, error: "该型号有库存流水记录，无法删除" };
  }

  // 删除型号（级联删除库存记录，由 Prisma onDelete 处理或手动删）
  await prisma.$transaction([
    prisma.componentStock.deleteMany({ where: { modelId: id } }),
    prisma.componentModel.delete({ where: { id } }),
  ]);

  return { success: true, data: { id } };
}
