"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// ============================================================
// Schema 校验
// ============================================================

const stockInSchema = z.object({
  modelId: z.number(),
  quantity: z.number().int().positive("数量必须为正整数"),
  operator: z.string().min(1, "操作员不能为空"),
  remark: z.string().optional(),
});

const stockOutSchema = z.object({
  modelId: z.number(),
  quantity: z.number().int().positive("数量必须为正整数"),
  operator: z.string().min(1, "操作员不能为空"),
  remark: z.string().optional(),
});

const logQuerySchema = z.object({
  modelId: z.number().optional(),
  type: z.enum(["PURCHASE_IN", "UPGRADE_RETURN", "ASSET_BUILD", "UPGRADE_USE"]).optional(),
});

const batchItemSchema = z.object({
  modelId: z.number(),
  quantity: z.number().int().positive("数量必须为正整数"),
  type: z.enum(["ASSET_BUILD", "UPGRADE_USE"]),
});

const batchOutSchema = z.array(batchItemSchema);

// ============================================================
// Helpers
// ============================================================

async function checkModelExists(modelId: number): Promise<boolean> {
  const model = await prisma.componentModel.findUnique({ where: { id: modelId } });
  return model != null;
}

// ============================================================
// 入库操作
// ============================================================

export async function purchaseStockIn(
  input: z.infer<typeof stockInSchema>
): Promise<ActionResult<{ modelId: number; quantity: number }>> {
  requireAuth();
  const validated = stockInSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { modelId, quantity, operator, remark } = validated.data;

  if (!(await checkModelExists(modelId))) {
    return { success: false, error: "配件型号不存在" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 更新库存
      await tx.componentStock.upsert({
        where: { modelId },
        update: { quantity: { increment: quantity } },
        create: { modelId, quantity },
      });

      // 记录流水
      await tx.componentStockLog.create({
        data: {
          modelId,
          type: "PURCHASE_IN",
          quantity,
          operator,
          remark: remark ?? null,
        },
      });
    });

    const stock = await prisma.componentStock.findUnique({ where: { modelId } });
    const model = await prisma.componentModel.findUnique({ where: { id: modelId } });

    // 记录系统日志
    await prisma.systemLog.create({
      data: {
        module: "入库",
        action: "采购入库",
        detail: `${model?.name ?? modelId} 入库 ${quantity} 件`,
        operator,
      },
    });

    return { success: true, data: { modelId, quantity: stock?.quantity ?? quantity } };
  } catch (e) {
    return { success: false, error: "入库失败" };
  }
}

export async function upgradeReturnStockIn(
  input: z.infer<typeof stockInSchema>
): Promise<ActionResult<{ modelId: number; quantity: number }>> {
  requireAuth();
  const validated = stockInSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { modelId, quantity, operator, remark } = validated.data;

  if (!(await checkModelExists(modelId))) {
    return { success: false, error: "配件型号不存在" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.componentStock.upsert({
        where: { modelId },
        update: { quantity: { increment: quantity } },
        create: { modelId, quantity },
      });

      await tx.componentStockLog.create({
        data: {
          modelId,
          type: "UPGRADE_RETURN",
          quantity,
          operator,
          remark: remark ?? null,
        },
      });
    });

    const stock = await prisma.componentStock.findUnique({ where: { modelId } });
    return { success: true, data: { modelId, quantity: stock?.quantity ?? quantity } };
  } catch (e) {
    return { success: false, error: "退回入库失败" };
  }
}

// ============================================================
// 出库操作
// ============================================================

export async function assetBuildStockOut(
  input: z.infer<typeof stockOutSchema>
): Promise<ActionResult<{ modelId: number; quantity: number }>> {
  requireAuth();
  const validated = stockOutSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { modelId, quantity, operator, remark } = validated.data;

  if (!(await checkModelExists(modelId))) {
    return { success: false, error: "配件型号不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性扣减库存（防止超卖）
      const updateResult = await tx.componentStock.updateMany({
        where: {
          modelId,
          quantity: { gte: quantity },
        },
        data: { quantity: { decrement: quantity } },
      });

      if (updateResult.count === 0) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      // 记录流水
      await tx.componentStockLog.create({
        data: {
          modelId,
          type: "ASSET_BUILD",
          quantity: -quantity,
          operator,
          remark: remark ?? null,
        },
      });

      const stock = await tx.componentStock.findUnique({ where: { modelId } });
      return stock?.quantity ?? 0;
    });

    return { success: true, data: { modelId, quantity: result } };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_STOCK") {
      return { success: false, error: "库存不足" };
    }
    return { success: false, error: "出库失败" };
  }
}

export async function upgradeUseStockOut(
  input: z.infer<typeof stockOutSchema>
): Promise<ActionResult<{ modelId: number; quantity: number }>> {
  requireAuth();
  const validated = stockOutSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { modelId, quantity, operator, remark } = validated.data;

  if (!(await checkModelExists(modelId))) {
    return { success: false, error: "配件型号不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stock = await tx.componentStock.findUnique({
        where: { modelId },
      });

      const currentQty = stock?.quantity ?? 0;
      if (currentQty < quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      await tx.componentStock.update({
        where: { modelId },
        data: { quantity: { decrement: quantity } },
      });

      await tx.componentStockLog.create({
        data: {
          modelId,
          type: "UPGRADE_USE",
          quantity: -quantity,
          operator,
          remark: remark ?? null,
        },
      });

      return currentQty - quantity;
    });

    return { success: true, data: { modelId, quantity: result } };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_STOCK") {
      return { success: false, error: "库存不足" };
    }
    return { success: false, error: "出库失败" };
  }
}

// ============================================================
// 批量出库（事务性）
// ============================================================

export async function batchStockOut(
  items: z.infer<typeof batchOutSchema>,
  operator: string,
  remark?: string
): Promise<ActionResult<{ success: true }>> {
  requireAuth();
  const validated = batchOutSchema.safeParse(items);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  if (validated.data.length === 0) {
    return { success: false, error: "出库列表不能为空" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of validated.data) {
        // 检查型号存在
        const model = await tx.componentModel.findUnique({
          where: { id: item.modelId },
        });
        if (!model) {
          throw new Error(`MODEL_NOT_FOUND:${item.modelId}`);
        }

        // 检查库存
        const stock = await tx.componentStock.findUnique({
          where: { modelId: item.modelId },
        });
        const currentQty = stock?.quantity ?? 0;
        if (currentQty < item.quantity) {
          throw new Error("INSUFFICIENT_STOCK");
        }

        // 扣减库存
        await tx.componentStock.update({
          where: { modelId: item.modelId },
          data: { quantity: { decrement: item.quantity } },
        });

        // 记录流水
        await tx.componentStockLog.create({
          data: {
            modelId: item.modelId,
            type: item.type,
            quantity: -item.quantity,
            operator,
            remark: remark ?? null,
          },
        });
      }
    });

    return { success: true, data: { success: true } };
  } catch (e) {
    if (e instanceof Error && e.message === "INSUFFICIENT_STOCK") {
      return { success: false, error: "库存不足，操作已全部回滚" };
    }
    if (e instanceof Error && e.message.startsWith("MODEL_NOT_FOUND")) {
      return { success: false, error: "配件型号不存在" };
    }
    return { success: false, error: "批量出库失败" };
  }
}

// ============================================================
// 查询操作
// ============================================================

export async function getStockByModelId(
  modelId: number
): Promise<ActionResult<{ modelId: number; quantity: number }>> {
  if (!(await checkModelExists(modelId))) {
    return { success: false, error: "配件型号不存在" };
  }

  const stock = await prisma.componentStock.findUnique({ where: { modelId } });
  return {
    success: true,
    data: { modelId, quantity: stock?.quantity ?? 0 },
  };
}

export async function getAllStocks(): Promise<
  ActionResult<
    {
      modelId: number;
      modelName: string;
      modelBrand: string | null;
      categoryId: number;
      categoryName: string;
      quantity: number;
    }[]
  >
> {
  const stocks = await prisma.componentStock.findMany({
    include: {
      model: {
        include: {
          category: true,
        },
      },
    },
    orderBy: { modelId: "asc" },
  });

  const allModels = await prisma.componentModel.findMany({
    include: {
      category: true,
    },
    where: {
      id: {
        notIn: stocks.map((s) => s.modelId),
      },
    },
    orderBy: { id: "asc" },
  });

  const result = [
    ...stocks.map((s) => ({
      modelId: s.modelId,
      modelName: s.model.name,
      modelBrand: s.model.brand,
      categoryId: s.model.categoryId,
      categoryName: s.model.category?.name ?? "",
      quantity: s.quantity,
    })),
    ...allModels.map((m) => ({
      modelId: m.id,
      modelName: m.name,
      modelBrand: m.brand,
      categoryId: m.categoryId,
      categoryName: m.category?.name ?? "",
      quantity: 0,
    })),
  ];

  return { success: true, data: result };
}

export async function getStockLogs(
  input: z.infer<typeof logQuerySchema> = {}
): Promise<
  ActionResult<
    {
      id: number;
      modelId: number;
      type: string;
      quantity: number;
      operator: string;
      remark: string | null;
      createdAt: Date;
    }[]
  >
> {
  const validated = logQuerySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { modelId, type } = validated.data;

  const where: Record<string, unknown> = {};
  if (modelId != null) where.modelId = modelId;
  if (type) where.type = type;

  const logs = await prisma.componentStockLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return { success: true, data: logs };
}
