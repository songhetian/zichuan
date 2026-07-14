"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

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
// 统一返回类型
// ============================================================

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ============================================================
// 分配
// ============================================================

export async function allocateAssets(
  input: z.infer<typeof allocateSchema>
): Promise<ActionResult<{ allocatedCount: number }>> {
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

  // 预检查：所有设备必须闲置
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status !== "IDLE") {
      return { success: false, error: `设备 ${asset.assetNo} 非闲置状态，无法分配` };
    }
  }

  // 唯一性校验：检查目标员工是否已拥有相同模板的唯一设备
  const templateIds = [...new Set(assets.map(a => a.templateId))];
  const uniqueTemplates = await prisma.deviceTemplate.findMany({
    where: { id: { in: templateIds }, unique: true },
    select: { id: true },
  });
  if (uniqueTemplates.length > 0) {
    const uniqueTemplateIds = new Set(uniqueTemplates.map(t => t.id));
    const existingAssets = await prisma.asset.findMany({
      where: {
        employeeId,
        templateId: { in: Array.from(uniqueTemplateIds) },
        status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
      },
    });
    if (existingAssets.length > 0) {
      const existingNos = existingAssets.map(a => a.assetNo).join("、");
      return { success: false, error: `唯一性约束：员工已拥有设备 ${existingNos}，不能重复分配同类设备` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 更新设备状态
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: {
          status: "IN_USE",
          employeeId,
        },
      });

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

    return { success: true, data: { allocatedCount: assetIds.length } };
  } catch (e) {
    return { success: false, error: "分配失败" };
  }
}

// ============================================================
// 归还
// ============================================================

export async function returnAssets(
  input: z.infer<typeof returnSchema>
): Promise<ActionResult<{ returnedCount: number }>> {
  const validated = returnSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：所有设备必须是在用状态
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status !== "IN_USE") {
      return { success: false, error: `设备 ${asset.assetNo} 非在用状态，无法归还` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 更新设备状态
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: {
          status: "IDLE",
          employeeId: null,
        },
      });

      // 记录生命周期日志
      await tx.lifecycleLog.createMany({
        data: assetIds.map((id) => ({
          assetId: id,
          action: "RETURNED",
          fromStatus: "IN_USE",
          toStatus: "IDLE",
          employeeId: assets.find((a) => a.id === id)?.employeeId ?? null,
          operator,
          remark: remark ?? null,
        })),
      });
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

    return { success: true, data: { returnedCount: assetIds.length } };
  } catch (e) {
    return { success: false, error: "归还失败" };
  }
}

// ============================================================
// 调拨
// ============================================================

export async function transferAssets(
  input: z.infer<typeof transferSchema>
): Promise<ActionResult<{ transferredCount: number }>> {
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

  // 预检查：所有设备必须是在用状态
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status !== "IN_USE") {
      return { success: false, error: `设备 ${asset.assetNo} 非在用状态，无法调拨` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { employeeId: toEmployeeId },
      });

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

    return { success: true, data: { transferredCount: assetIds.length } };
  } catch (e) {
    return { success: false, error: "调拨失败" };
  }
}

// ============================================================
// 升级
// ============================================================

export async function upgradeAssetComponent(
  input: z.infer<typeof upgradeSchema>
): Promise<ActionResult<{ assetId: number; modelId: number; newModelId: number }>> {
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

  // 检查新配件库存
  const newModelStock = await prisma.componentStock.findUnique({
    where: { modelId: newModelId },
  });
  const available = newModelStock?.quantity ?? 0;
  if (available < quantity) {
    return { success: false, error: "新配件库存不足" };
  }

  try {
    await prisma.$transaction(async (tx) => {
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

      // 扣减新配件库存
      await tx.componentStock.update({
        where: { modelId: newModelId },
        data: { quantity: { decrement: quantity } },
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

    return { success: true, data: { assetId, modelId, newModelId } };
  } catch (e) {
    return { success: false, error: "升级失败" };
  }
}

// ============================================================
// 报废
// ============================================================

export async function scrapAssets(
  input: z.infer<typeof scrapSchema>
): Promise<ActionResult<{ scrappedCount: number }>> {
  const validated = scrapSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  // 预检查：设备必须存在且未报废
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status === "SCRAPPED") {
      return { success: false, error: `设备 ${asset.assetNo} 已报废` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: {
          status: "SCRAPPED",
          employeeId: null,
        },
      });

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

    return { success: true, data: { scrappedCount: assetIds.length } };
  } catch (e) {
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
  const validated = maintenanceStartSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status === "SCRAPPED") {
      return { success: false, error: `设备 ${asset.assetNo} 已报废，无法送修` };
    }
    if (asset.status === "IN_MAINTENANCE") {
      return { success: false, error: `设备 ${asset.assetNo} 已在维修中` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: "IN_MAINTENANCE" },
      });

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

    return { success: true, data: { startedCount: assetIds.length } };
  } catch (e) {
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
  const validated = maintenanceCompleteSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetIds, operator, remark } = validated.data;

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }
  for (const asset of assets) {
    if (asset.status !== "IN_MAINTENANCE") {
      return { success: false, error: `设备 ${asset.assetNo} 非维修中状态，无法标记完成` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: "IDLE" },
      });

      await tx.lifecycleLog.createMany({
        data: assetIds.map((id) => ({
          assetId: id,
          action: "MAINTENANCE_DONE",
          fromStatus: "IN_MAINTENANCE",
          toStatus: "IDLE",
          operator,
          remark: remark ?? null,
        })),
      });
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

    return { success: true, data: { completedCount: assetIds.length } };
  } catch (e) {
    return { success: false, error: "维修完成操作失败" };
  }
}
