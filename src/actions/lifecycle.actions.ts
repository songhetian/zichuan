"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// ============================================================
// Schema 校验
// ============================================================

const allocateSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  employeeId: z.number(),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

const returnSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

const transferSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  toEmployeeId: z.number(),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

const upgradeSchema = z.object({
  assetId: z.number(),
  modelId: z.number(),
  newModelId: z.number(),
  quantity: z.number().int().positive("数量必须为正整数"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

const scrapSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

// ============================================================
// 分配
// ============================================================

export async function allocateAssets(
  input: z.infer<typeof allocateSchema>
): Promise<ActionResult<{ allocatedCount: number }>> {
  requireAuth();
  const validated = allocateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, employeeId, operator, remark } = validated.data;

  // 检查员工是否存在
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    return { success: false, error: "员工不存在" };
  }

  // 预检查设备是否存在（基本存在性检查，状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有状态为 IDLE 的设备才会被更新
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: "IDLE",
        },
        data: {
          status: "IN_USE",
          employeeId,
        },
      });

      // 如果更新数量不匹配，说明有设备不是闲置状态
      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      // 唯一性校验：检查目标员工是否已拥有相同模板的唯一设备
      const templateIds = [...new Set(assets.map(a => a.templateId))];
      const uniqueTemplates = await tx.deviceTemplate.findMany({
        where: { id: { in: templateIds }, unique: true },
        select: { id: true },
      });
      if (uniqueTemplates.length > 0) {
        const uniqueTemplateIds = new Set(uniqueTemplates.map(t => t.id));
        const existingAssets = await tx.asset.findMany({
          where: {
            employeeId,
            templateId: { in: Array.from(uniqueTemplateIds) },
            status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
            id: { notIn: assetIds },
          },
        });
        if (existingAssets.length > 0) {
          throw new Error("UNIQUE_VIOLATION");
        }
      }

      // 记录生命周期日志
      await tx.lifecycleLog.createMany({
        data: assetIds.map((id) => ({
          assetId: id,
          action: "ALLOCATED",
          fromStatus: "IDLE",
          toStatus: "IN_USE",
          employeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { allocatedCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "分配",
        action: "分配设备",
        detail: `将 ${assetNos} 分配给 ${employee.name}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "STATUS_CONFLICT") {
        return { success: false, error: "部分设备非闲置状态，无法分配" };
      }
      if (e.message === "UNIQUE_VIOLATION") {
        return { success: false, error: "唯一性约束：员工已拥有同类唯一设备，不能重复分配" };
      }
    }
    return { success: false, error: "分配失败" };
  }
}

// ============================================================
// 归还
// ============================================================

export async function returnAssets(
  input: z.infer<typeof returnSchema>
): Promise<ActionResult<{ returnedCount: number }>> {
  requireAuth();
  const validated = returnSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：设备是否存在（状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有状态为 IN_USE 的设备才会被更新
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: "IN_USE",
        },
        data: {
          status: "IDLE",
          employeeId: null,
        },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      // 记录生命周期日志
      await tx.lifecycleLog.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          action: "RETURNED",
          fromStatus: "IN_USE",
          toStatus: "IDLE",
          employeeId: a.employeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { returnedCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "归还",
        action: "归还设备",
        detail: `归还设备 ${assetNos}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STATUS_CONFLICT") {
      return { success: false, error: "部分设备非在用状态，无法归还" };
    }
    return { success: false, error: "归还失败" };
  }
}

// ============================================================
// 调拨
// ============================================================

export async function transferAssets(
  input: z.infer<typeof transferSchema>
): Promise<ActionResult<{ transferredCount: number }>> {
  requireAuth();
  const validated = transferSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, toEmployeeId, operator, remark } = validated.data;

  // 检查目标员工是否存在
  const toEmployee = await prisma.employee.findUnique({ where: { id: toEmployeeId } });
  if (!toEmployee) {
    return { success: false, error: "员工不存在" };
  }

  // 预检查：设备是否存在（状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有状态为 IN_USE 的设备才会被调拨
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: "IN_USE",
        },
        data: { employeeId: toEmployeeId },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      await tx.lifecycleLog.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          action: "TRANSFERRED",
          fromStatus: "IN_USE",
          toStatus: "IN_USE",
          fromEmployeeId: a.employeeId,
          employeeId: toEmployeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { transferredCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "调拨",
        action: "调拨设备",
        detail: `将 ${assetNos} 调拨给 ${toEmployee.name}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STATUS_CONFLICT") {
      return { success: false, error: "部分设备非在用状态，无法调拨" };
    }
    return { success: false, error: "调拨失败" };
  }
}

// ============================================================
// 升级
// ============================================================

export async function upgradeAssetComponent(
  input: z.infer<typeof upgradeSchema>
): Promise<ActionResult<{ assetId: number; modelId: number; newModelId: number }>> {
  requireAuth();
  const validated = upgradeSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetId, modelId, newModelId, quantity, operator, remark } = validated.data;

  // 检查设备是否存在
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { success: false, error: "设备不存在" };
  }

  // 检查设备上是否有该配件
  const existingComp = await prisma.assetComponent.findUnique({
    where: { assetId_modelId: { assetId, modelId } },
  });
  if (!existingComp) {
    return { success: false, error: "设备上不存在该配件" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性扣减新配件库存（防止超卖）
      const stockUpdate = await tx.componentStock.updateMany({
        where: {
          modelId: newModelId,
          quantity: { gte: quantity },
        },
        data: { quantity: { decrement: quantity } },
      });

      if (stockUpdate.count === 0) {
        throw new Error("STOCK_INSUFFICIENT");
      }

      // 删除旧配件配置，添加新配件配置
      await tx.assetComponent.delete({
        where: { assetId_modelId: { assetId, modelId } },
      });

      // 如果新配件已在设备上，更新数量；否则创建
      await tx.assetComponent.upsert({
        where: { assetId_modelId: { assetId, modelId: newModelId } },
        update: { quantity: { increment: quantity } },
        create: { assetId, modelId: newModelId, quantity },
      });

      // 新配件出库流水
      await tx.componentStockLog.create({
        data: {
          modelId: newModelId,
          type: "UPGRADE_USE",
          quantity: -quantity,
          operator,
          remark: `设备 ${asset.assetNo} 升级`,
        },
      });

      // 旧配件回库
      await tx.componentStock.upsert({
        where: { modelId },
        update: { quantity: { increment: existingComp.quantity } },
        create: { modelId, quantity: existingComp.quantity },
      });

      // 旧配件入库流水
      await tx.componentStockLog.create({
        data: {
          modelId,
          type: "UPGRADE_RETURN",
          quantity: existingComp.quantity,
          operator,
          remark: `设备 ${asset.assetNo} 升级退回`,
        },
      });

      // 生命周期日志
      await tx.lifecycleLog.create({
        data: {
          assetId,
          action: "UPGRADED",
          fromStatus: asset.status,
          toStatus: asset.status,
          operator,
          remark: remark ?? null,
        },
      });

      return { assetId, modelId, newModelId };
    });

    // 记录系统日志
    const oldModel = await prisma.componentModel.findUnique({ where: { id: modelId } });
    const newModel = await prisma.componentModel.findUnique({ where: { id: newModelId } });
    await prisma.systemLog.create({
      data: {
        module: "升级",
        action: "升级设备配件",
        detail: `设备 ${asset.assetNo} 配件 ${oldModel?.name ?? modelId} → ${newModel?.name ?? newModelId}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STOCK_INSUFFICIENT") {
      return { success: false, error: "新配件库存不足" };
    }
    return { success: false, error: "升级失败" };
  }
}

// ============================================================
// 报废
// ============================================================

export async function scrapAssets(
  input: z.infer<typeof scrapSchema>
): Promise<ActionResult<{ scrappedCount: number }>> {
  requireAuth();
  const validated = scrapSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：设备是否存在（状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有非报废状态的设备才会被更新
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: { not: "SCRAPPED" },
        },
        data: {
          status: "SCRAPPED",
          employeeId: null,
        },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      await tx.lifecycleLog.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          action: "SCRAPPED",
          fromStatus: a.status,
          toStatus: "SCRAPPED",
          employeeId: a.employeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { scrappedCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "报废",
        action: "报废设备",
        detail: `报废设备 ${assetNos}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STATUS_CONFLICT") {
      return { success: false, error: "部分设备已报废，无法重复报废" };
    }
    return { success: false, error: "报废失败" };
  }
}

// ============================================================
// 送修
// ============================================================

const maintenanceStartSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

export async function maintenanceStart(
  input: z.infer<typeof maintenanceStartSchema>
): Promise<ActionResult<{ startedCount: number }>> {
  requireAuth();
  const validated = maintenanceStartSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：设备是否存在（状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有非报废且非维修中的设备才能送修
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: { notIn: ["SCRAPPED", "IN_MAINTENANCE"] },
        },
        data: { status: "IN_MAINTENANCE" },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      await tx.lifecycleLog.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          action: "MAINTENANCE_START",
          fromStatus: a.status,
          toStatus: "IN_MAINTENANCE",
          employeeId: a.employeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { startedCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "送修",
        action: "送修设备",
        detail: `送修设备 ${assetNos}`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STATUS_CONFLICT") {
      return { success: false, error: "部分设备已报废或已在维修中，无法送修" };
    }
    return { success: false, error: "送修失败" };
  }
}

// ============================================================
// 维修完成
// ============================================================

const maintenanceCompleteSchema = z.object({
  assetIds: z.array(z.number()).min(1, "设备列表不能为空"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

export async function maintenanceComplete(
  input: z.infer<typeof maintenanceCompleteSchema>
): Promise<ActionResult<{ completedCount: number }>> {
  requireAuth();
  const validated = maintenanceCompleteSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：设备是否存在（状态检查放事务内）
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 原子性更新：只有维修中的设备才能标记完成
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: "IN_MAINTENANCE",
        },
        data: { status: "IDLE" },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      await tx.lifecycleLog.createMany({
        data: assets.map((a) => ({
          assetId: a.id,
          action: "MAINTENANCE_DONE",
          fromStatus: "IN_MAINTENANCE",
          toStatus: "IDLE",
          employeeId: a.employeeId,
          operator,
          remark: remark ?? null,
        })),
      });

      return { completedCount: assetIds.length };
    });

    // 记录系统日志
    const assetNos = assets.map((a) => a.assetNo).join("、");
    await prisma.systemLog.create({
      data: {
        module: "维修完成",
        action: "维修完成",
        detail: `设备 ${assetNos} 维修完成`,
        operator,
      },
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "STATUS_CONFLICT") {
      return { success: false, error: "部分设备非维修中状态，无法标记完成" };
    }
    return { success: false, error: "维修完成操作失败" };
  }
}
