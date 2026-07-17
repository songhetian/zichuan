"use server";

import { ActionResult } from "@/lib/types";
import { handleUniqueViolation } from "@/lib/prisma-error";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// ============================================================
// Schema 校验
// ============================================================

const bomItemSchema = z.object({
  modelId: z.number(),
  quantity: z.number().int().positive("配件数量必须为正整数"),
});

const createSchema = z.object({
  name: z.string().min(1, "模板名称不能为空"),
  categoryId: z.number(),
  components: z.array(bomItemSchema),
});

const updateSchema = z.object({
  name: z.string().min(1, "模板名称不能为空").optional(),
  categoryId: z.number().optional(),
  components: z.array(bomItemSchema).optional(),
});

const querySchema = z.object({
  categoryId: z.number().optional(),
});

// ============================================================
// 统一返回类型
// ============================================================

type TemplateWithComponents = {
  id: number;
  name: string;
  categoryId: number;
  components: {
    id: number;
    modelId: number;
    quantity: number;
    modelName: string;
    modelBrand: string | null;
  }[];
};

type PrismaTemplate = {
  id: number;
  name: string;
  categoryId: number;
  components: {
    id: number;
    modelId: number;
    quantity: number;
    model: { name: string; brand: string | null } | null;
  }[];
};

function formatTemplate(template: PrismaTemplate | null): TemplateWithComponents {
  if (!template) {
    return { id: 0, name: "", categoryId: 0, components: [] };
  }
  return {
    id: template.id,
    name: template.name,
    categoryId: template.categoryId,
    components: template.components.map((c) => ({
      id: c.id,
      modelId: c.modelId,
      quantity: c.quantity,
      modelName: c.model?.name ?? "",
      modelBrand: c.model?.brand ?? null,
    })),
  };
}

// ============================================================
// Helpers
// ============================================================

async function validateComponents(components: { modelId: number }[]): Promise<string | null> {
  const modelIds = [...new Set(components.map((c) => c.modelId))];
  const models = await prisma.componentModel.findMany({
    where: { id: { in: modelIds } },
    select: { id: true },
  });
  const foundIds = new Set(models.map((m) => m.id));
  for (const id of modelIds) {
    if (!foundIds.has(id)) {
      return `配件型号不存在 (ID: ${id})`;
    }
  }
  return null;
}

// ============================================================
// Actions
// ============================================================

export async function createDeviceTemplate(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<TemplateWithComponents>> {
  requireAuth();
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, categoryId, components } = validated.data;

  // 检查分类是否存在
  const category = await prisma.assetCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    return { success: false, error: "设备分类不存在" };
  }

  // 检查配件型号是否存在
  if (components.length > 0) {
    const err = await validateComponents(components);
    if (err) return { success: false, error: err };
  }

  try {
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.deviceTemplate.create({
        data: { name, categoryId },
      });

      if (components.length > 0) {
        await tx.templateComponent.createMany({
          data: components.map((c) => ({
            templateId: created.id,
            modelId: c.modelId,
            quantity: c.quantity,
          })),
        });
      }

      return tx.deviceTemplate.findUnique({
        where: { id: created.id },
        include: {
          components: {
            include: { model: { select: { name: true, brand: true } } },
          },
        },
      });
    });

    return { success: true, data: formatTemplate(template) };
  } catch (e) {
    return handleUniqueViolation(e, { name: "该分类下已存在相同名称的模板" }, "创建失败");
  }
}

export async function getDeviceTemplates(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<TemplateWithComponents[]>> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const where: Record<string, unknown> = {};
  if (validated.data.categoryId != null) {
    where.categoryId = validated.data.categoryId;
  }

  const templates = await prisma.deviceTemplate.findMany({
    where,
    orderBy: { id: "asc" },
    include: {
      components: {
        include: { model: { select: { name: true, brand: true } } },
      },
    },
  });

  return { success: true, data: templates.map(formatTemplate) };
}

export async function getDeviceTemplateById(
  id: number
): Promise<ActionResult<TemplateWithComponents>> {
  const template = await prisma.deviceTemplate.findUnique({
    where: { id },
    include: {
      components: {
        include: { model: { select: { name: true, brand: true } } },
      },
    },
  });

  if (!template) {
    return { success: false, error: "设备模板不存在" };
  }

  return { success: true, data: formatTemplate(template) };
}

export async function updateDeviceTemplate(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<TemplateWithComponents>> {
  requireAuth();
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  // 检查模板是否存在
  const existing = await prisma.deviceTemplate.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备模板不存在" };
  }

  // 如果改分类，检查新分类是否存在
  if (validated.data.categoryId != null) {
    const category = await prisma.assetCategory.findUnique({
      where: { id: validated.data.categoryId },
    });
    if (!category) {
      return { success: false, error: "目标分类不存在" };
    }
  }

  // 检查配件型号
  if (validated.data.components != null && validated.data.components.length > 0) {
    const err = await validateComponents(validated.data.components);
    if (err) return { success: false, error: err };
  }

  try {
    const template = await prisma.$transaction(async (tx) => {
      const updateData: Partial<Pick<typeof validated.data, 'name' | 'categoryId'>> = {};
      if (validated.data.name != null) updateData.name = validated.data.name;
      if (validated.data.categoryId != null) updateData.categoryId = validated.data.categoryId;

      if (Object.keys(updateData).length > 0) {
        await tx.deviceTemplate.update({ where: { id }, data: updateData });
      }

      // 如果提供了 components，替换 BOM
      if (validated.data.components != null) {
        await tx.templateComponent.deleteMany({ where: { templateId: id } });
        if (validated.data.components.length > 0) {
          await tx.templateComponent.createMany({
            data: validated.data.components.map((c) => ({
              templateId: id,
              modelId: c.modelId,
              quantity: c.quantity,
            })),
          });
        }
      }

      return tx.deviceTemplate.findUnique({
        where: { id },
        include: {
          components: {
            include: { model: { select: { name: true, brand: true } } },
          },
        },
      });
    });

    return { success: true, data: formatTemplate(template) };
  } catch (e) {
    return handleUniqueViolation(e, { name: "该分类下已存在相同名称的模板" }, "更新失败");
  }
}

export async function deleteDeviceTemplate(
  id: number
): Promise<ActionResult<{ id: number }>> {
  requireAuth();
  // 检查模板是否存在
  const existing = await prisma.deviceTemplate.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备模板不存在" };
  }

  // 检查是否有关联设备
  const assetCount = await prisma.asset.count({
    where: { templateId: id },
  });
  if (assetCount > 0) {
    return { success: false, error: "该模板有关联设备，无法删除" };
  }

  await prisma.deviceTemplate.delete({ where: { id } });
  return { success: true, data: { id } };
}
