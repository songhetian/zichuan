"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

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
  status: z.enum(["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED"]).optional(),
  categoryId: z.number().optional(),
  employeeId: z.number().optional(),
  keyword: z.string().optional(),
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

function formatAsset(asset: any): AssetDetail {
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
    components: (asset.components ?? []).map((c: any) => ({
      id: c.id,
      modelId: c.modelId,
      modelName: c.model?.name ?? "",
      modelBrand: c.model?.brand ?? null,
      quantity: c.quantity,
    })),
    lifecycleLogs: (asset.lifecycleLogs ?? []).map((l: any) => ({
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

async function generateAssetNo(categoryId: number): Promise<string> {
  const category = await prisma.assetCategory.findUnique({
    where: { id: categoryId },
  });
  if (!category) throw new Error("分类不存在");

  const prefix = category.code;

  // 查询该分类下最大的编号
  const lastAsset = await prisma.asset.findFirst({
    where: { assetNo: { startsWith: prefix + "-" } },
    orderBy: { assetNo: "desc" },
  });

  let nextNum = 1;
  if (lastAsset) {
    const match = lastAsset.assetNo.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}-${String(nextNum).padStart(4, "0")}`;
}

// ============================================================
// Actions
// ============================================================

export async function createAsset(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<AssetDetail>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { templateId, name, location, purchaseDate, warrantyMonths, notes, operator } =
    validated.data;

  // 检查模板是否存在
  const template = await prisma.deviceTemplate.findUnique({
    where: { id: templateId },
    include: {
      components: true,
      category: true,
    },
  });
  if (!template) {
    return { success: false, error: "设备模板不存在" };
  }

  // 检查库存是否充足
  for (const bom of template.components) {
    const stock = await prisma.componentStock.findUnique({
      where: { modelId: bom.modelId },
    });
    const available = stock?.quantity ?? 0;
    if (available < bom.quantity) {
      return { success: false, error: `库存不足：配件型号 ID ${bom.modelId}` };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 生成编号
      const assetNo = await generateAssetNo(template.categoryId);

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

      // 复制 BOM 到设备配件配置
      if (template.components.length > 0) {
        await tx.assetComponent.createMany({
          data: template.components.map((bom) => ({
            assetId: asset.id,
            modelId: bom.modelId,
            quantity: bom.quantity,
          })),
        });
      }

      // 扣减库存
      for (const bom of template.components) {
        await tx.componentStock.update({
          where: { modelId: bom.modelId },
          data: { quantity: { decrement: bom.quantity } },
        });

        // 记录库存流水
        await tx.componentStockLog.create({
          data: {
            modelId: bom.modelId,
            type: "ASSET_BUILD",
            quantity: -bom.quantity,
            operator,
            remark: `组装设备 ${assetNo}`,
          },
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
          include: { model: { select: { name: true, brand: true } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    return { success: false, error: "创建设备失败" };
  }
}

export async function getAssets(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<AssetDetail[]>> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { status, categoryId, employeeId, keyword } = validated.data;

  const where: any = {};
  if (status) where.status = status;
  if (employeeId != null) where.employeeId = employeeId;
  if (keyword) {
    where.OR = [
      { assetNo: { contains: keyword } },
      { name: { contains: keyword } },
    ];
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: { id: "asc" },
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
        include: { model: { select: { name: true, brand: true } } },
      },
    },
  });

  // 按分类筛选需要在内存中过滤（因为 categoryId 在 template 上）
  let filtered = assets;
  if (categoryId != null) {
    filtered = assets.filter((a) => a.template?.categoryId === categoryId);
  }

  return { success: true, data: filtered.map(formatAsset) };
}

export async function getAssetById(
  id: number
): Promise<ActionResult<AssetDetail>> {
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
        include: { model: { select: { name: true, brand: true } } },
      },
      lifecycleLogs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!asset) {
    return { success: false, error: "设备不存在" };
  }

  return { success: true, data: formatAsset(asset) };
}

export async function updateAsset(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<AssetDetail>> {
  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }

  const data: any = {};
  if (validated.data.name != null) data.name = validated.data.name;
  if (validated.data.location !== undefined) data.location = validated.data.location;
  if (validated.data.purchaseDate !== undefined) {
    data.purchaseDate = validated.data.purchaseDate ? new Date(validated.data.purchaseDate) : null;
  }
  if (validated.data.warrantyMonths !== undefined) {
    data.warrantyMonths = validated.data.warrantyMonths;
  }
  if (validated.data.notes !== undefined) data.notes = validated.data.notes;

  try {
    const asset = await prisma.asset.update({
      where: { id },
      data,
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
          include: { model: { select: { name: true, brand: true } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    return { success: false, error: "更新失败" };
  }
}

export async function deleteAsset(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }

  await prisma.asset.delete({ where: { id } });
  return { success: true, data: { id } };
}
