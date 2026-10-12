"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { planAllocation, type AllocationAsset } from "@/lib/allocation";

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

const multiAllocateSchema = z.object({
  assignments: z
    .array(z.object({ assetId: z.number(), employeeId: z.number() }))
    .min(1, "分配列表不能为空"),
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

const adjustComponentsSchema = z.object({
  assetId: z.number(),
  adjustments: z
    .array(
      z.object({
        modelId: z.number(),
        quantityDelta: z.number().int().refine((v) => v !== 0, "数量变化不能为0"),
      })
    )
    .min(1, "调整列表不能为空"),
  operator: z.string().min(1),
  remark: z.string().optional(),
});

// ============================================================
// 分配
// ============================================================

export async function allocateAssets(
  input: z.infer<typeof allocateSchema>
): Promise<ActionResult<{ allocatedCount: number }>> {
  await requireAuth();

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
      // 原子性更新：只有状态为 IDLE 或 IN_STOCK 的设备才会被更新
      const updateResult = await tx.asset.updateMany({
        where: {
          id: { in: assetIds },
          status: { in: ["IDLE", "IN_STOCK"] },
        },
        data: {
          status: "IN_USE",
          employeeId,
          // 分配完成后设备名改为使用人姓名
          name: employee.name,
        },
      });

      // 如果更新数量不匹配，说明有设备不是闲置状态
      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      // 唯一性校验：检查目标员工是否已拥有该分类下的唯一设备
      // 从模板获取分类ID
      const templateIds = [...new Set(assets.map(a => a.templateId))];
      const templatesWithCategory = await tx.deviceTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, categoryId: true },
      });
      const templateToCategory = new Map(templatesWithCategory.map(t => [t.id, t.categoryId]));
      const allCategoryIds = [...new Set(assets.map(a => templateToCategory.get(a.templateId)!))];

      const uniqueCategories = await tx.assetCategory.findMany({
        where: { id: { in: allCategoryIds }, unique: true },
        select: { id: true, name: true },
      });
      if (uniqueCategories.length > 0) {
        const uniqueCategoryIds = new Set(uniqueCategories.map(c => c.id));

        // 批内自冲突：同一批里出现 2 台以上同唯一分类的设备，分给同一个人必然违规。
        // 下面的查询刻意带 notIn 排除本批（更新后本批已属于该员工，不排除会把每次
        // 分配都判成违规），因此这一层必须单独校验 —— 历史上正是漏了它，
        // 才让「5 台笔记本全给一个人」在后端畅通无阻。
        const batchCountByCategory = new Map<number, number>();
        for (const a of assets) {
          const catId = templateToCategory.get(a.templateId);
          if (catId === undefined || !uniqueCategoryIds.has(catId)) continue;
          batchCountByCategory.set(catId, (batchCountByCategory.get(catId) ?? 0) + 1);
        }
        if ([...batchCountByCategory.values()].some((n) => n > 1)) {
          const categoryNames = uniqueCategories.map(c => c.name).join("、");
          throw new Error(`UNIQUE_VIOLATION:${categoryNames}`);
        }

        const existingAssets = await tx.asset.findMany({
          where: {
            employeeId,
            template: { categoryId: { in: Array.from(uniqueCategoryIds) } },
            status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
            id: { notIn: assetIds },
          },
        });
        if (existingAssets.length > 0) {
          const categoryNames = uniqueCategories.map(c => c.name).join("、");
          throw new Error(`UNIQUE_VIOLATION:${categoryNames}`);
        }
      }

      // 记录生命周期日志
      const assetStatusMap = new Map(assets.map((a) => [a.id, a.status]));
      await tx.lifecycleLog.createMany({
        data: assetIds.map((id) => ({
          assetId: id,
          action: "ALLOCATED",
          fromStatus: assetStatusMap.get(id) ?? "IDLE",
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
        return { success: false, error: "部分设备不可分配（非闲置或非库存状态）" };
      }
      if (e.message.startsWith("UNIQUE_VIOLATION")) {
        const categoryNames = e.message.split(":")[1] ?? "";
        return { success: false, error: `唯一性约束：员工已拥有该分类（${categoryNames}）下的设备，不能重复分配` };
      }
    }
    return { success: false, error: "分配失败" };
  }
}

// ============================================================
// 批量分配（多员工）
// ============================================================

export interface AllocateSkipped {
  assetId: number;
  assetNo: string;
  reason: string;
}

/**
 * 一次提交多个员工的分配映射（批量分配弹窗的提交口）。
 *
 * 与 `allocateAssets` 的两点不同，都是为了配合「多选员工 + 均值分配 + 跳过冲突」：
 *  - **按员工独立事务**（放弃整批原子）：一个员工遇到冲突不该拖垮其他人；
 *  - 提交前用 `planAllocation` 按员工复核，**只落可行子集**，冲突项原样回报。
 *
 * 校验规则与前端预览共用 `planAllocation`，不存在第二份实现。
 */
export async function allocateAssetsToEmployees(
  input: z.infer<typeof multiAllocateSchema>
): Promise<ActionResult<{ allocatedCount: number; skipped: AllocateSkipped[] }>> {
  await requireAuth();

  const validated = multiAllocateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assignments, operator, remark } = validated.data;

  const assetIds = [...new Set(assignments.map((a) => a.assetId))];
  const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];

  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    include: {
      template: {
        select: { categoryId: true, category: { select: { name: true, unique: true } } },
      },
    },
  });
  if (assets.length !== assetIds.length) {
    return { success: false, error: "部分设备不存在" };
  }

  const employees = await prisma.employee.findMany({ where: { id: { in: employeeIds } } });
  if (employees.length !== employeeIds.length) {
    return { success: false, error: "部分员工不存在" };
  }

  // 各员工「已持有的唯一分类」。不排除本批设备 —— 本批此刻仍是闲置/库存，
  // 本来就不属于任何人；要排除的是「本批被分出去之后」的状态，那由配额封顶负责。
  const ownedRows = await prisma.asset.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
      template: { category: { unique: true } },
    },
    select: { employeeId: true, template: { select: { categoryId: true } } },
  });
  const ownedByEmployee = new Map<number, number[]>();
  for (const row of ownedRows) {
    if (row.employeeId === null) continue;
    const list = ownedByEmployee.get(row.employeeId) ?? [];
    if (!list.includes(row.template.categoryId)) list.push(row.template.categoryId);
    ownedByEmployee.set(row.employeeId, list);
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const grouped = new Map<number, number[]>();
  for (const a of assignments) {
    const list = grouped.get(a.employeeId);
    if (list) list.push(a.assetId);
    else grouped.set(a.employeeId, [a.assetId]);
  }

  const skipped: AllocateSkipped[] = [];
  let allocatedCount = 0;

  // 员工处理顺序固定（部门→工号），与前端预览的槽位顺序一致
  const orderedEmployeeIds = [...grouped.keys()].sort((x, y) => {
    const ex = employeeById.get(x)!;
    const ey = employeeById.get(y)!;
    if (ex.departmentId !== ey.departmentId) return ex.departmentId - ey.departmentId;
    const byNo = ex.employeeNo.localeCompare(ey.employeeNo, undefined, { numeric: true });
    return byNo !== 0 ? byNo : ex.id - ey.id;
  });

  for (const employeeId of orderedEmployeeIds) {
    const employee = employeeById.get(employeeId)!;
    const groupAssetIds = grouped.get(employeeId)!;

    const planAssets: AllocationAsset[] = groupAssetIds
      .map((id) => assetById.get(id)!)
      .map((a) => ({
        id: a.id,
        assetNo: a.assetNo,
        status: a.status,
        categoryId: a.template.categoryId,
        categoryName: a.template.category.name,
        categoryUnique: a.template.category.unique,
        employeeId: a.employeeId,
      }));

    const plan = planAllocation(planAssets, [
      {
        id: employee.id,
        name: employee.name,
        employeeNo: employee.employeeNo,
        departmentId: employee.departmentId,
        departmentName: "",
        ownedUniqueCategoryIds: ownedByEmployee.get(employee.id) ?? [],
      },
    ]);

    skipped.push(...plan.conflicts);

    const idsToAllocate = plan.assignments.map((a) => a.assetId);
    if (idsToAllocate.length === 0) continue;

    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.asset.updateMany({
          where: { id: { in: idsToAllocate }, status: { in: ["IDLE", "IN_STOCK"] } },
          data: { status: "IN_USE", employeeId: employee.id, name: employee.name },
        });
        if (updated.count !== idsToAllocate.length) {
          throw new Error("STATUS_CONFLICT");
        }

        await tx.lifecycleLog.createMany({
          data: idsToAllocate.map((id) => ({
            assetId: id,
            action: "ALLOCATED",
            fromStatus: assetById.get(id)?.status ?? "IDLE",
            toStatus: "IN_USE",
            employeeId: employee.id,
            operator,
            remark: remark ?? null,
          })),
        });
      });

      allocatedCount += idsToAllocate.length;

      // 多员工提交按员工各记一条，比「一批统一一条」更可追溯
      const assetNos = idsToAllocate.map((id) => assetById.get(id)!.assetNo).join("、");
      await prisma.systemLog.create({
        data: {
          module: "分配",
          action: "分配设备",
          detail: `将 ${assetNos} 分配给 ${employee.name}`,
          operator,
        },
      });
    } catch {
      // 复核通过但提交时状态已变（并发），逐台回报而不影响其他员工
      for (const id of idsToAllocate) {
        skipped.push({
          assetId: id,
          assetNo: assetById.get(id)?.assetNo ?? "",
          reason: "提交时设备状态已变化，不可分配",
        });
      }
    }
  }

  return { success: true, data: { allocatedCount, skipped } };
}

// ============================================================
// 归还
// ============================================================

export async function returnAssets(
  input: z.infer<typeof returnSchema>
): Promise<ActionResult<{ returnedCount: number }>> {
  await requireAuth();

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
          // 归还后设备名改回「闲置」
          name: "闲置",
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
  await requireAuth();

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
        data: {
          employeeId: toEmployeeId,
          // 调拨后设备名改为新使用人姓名
          name: toEmployee.name,
        },
      });

      if (updateResult.count !== assetIds.length) {
        throw new Error("STATUS_CONFLICT");
      }

      // 唯一性校验：检查目标员工是否已拥有该分类下的唯一设备
      const templatesWithCategory = await tx.deviceTemplate.findMany({
        where: { id: { in: [...new Set(assets.map(a => a.templateId))] } },
        select: { id: true, categoryId: true },
      });
      const templateToCategory = new Map(templatesWithCategory.map(t => [t.id, t.categoryId]));
      const allCategoryIds = [...new Set(assets.map(a => templateToCategory.get(a.templateId)!))];

      const uniqueCategories = await tx.assetCategory.findMany({
        where: { id: { in: allCategoryIds }, unique: true },
        select: { id: true, name: true },
      });
      if (uniqueCategories.length > 0) {
        const uniqueCategoryIds = new Set(uniqueCategories.map(c => c.id));

        // 批内自冲突：同批里 2 台以上同唯一分类设备调拨给同一人必然违规
        // （与 allocateAssets 同款修复，理由见那里的注释）
        const batchCountByCategory = new Map<number, number>();
        for (const a of assets) {
          const catId = templateToCategory.get(a.templateId);
          if (catId === undefined || !uniqueCategoryIds.has(catId)) continue;
          batchCountByCategory.set(catId, (batchCountByCategory.get(catId) ?? 0) + 1);
        }
        if ([...batchCountByCategory.values()].some((n) => n > 1)) {
          const categoryNames = uniqueCategories.map(c => c.name).join("、");
          throw new Error(`UNIQUE_VIOLATION:${categoryNames}`);
        }

        const existingAssets = await tx.asset.findMany({
          where: {
            employeeId: toEmployeeId,
            template: { categoryId: { in: Array.from(uniqueCategoryIds) } },
            status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
            id: { notIn: assetIds },
          },
        });
        if (existingAssets.length > 0) {
          const categoryNames = uniqueCategories.map(c => c.name).join("、");
          throw new Error(`UNIQUE_VIOLATION:${categoryNames}`);
        }
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
    if (e instanceof Error) {
      if (e.message === "STATUS_CONFLICT") {
        return { success: false, error: "部分设备非在用状态，无法调拨" };
      }
      if (e.message.startsWith("UNIQUE_VIOLATION")) {
        const categoryNames = e.message.split(":")[1] ?? "";
        return { success: false, error: `唯一性约束：目标员工已拥有该分类（${categoryNames}）下的设备，不能调拨` };
      }
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
  await requireAuth();

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
  await requireAuth();

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
  await requireAuth();

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
  await requireAuth();

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

// ============================================================
// 配件配置调整
// ============================================================

export async function adjustAssetComponents(
  input: z.infer<typeof adjustComponentsSchema>
): Promise<ActionResult<{ assetId: number }>> {
  await requireAuth();

  const validated = adjustComponentsSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { assetId, adjustments, operator, remark } = validated.data;

  // 检查设备是否存在
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { success: false, error: "设备不存在" };
  }

  // 检查所有涉及的配件型号是否存在
  const modelIds = [...new Set(adjustments.map((a) => a.modelId))];
  const models = await prisma.componentModel.findMany({
    where: { id: { in: modelIds } },
    select: { id: true, name: true },
  });
  if (models.length !== modelIds.length) {
    return { success: false, error: "配件型号不存在" };
  }
  const modelMap = new Map(models.map((m) => [m.id, m.name]));

  try {
    await prisma.$transaction(async (tx) => {
      // 获取设备当前配件配置
      const currentComponents = await tx.assetComponent.findMany({
        where: { assetId },
      });
      const currentMap = new Map(currentComponents.map((c) => [c.modelId, c]));

      for (const adj of adjustments) {
        if (adj.quantityDelta > 0) {
          // === 增加配件 ===
          // 原子性扣减库存
          const stockUpdate = await tx.componentStock.updateMany({
            where: {
              modelId: adj.modelId,
              quantity: { gte: adj.quantityDelta },
            },
            data: { quantity: { decrement: adj.quantityDelta } },
          });

          if (stockUpdate.count === 0) {
            throw new Error("STOCK_INSUFFICIENT");
          }

          // 更新设备配件配置
          const existing = currentMap.get(adj.modelId);
          if (existing) {
            await tx.assetComponent.update({
              where: { assetId_modelId: { assetId, modelId: adj.modelId } },
              data: { quantity: { increment: adj.quantityDelta } },
            });
          } else {
            await tx.assetComponent.create({
              data: { assetId, modelId: adj.modelId, quantity: adj.quantityDelta },
            });
          }

          // 库存出库流水
          await tx.componentStockLog.create({
            data: {
              modelId: adj.modelId,
              type: "UPGRADE_USE",
              quantity: -adj.quantityDelta,
              operator,
              remark: remark ?? null,
            },
          });
        } else {
          // === 减少配件 ===
          const existing = currentMap.get(adj.modelId);
          if (!existing) {
            throw new Error("COMPONENT_NOT_FOUND");
          }

          const removeQty = Math.abs(adj.quantityDelta);
          if (existing.quantity < removeQty) {
            throw new Error("QUANTITY_INSUFFICIENT");
          }

          if (existing.quantity === removeQty) {
            // 全部移除，删除记录
            await tx.assetComponent.delete({
              where: { assetId_modelId: { assetId, modelId: adj.modelId } },
            });
          } else {
            // 部分减少
            await tx.assetComponent.update({
              where: { assetId_modelId: { assetId, modelId: adj.modelId } },
              data: { quantity: { decrement: removeQty } },
            });
          }

          // 库存回补
          await tx.componentStock.upsert({
            where: { modelId: adj.modelId },
            update: { quantity: { increment: removeQty } },
            create: { modelId: adj.modelId, quantity: removeQty },
          });

          // 库存入库流水
          await tx.componentStockLog.create({
            data: {
              modelId: adj.modelId,
              type: "UPGRADE_RETURN",
              quantity: removeQty,
              operator,
              remark: remark ?? null,
            },
          });
        }
      }

      // 生成变更摘要
      const summaryParts = adjustments.map((adj) => {
        const name = modelMap.get(adj.modelId) ?? String(adj.modelId);
        if (adj.quantityDelta > 0) {
          return `+${adj.quantityDelta} ${name}`;
        }
        return `${adj.quantityDelta} ${name}`;
      });
      const changeSummary = summaryParts.join("；");

      // 生命周期日志
      await tx.lifecycleLog.create({
        data: {
          assetId,
          action: "UPGRADED",
          fromStatus: asset.status,
          toStatus: asset.status,
          operator,
          remark: remark
            ? `${remark}（${changeSummary}）`
            : `配置调整：${changeSummary}`,
        },
      });
    });

    // 系统日志（事务外写入）
    const changeSummary = adjustments.map((adj) => {
      const name = modelMap.get(adj.modelId) ?? String(adj.modelId);
      return adj.quantityDelta > 0 ? `+${adj.quantityDelta} ${name}` : `${adj.quantityDelta} ${name}`;
    }).join("；");

    await prisma.systemLog.create({
      data: {
        module: "配置变更",
        action: "调整设备配件",
        detail: `设备 ${asset.assetNo}：${changeSummary}`,
        operator,
      },
    });

    return { success: true, data: { assetId } };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "STOCK_INSUFFICIENT") {
        return { success: false, error: "库存不足" };
      }
      if (e.message === "COMPONENT_NOT_FOUND") {
        return { success: false, error: "设备上不存在该配件" };
      }
      if (e.message === "QUANTITY_INSUFFICIENT") {
        return { success: false, error: "设备上该配件数量不足" };
      }
    }
    return { success: false, error: "配置调整失败" };
  }
}
