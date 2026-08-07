"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateAssetNo } from "@/lib/asset-numbering";
import { computeAssetCapacities } from "@/lib/asset-capacity";
import { requireAuth } from "@/lib/auth";

// ============================================================
// Schema 校验
// ============================================================

const createSchema = z.object({
  templateId: z.number(),
  name: z.string().min(1, "设备名称不能为空"),
  location: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyMonths: z.number().int().optional(),
  notes: z.string().optional(),
  operator: z.string().min(1, "操作员不能为空"),
});

const updateSchema = z.object({
  name: z.string().min(1, "设备名称不能为空").optional(),
  location: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  warrantyMonths: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const querySchema = z.object({
  status: z.enum(["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED", "IN_STOCK"]).optional(),
  categoryId: z.number().optional(),
  employeeId: z.number().optional(),
  keyword: z.string().optional(),
  memoryMinGB: z.number().optional(),
  diskMinGB: z.number().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

type AssetDetail = {
  id: number;
  assetNo: string;
  name: string;
  templateId: number;
  templateName: string;
  categoryId: number;
  categoryName: string;
  status: string;
  employeeId: number | null;
  employeeName: string | null;
  location: string | null;
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  notes: string | null;
  components: {
    id: number;
    modelId: number;
    modelName: string;
    modelBrand: string | null;
    categoryName: string;
    quantity: number;
  }[];
  lifecycleLogs: {
    id: number;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    operator: string;
    remark: string | null;
    createdAt: Date;
  }[];
};

type PrismaAsset = {
  id: number;
  assetNo: string;
  name: string;
  templateId: number;
  template: {
    name: string;
    categoryId: number;
    category: { name: string } | null;
    components?: {
      model: { name: string; brand: string | null; category: { name: string } | null } | null;
      quantity: number;
    }[];
  } | null;
  status: string;
  employeeId: number | null;
  employee?: { name: string } | null;
  location: string | null;
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  notes: string | null;
  components: {
    id: number;
    modelId: number;
    model: { name: string; brand: string | null; category: { name: string } | null } | null;
    quantity: number;
  }[];
  lifecycleLogs?: {
    id: number;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    operator: string;
    remark: string | null;
    createdAt: Date;
  }[];
};

function formatAsset(asset: PrismaAsset | null): AssetDetail {
  if (!asset) {
    return {
      id: 0,
      assetNo: "",
      name: "",
      templateId: 0,
      templateName: "",
      categoryId: 0,
      categoryName: "",
      status: "",
      employeeId: null,
      employeeName: null,
      location: null,
      purchaseDate: null,
      warrantyMonths: null,
      notes: null,
      components: [],
      lifecycleLogs: [],
    };
  }
  return {
    id: asset.id,
    assetNo: asset.assetNo,
    name: asset.name,
    templateId: asset.templateId,
    templateName: asset.template?.name ?? "",
    categoryId: asset.template?.categoryId ?? 0,
    categoryName: asset.template?.category?.name ?? "",
    status: asset.status,
    employeeId: asset.employeeId,
    employeeName: asset.employee?.name ?? null,
    location: asset.location ?? null,
    purchaseDate: asset.purchaseDate ?? null,
    warrantyMonths: asset.warrantyMonths ?? null,
    notes: asset.notes ?? null,
    components: asset.components.map((c) => ({
      id: c.id,
      modelId: c.modelId,
      modelName: c.model?.name ?? "",
      modelBrand: c.model?.brand ?? null,
      categoryName: c.model?.category?.name ?? "",
      quantity: c.quantity,
    })),
    lifecycleLogs: (asset.lifecycleLogs ?? []).map((l) => ({
      id: l.id,
      action: l.action,
      fromStatus: l.fromStatus,
      toStatus: l.toStatus,
      operator: l.operator,
      remark: l.remark,
      createdAt: l.createdAt,
    })),
  };
}

// ============================================================
// Helpers
// ============================================================

const batchCreateSchema = z.object({
  templateId: z.number().int().positive("模板ID必须为正整数"),
  count: z.number().int().min(1, "数量至少为1"),
  operator: z.string().min(1, "操作人不能为空"),
});

// ============================================================
// Actions
// ============================================================

export async function createAsset(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<AssetDetail>> {
  await requireAuth();

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { templateId, name, location, purchaseDate, warrantyMonths, notes, operator } =
    validated.data;

  // 检查模板是否存在（含 BOM 配件清单）
  const template = await prisma.deviceTemplate.findUnique({
    where: { id: templateId },
    include: {
      category: true,
      components: true,
    },
  });
  if (!template) {
    return { success: false, error: "设备模板不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 生成编号
      const assetNo = await generateAssetNo(tx, template.category.code, template.category.numberingRule);

      // 创建设备
      const asset = await tx.asset.create({
        data: {
          assetNo,
          name,
          templateId,
          status: "IDLE",
          location: location ?? null,
          purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
          warrantyMonths: warrantyMonths ?? null,
          notes: notes ?? null,
        },
      });

      // 复制模板 BOM 配件到设备（仅记录配置，不扣减库存）
      if (template.components.length > 0) {
        await tx.assetComponent.createMany({
          data: template.components.map((bom) => ({
            assetId: asset.id,
            modelId: bom.modelId,
            quantity: bom.quantity,
          })),
        });
      }

      // 记录生命周期日志
      await tx.lifecycleLog.create({
        data: {
          assetId: asset.id,
          action: "CREATED",
          toStatus: "IDLE",
          operator,
          remark: `按模板 ${template.name} 生成`,
        },
      });

      return asset.id;
    });

    // 查询完整信息返回
    const asset = await prisma.asset.findUnique({
      where: { id: result },
      include: {
        template: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes("Unique constraint")) {
        return { success: false, error: "设备编号已存在，请重试" };
      }
      if (e.message.includes("Foreign key constraint")) {
        return { success: false, error: "关联数据不存在，无法创建设备" };
      }
      return { success: false, error: `创建设备失败：${e.message}` };
    }
    return { success: false, error: "创建设备失败，请稍后重试" };
  }
}

export async function getAssets(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<AssetDetail[]>> {
  await requireAuth();

  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { status, categoryId, employeeId, keyword, memoryMinGB, diskMinGB, page, pageSize } = validated.data;

  const where: Prisma.AssetWhereInput = {};
  if (status) where.status = status;
  if (employeeId != null) where.employeeId = employeeId;
  if (categoryId != null) {
    where.template = { categoryId };
  }
  if (keyword) {
    where.OR = [
      { assetNo: { contains: keyword } },
      { name: { contains: keyword } },
    ];
  }

  try {
    const queryOptions: any = {
      where,
      orderBy: { id: "asc" as const },
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
            components: {
              include: {
                model: {
                  select: {
                    name: true,
                    brand: true,
                    category: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
      },
    };

    // 分页支持
    if (page != null && pageSize != null) {
      queryOptions.skip = (page - 1) * pageSize;
      queryOptions.take = pageSize;
    }

    const assets = await prisma.asset.findMany(queryOptions) as unknown as PrismaAsset[];

    // 预展开模板 BOM 组件（用于容量筛选，设备本身不写配件记录）
    const formatted = assets.map((asset) => ({
      ...formatAsset(asset),
      _templateComponents: (asset.template?.components ?? []).map((tc) => ({
        modelName: tc.model?.name ?? "",
        quantity: tc.quantity,
      })),
    }));

    // 服务端容量筛选（基于模板 BOM 的配置，而非设备的配件记录）
    let filtered = formatted;
    if (memoryMinGB != null) {
      filtered = filtered.filter((asset) => {
        const caps = computeAssetCapacities((asset as any)._templateComponents ?? []);
        return caps.memoryGB >= memoryMinGB;
      });
    }
    if (diskMinGB != null) {
      filtered = filtered.filter((asset) => {
        const caps = computeAssetCapacities((asset as any)._templateComponents ?? []);
        return caps.diskGB >= diskMinGB;
      });
    }

    return { success: true, data: filtered };
  } catch (e) {
    return { success: false, error: "查询设备列表失败，请稍后重试" };
  }
}

export async function getAssetById(
  id: number
): Promise<ActionResult<AssetDetail>> {
  await requireAuth();

  try {
    const asset = await prisma.asset.findUnique({
      where: { id },
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
          },
        },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!asset) {
      return { success: false, error: "设备不存在" };
    }

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    return { success: false, error: "查询设备详情失败，请稍后重试" };
  }
}

export async function updateAsset(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<AssetDetail>> {
  await requireAuth();

  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }

  const updateData: Record<string, unknown> = {};
  if (validated.data.name != null) updateData.name = validated.data.name;
  if (validated.data.location !== undefined) updateData.location = validated.data.location;
  if (validated.data.purchaseDate !== undefined) {
    updateData.purchaseDate = validated.data.purchaseDate ? new Date(validated.data.purchaseDate) : null;
  }
  if (validated.data.warrantyMonths !== undefined) {
    updateData.warrantyMonths = validated.data.warrantyMonths;
  }
  if (validated.data.notes !== undefined) updateData.notes = validated.data.notes;

  try {
    const asset = await prisma.asset.update({
      where: { id },
      data: updateData,
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
          },
        },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes("Record to update not found")) {
        return { success: false, error: "设备不存在或已被删除" };
      }
      return { success: false, error: `更新设备失败：${e.message}` };
    }
    return { success: false, error: "更新设备失败，请稍后重试" };
  }
}

export async function deleteAsset(
  id: number
): Promise<ActionResult<{ id: number }>> {
  await requireAuth();

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }

  try {
    await prisma.asset.delete({ where: { id } });
    return { success: true, data: { id } };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Foreign key constraint")) {
      return { success: false, error: "该设备有关联数据，无法删除" };
    }
    return { success: false, error: "删除设备失败，请稍后重试" };
  }
}

export async function batchCreateAssets(
  input: z.infer<typeof batchCreateSchema>
): Promise<ActionResult<AssetDetail[]>> {
  await requireAuth();

  const validated = batchCreateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { templateId, count, operator } = validated.data;

  // 检查模板是否存在（含 BOM 配件清单）
  const template = await prisma.deviceTemplate.findUnique({
    where: { id: templateId },
    include: {
      category: true,
      components: true,
    },
  });
  if (!template) {
    return { success: false, error: "设备模板不存在" };
  }

  try {
    const assetIds: number[] = [];

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < count; i++) {
        // 生成编号
        const assetNo = await generateAssetNo(
          tx,
          template.category.code,
          template.category.numberingRule
        );

        // 创建设备（IN_STOCK 状态，不绑定员工）
        const asset = await tx.asset.create({
          data: {
            assetNo,
            name: template.name,
            templateId,
            status: "IN_STOCK",
          },
        });

        // 复制模板 BOM 配件到设备（仅记录配置，不扣减库存）
        if (template.components.length > 0) {
          await tx.assetComponent.createMany({
            data: template.components.map((bom) => ({
              assetId: asset.id,
              modelId: bom.modelId,
              quantity: bom.quantity,
            })),
          });
        }

        // 记录生命周期日志
        await tx.lifecycleLog.create({
          data: {
            assetId: asset.id,
            action: "CREATED",
            toStatus: "IN_STOCK",
            operator,
            remark: `批量入库：按模板 ${template.name} 生成`,
          },
        });

        assetIds.push(asset.id);
      }
    });

    // 查询完整信息返回
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      orderBy: { id: "asc" },
      include: {
        template: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
      },
    });

    return { success: true, data: assets.map(formatAsset) };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { success: false, error: "设备编号冲突，请重试" };
    }
    return { success: false, error: "批量入库失败，请稍后重试" };
  }
}
