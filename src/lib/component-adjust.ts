import type { Prisma, AssetStatus } from "@prisma/client";

/**
 * 配件配置调整 —— 共享事务体。
 *
 * 被两类入口复用：
 *  - 资产管理员在「待执行变更」页手动执行升级/降级（审批通过后）；
 *  - 既有 `adjustAssetComponents`（人工直接调整设备配件）。
 *
 * 内部完成：判库存 → 增删 `assetComponent` → 写 `UPGRADE_USE`(出库)/`UPGRADE_RETURN`(回库) 流水
 * → 记 lifecycleLog(UPGRADED，含 requestId 追溯)。返回变更摘要字符串（如 "+1 内存；-1 硬盘"）。
 *
 * 约定（tests/adjust-components.test.ts 与 tests/lifecycle.test.ts 断言依赖，勿改）：
 *  - 抛出错误码：`STOCK_INSUFFICIENT` / `COMPONENT_NOT_FOUND` / `QUANTITY_INSUFFICIENT`。
 *  - `operator` 必填；增加配件扣库存、减少配件回库（正数回补）。
 */
export interface ComponentAdjust {
  modelId: number;
  quantityDelta: number; // 正=增加，负=减少
}

export interface ApplyComponentAdjustmentsCtx {
  assetId: number;
  adjustments: ComponentAdjust[];
  operator: string;
  remark?: string | null;
  requestId?: number | null; // 审批升级手动执行时追溯申请单
  modelMap: Map<number, string>; // modelId -> 型号名，用于摘要
  assetStatus: AssetStatus; // 设备当前状态（UPGRADED 日志 from/to）
}

export async function applyComponentAdjustments(
  tx: Prisma.TransactionClient,
  ctx: ApplyComponentAdjustmentsCtx
): Promise<string> {
  const { assetId, adjustments, operator, remark, requestId, modelMap, assetStatus } = ctx;

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
  const changeSummary = adjustments
    .map((adj) => {
      const name = modelMap.get(adj.modelId) ?? String(adj.modelId);
      return adj.quantityDelta > 0 ? `+${adj.quantityDelta} ${name}` : `${adj.quantityDelta} ${name}`;
    })
    .join("；");

  // 生命周期日志
  await tx.lifecycleLog.create({
    data: {
      assetId,
      action: "UPGRADED",
      fromStatus: assetStatus,
      toStatus: assetStatus,
      operator,
      requestId: requestId ?? null,
      remark: remark
        ? `${remark}（${changeSummary}）`
        : `配置调整：${changeSummary}`,
    },
  });

  return changeSummary;
}