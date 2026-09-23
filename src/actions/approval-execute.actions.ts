"use server";

import { z } from "zod";
import type { Prisma, AssetStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { ActionResult } from "@/lib/types";
import { applyComponentAdjustments } from "@/lib/component-adjust";
import {
  upgradePayloadSchema,
  replacePayloadSchema,
  repairPayloadSchema,
} from "@/lib/approval-execute";

// ============================================================
// 资产管理员「待执行变更」：审批通过后手动执行升级/降级配件
// 只处理 末节点=资产管理员(ASSET_MANAGER) 且 未执行(executedAt=null) 的单
// ============================================================

const adjustmentsSchema = z
  .array(
    z.object({
      modelId: z.number(),
      quantityDelta: z.number().int().refine((v) => v !== 0, "数量变化不能为0"),
    })
  )
  .min(1, "调整列表不能为空");

/** 解析升级/降级申请 payload（兼容历史 JSON 字符串存储），无效返回 null */
function parseUpgradePayload(
  payload: Prisma.JsonValue
): z.infer<typeof upgradePayloadSchema> | null {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = upgradePayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * 执行已通过的升级/降级申请。
 * 单事务内：条件更新标记 executedAt（幂等/防并发）→ 校验 → 改配件/库存/流水/UPGRADED 日志(requestId) → 释放资产预占。
 */
export async function executeApprovedChange(
  requestId: number,
  adjustments: { modelId: number; quantityDelta: number }[]
): Promise<ActionResult<{ requestId: number; executedAt: Date }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.upgrade.execute", "没有执行权限");
  if (denied) return denied;

  const parsed = adjustmentsSchema.safeParse(adjustments);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "调整列表不能为空" };
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.approvalRequest.updateMany({
        where: {
          id: requestId,
          status: "APPROVED",
          businessType: "ASSET_UPGRADE",
          finalNodeRole: "ASSET_MANAGER",
          executedAt: null,
        },
        data: { executedAt: now },
      });
      if (claim.count === 0) throw new Error("NOT_EXECUTABLE");

      const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      const p = parseUpgradePayload(req.payload);
      if (!p) throw new Error("BAD_PAYLOAD");

      const asset = await tx.asset.findUnique({ where: { id: p.assetId } });
      if (!asset) throw new Error("ASSET_NOT_FOUND");

      // 校验该配件类别确实在设备现有配件中
      const comps = await tx.assetComponent.findMany({
        where: { assetId: asset.id },
        include: { model: { select: { categoryId: true } } },
      });
      if (!comps.some((c) => c.model.categoryId === p.componentCategoryId)) {
        throw new Error("CATEGORY_NOT_ON_ASSET");
      }

      // 校验调整型号齐全 + 隶属于该配件品类 + 建 modelMap（摘要命名）
      const modelIds = [...new Set(parsed.data.map((a) => a.modelId))];
      const models = await tx.componentModel.findMany({
        where: { id: { in: modelIds }, categoryId: p.componentCategoryId },
        select: { id: true, name: true },
      });
      if (models.length !== modelIds.length) throw new Error("MODEL_CATEGORY_MISMATCH");
      const modelMap = new Map(models.map((m) => [m.id, m.name]));

      const actionLabel = p.action === "UPGRADE" ? "升级" : "降级";
      // 改配件 + 扣/回库存 + 流水 + UPGRADED 日志（requestId 追溯）
      await applyComponentAdjustments(tx, {
        assetId: asset.id,
        adjustments: parsed.data,
        operator: user.username,
        remark: `执行${actionLabel}申请${p.reason ? `：${p.reason}` : ""}`,
        requestId,
        modelMap,
        assetStatus: asset.status as AssetStatus,
      });

      // 释放资产预占：恢复原状态
      const restored = (asset.reservedFromStatus ?? "IN_USE") as AssetStatus;
      await tx.asset.update({
        where: { id: asset.id },
        data: { status: restored, reservedByRequestId: null, reservedFromStatus: null },
      });

      return { requestId, executedAt: now };
    });

    return { success: true, data: result };
  } catch (e) {
    const errMap: Record<string, string> = {
      NOT_EXECUTABLE: "申请单不满足执行条件或已执行",
      BAD_PAYLOAD: "申请内容格式错误",
      ASSET_NOT_FOUND: "设备不存在",
      CATEGORY_NOT_ON_ASSET: "设备上不存在该配件类别",
      MODEL_CATEGORY_MISMATCH: "配件型号不存在或不属于该配件类别",
      STOCK_INSUFFICIENT: "库存不足",
      COMPONENT_NOT_FOUND: "设备上不存在该配件",
      QUANTITY_INSUFFICIENT: "设备上该配件数量不足",
    };
    if (e instanceof Error && errMap[e.message]) {
      return { success: false, error: errMap[e.message] };
    }
    return { success: false, error: "执行失败" };
  }
}

export interface PendingExecutionRequest {
  id: number;
  requestNo: string;
  title: string;
  businessType: string;
  submittedAt: Date;
  assetId: number;
  assetNo: string;
  assetName: string;
  categoryId: number | null;
  categoryName: string;
  action: "UPGRADE" | "DOWNGRADE" | null;
  reason: string;
}

/** 待执行变更列表：末节点=资产管理员 且 已通过未执行（升级/更换/维修） */
export async function getPendingExecutionRequests(): Promise<ActionResult<PendingExecutionRequest[]>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.upgrade.execute", "没有查看待执行变更的权限");
  if (denied) return denied;

  const reqs = await prisma.approvalRequest.findMany({
    where: {
      status: "APPROVED",
      businessType: { in: ["ASSET_UPGRADE", "ASSET_REPLACE", "ASSET_REPAIR"] },
      finalNodeRole: "ASSET_MANAGER",
      executedAt: null,
    },
    orderBy: { submittedAt: "desc" },
    select: { id: true, requestNo: true, title: true, businessType: true, submittedAt: true, payload: true },
  });

  const upgraded = new Map<number, z.infer<typeof upgradePayloadSchema>>();
  const replaced = new Map<number, z.infer<typeof replacePayloadSchema>>();
  const repaired = new Map<number, z.infer<typeof repairPayloadSchema>>();
  const assetIds = new Set<number>();
  const categoryIds = new Set<number>();

  for (const r of reqs) {
    let raw: unknown = r.payload;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        continue;
      }
    }
    if (r.businessType === "ASSET_UPGRADE") {
      const p = upgradePayloadSchema.safeParse(raw);
      if (p.success) {
        upgraded.set(r.id, p.data);
        assetIds.add(p.data.assetId);
        categoryIds.add(p.data.componentCategoryId);
      }
    } else if (r.businessType === "ASSET_REPLACE") {
      const p = replacePayloadSchema.safeParse(raw);
      if (p.success) {
        replaced.set(r.id, p.data);
        assetIds.add(p.data.assetId);
      }
    } else if (r.businessType === "ASSET_REPAIR") {
      const p = repairPayloadSchema.safeParse(raw);
      if (p.success) {
        repaired.set(r.id, p.data);
        assetIds.add(p.data.assetId);
      }
    }
  }

  const [assets, cats] = await Promise.all([
    prisma.asset.findMany({ where: { id: { in: [...assetIds] } }, select: { id: true, assetNo: true, name: true } }),
    prisma.componentCategory.findMany({ where: { id: { in: [...categoryIds] } }, select: { id: true, name: true } }),
  ]);
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const catMap = new Map(cats.map((c) => [c.id, c.name]));

  const data: PendingExecutionRequest[] = reqs.flatMap((r) => {
    const assetId =
      upgraded.get(r.id)?.assetId ?? replaced.get(r.id)?.assetId ?? repaired.get(r.id)?.assetId;
    if (!assetId) return [];
    const asset = assetMap.get(assetId);
    const up = upgraded.get(r.id);
    return [
      {
        id: r.id,
        requestNo: r.requestNo,
        title: r.title,
        businessType: r.businessType,
        submittedAt: r.submittedAt,
        assetId,
        assetNo: asset?.assetNo ?? String(assetId),
        assetName: asset?.name ?? "",
        categoryId: up?.componentCategoryId ?? null,
        categoryName: up ? catMap.get(up.componentCategoryId) ?? "" : "",
        action: up?.action ?? null,
        reason: up?.reason ?? replaced.get(r.id)?.reason ?? repaired.get(r.id)?.reason ?? "",
      },
    ];
  });

  return { success: true, data };
}

export interface ExecutableDetail {
  requestId: number;
  requestNo: string;
  businessType: string;
  assetId: number;
  assetNo: string;
  assetName: string;
  reason: string;
  // 升级/降级专有
  categoryId?: number;
  categoryName?: string;
  action?: "UPGRADE" | "DOWNGRADE";
  currentComponents?: {
    assetComponentId: number;
    modelId: number;
    modelName: string;
    quantity: number;
    categoryId: number;
  }[];
  categoryModels?: { modelId: number; modelName: string; brand: string; stock: number }[];
  // 更换/维修专有：候选替换机
  availableAssets?: { assetId: number; assetNo: string; assetName: string; status: string }[];
}

/** 弹窗详情：按业务类型返回执行上下文（升级=配件调整；更换/维修=替换机候选） */
export async function getExecutableDetail(
  requestId: number
): Promise<ActionResult<ExecutableDetail>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.upgrade.execute", "没有执行权限");
  if (denied) return denied;

  const req = await prisma.approvalRequest.findUnique({ where: { id: requestId } });
  if (
    !req ||
    !["ASSET_UPGRADE", "ASSET_REPLACE", "ASSET_REPAIR"].includes(req.businessType) ||
    req.status !== "APPROVED" ||
    req.finalNodeRole !== "ASSET_MANAGER" ||
    req.executedAt !== null
  ) {
    return { success: false, error: "申请单不满足执行条件或已执行" };
  }

  let raw: unknown = req.payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { success: false, error: "申请内容格式错误" };
    }
  }

  // 更换 / 维修：返回候选替换机（闲置或在库且未分配）
  if (req.businessType === "ASSET_REPLACE" || req.businessType === "ASSET_REPAIR") {
    const p = replacePayloadSchema.safeParse(raw);
    const isRepair = req.businessType === "ASSET_REPAIR";
    const parsed = isRepair ? repairPayloadSchema.safeParse(raw) : p;
    if (!parsed.success) return { success: false, error: "申请内容格式错误" };

    const asset = await prisma.asset.findUnique({ where: { id: parsed.data.assetId } });
    if (!asset) return { success: false, error: "设备不存在" };

    const availableAssets = await prisma.asset.findMany({
      where: {
        status: { in: ["IDLE", "IN_STOCK"] },
        employeeId: null,
      },
      orderBy: { assetNo: "asc" },
      select: { id: true, assetNo: true, name: true, status: true },
    });

    return {
      success: true,
      data: {
        requestId: req.id,
        requestNo: req.requestNo,
        businessType: req.businessType,
        assetId: asset.id,
        assetNo: asset.assetNo,
        assetName: asset.name,
        reason: parsed.data.reason,
        availableAssets: availableAssets.map((a) => ({
          assetId: a.id,
          assetNo: a.assetNo,
          assetName: a.name,
          status: a.status,
        })),
      },
    };
  }

  // 升级 / 降级：保留原有逻辑
  const p = upgradePayloadSchema.safeParse(raw);
  if (!p.success) return { success: false, error: "申请内容格式错误" };

  const asset = await prisma.asset.findUnique({ where: { id: p.data.assetId } });
  if (!asset) return { success: false, error: "设备不存在" };

  const [currentComponents, categoryModels, cat] = await Promise.all([
    prisma.assetComponent.findMany({
      where: { assetId: asset.id },
      include: { model: { select: { id: true, name: true, categoryId: true } } },
    }),
    prisma.componentModel.findMany({
      where: { categoryId: p.data.componentCategoryId },
      include: { stock: { select: { quantity: true } } },
    }),
    prisma.componentCategory.findUnique({ where: { id: p.data.componentCategoryId } }),
  ]);

  return {
    success: true,
    data: {
      requestId: req.id,
      requestNo: req.requestNo,
      businessType: req.businessType,
      assetId: asset.id,
      assetNo: asset.assetNo,
      assetName: asset.name,
      reason: p.data.reason,
      categoryId: p.data.componentCategoryId,
      categoryName: cat?.name ?? "",
      action: p.data.action,
      currentComponents: currentComponents.map((c) => ({
        assetComponentId: c.id,
        modelId: c.modelId,
        modelName: c.model.name,
        quantity: c.quantity,
        categoryId: c.model.categoryId,
      })),
      categoryModels: categoryModels.map((m) => ({
        modelId: m.id,
        modelName: m.name,
        brand: m.brand,
        stock: m.stock?.quantity ?? 0,
      })),
    },
  };
}

// ============================================================
// 执行设备更换（ASSET_REPLACE）
// 资产管理员在「待执行变更」选择一台可用机器执行:
//   回收旧机 → 置闲置(IDLE)归还人员并释放预占，写 REPLACED 日志
//   分配新机 → 置在用(IN_USE)绑定申请人，写 ALLOCATED 日志
// 单事务 + executedAt 条件更新保证幂等/防并发。
// ============================================================

/** 解析设备更换申请 payload（兼容历史 JSON 字符串存储），无效返回 null */
function parseReplacePayload(payload: Prisma.JsonValue): z.infer<typeof replacePayloadSchema> | null {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = replacePayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function executeReplaceChange(
  requestId: number,
  newAssetId: number
): Promise<ActionResult<{ requestId: number; executedAt: Date }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.replace.execute", "没有执行权限");
  if (denied) return denied;

  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(newAssetId) || newAssetId <= 0) {
    return { success: false, error: "参数无效" };
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.approvalRequest.updateMany({
        where: {
          id: requestId,
          status: "APPROVED",
          businessType: "ASSET_REPLACE",
          finalNodeRole: "ASSET_MANAGER",
          executedAt: null,
        },
        data: { executedAt: now },
      });
      if (claim.count === 0) throw new Error("NOT_EXECUTABLE");

      const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      const p = parseReplacePayload(req.payload);
      if (!p) throw new Error("BAD_PAYLOAD");

      const oldAsset = await tx.asset.findUnique({ where: { id: p.assetId } });
      if (!oldAsset) throw new Error("ASSET_NOT_FOUND");

      const newAsset = await tx.asset.findUnique({ where: { id: newAssetId } });
      if (!newAsset) throw new Error("NEW_ASSET_NOT_FOUND");
      if (newAsset.id === oldAsset.id) throw new Error("NEW_ASSET_NOT_AVAILABLE");
      if (!["IDLE", "IN_STOCK"].includes(newAsset.status)) throw new Error("NEW_ASSET_NOT_AVAILABLE");
      if (newAsset.employeeId !== null) throw new Error("NEW_ASSET_NOT_AVAILABLE");

      // 回收旧机：置闲置、归还人员、释放预占，写 REPLACED 日志
      await tx.lifecycleLog.create({
        data: {
          assetId: oldAsset.id,
          action: "REPLACED",
          fromStatus: oldAsset.status,
          toStatus: "IDLE",
          operator: user.username,
          operatorId: user.id,
          requestId,
          remark: p.reason ?? null,
        },
      });
      await tx.asset.update({
        where: { id: oldAsset.id },
        data: {
          status: "IDLE",
          employeeId: null,
          reservedByRequestId: null,
          reservedFromStatus: null,
        },
      });

      // 分配新机给申请人：置在用、绑定人员，写 ALLOCATED 日志
      await tx.lifecycleLog.create({
        data: {
          assetId: newAsset.id,
          action: "ALLOCATED",
          fromStatus: newAsset.status,
          toStatus: "IN_USE",
          operator: user.username,
          operatorId: user.id,
          requestId,
          remark: `更换分配`,
        },
      });
      await tx.asset.update({
        where: { id: newAsset.id },
        data: { status: "IN_USE", employeeId: oldAsset.employeeId },
      });

      return { requestId, executedAt: now };
    });

    return { success: true, data: result };
  } catch (e) {
    const errMap: Record<string, string> = {
      NOT_EXECUTABLE: "申请单不满足执行条件或已执行",
      BAD_PAYLOAD: "申请内容格式错误",
      ASSET_NOT_FOUND: "旧设备不存在",
      NEW_ASSET_NOT_FOUND: "新设备不存在",
      NEW_ASSET_NOT_AVAILABLE: "新设备不可用（需为闲置或在库且未分配）",
    };
    if (e instanceof Error && errMap[e.message]) {
      return { success: false, error: errMap[e.message] };
    }
    return { success: false, error: "执行失败" };
  }
}

// ============================================================
// 执行设备维修（ASSET_REPAIR）
// 资产管理员在「待执行变更」选择一台可用替换机执行:
//   旧机 → 置维修中(IN_MAINTENANCE)并释放预占，写 MAINTENANCE_START 日志
//   替换机 → 置在用(IN_USE)绑定申请人，写 ALLOCATED 日志
// 单事务 + executedAt 条件更新保证幂等/防并发。
// ============================================================

/** 解析设备维修申请 payload（兼容历史 JSON 字符串存储），无效返回 null */
function parseRepairPayload(payload: Prisma.JsonValue): z.infer<typeof repairPayloadSchema> | null {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = repairPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function executeRepairChange(
  requestId: number,
  replacementAssetId: number
): Promise<ActionResult<{ requestId: number; executedAt: Date }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.repair.execute", "没有执行权限");
  if (denied) return denied;

  if (
    !Number.isInteger(requestId) ||
    requestId <= 0 ||
    !Number.isInteger(replacementAssetId) ||
    replacementAssetId <= 0
  ) {
    return { success: false, error: "参数无效" };
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.approvalRequest.updateMany({
        where: {
          id: requestId,
          status: "APPROVED",
          businessType: "ASSET_REPAIR",
          finalNodeRole: "ASSET_MANAGER",
          executedAt: null,
        },
        data: { executedAt: now },
      });
      if (claim.count === 0) throw new Error("NOT_EXECUTABLE");

      const req = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      const p = parseRepairPayload(req.payload);
      if (!p) throw new Error("BAD_PAYLOAD");

      const oldAsset = await tx.asset.findUnique({ where: { id: p.assetId } });
      if (!oldAsset) throw new Error("ASSET_NOT_FOUND");

      const replacement = await tx.asset.findUnique({ where: { id: replacementAssetId } });
      if (!replacement) throw new Error("NEW_ASSET_NOT_FOUND");
      if (replacement.id === oldAsset.id) throw new Error("NEW_ASSET_NOT_AVAILABLE");
      if (!["IDLE", "IN_STOCK"].includes(replacement.status)) throw new Error("NEW_ASSET_NOT_AVAILABLE");
      if (replacement.employeeId !== null) throw new Error("NEW_ASSET_NOT_AVAILABLE");

      // 旧机置维修中、释放预占，写 MAINTENANCE_START 日志
      await tx.lifecycleLog.create({
        data: {
          assetId: oldAsset.id,
          action: "MAINTENANCE_START",
          fromStatus: oldAsset.status,
          toStatus: "IN_MAINTENANCE",
          operator: user.username,
          operatorId: user.id,
          requestId,
          remark: p.reason ?? null,
        },
      });
      await tx.asset.update({
        where: { id: oldAsset.id },
        data: {
          status: "IN_MAINTENANCE",
          reservedByRequestId: null,
          reservedFromStatus: null,
        },
      });

      // 替换机分配申请人：置在用、绑定人员，写 ALLOCATED 日志
      await tx.lifecycleLog.create({
        data: {
          assetId: replacement.id,
          action: "ALLOCATED",
          fromStatus: replacement.status,
          toStatus: "IN_USE",
          operator: user.username,
          operatorId: user.id,
          requestId,
          remark: `维修替换分配`,
        },
      });
      await tx.asset.update({
        where: { id: replacement.id },
        data: { status: "IN_USE", employeeId: oldAsset.employeeId },
      });

      return { requestId, executedAt: now };
    });

    return { success: true, data: result };
  } catch (e) {
    const errMap: Record<string, string> = {
      NOT_EXECUTABLE: "申请单不满足执行条件或已执行",
      BAD_PAYLOAD: "申请内容格式错误",
      ASSET_NOT_FOUND: "旧设备不存在",
      NEW_ASSET_NOT_FOUND: "替换机不存在",
      NEW_ASSET_NOT_AVAILABLE: "替换机不可用（需为闲置或在库且未分配）",
    };
    if (e instanceof Error && errMap[e.message]) {
      return { success: false, error: errMap[e.message] };
    }
    return { success: false, error: "执行失败" };
  }
}

// ============================================================
// 离职交接对账（ASSET_DEPART）：资产管理员核对交接单无误后自动回收
// 回收离职员工名下全部设备 → 逐一置闲置(IDLE)归还人员/释放预占，写 RETURNED 生命周期日志。
// 单事务 + 状态条件更新保证幂等/防并发。
// ============================================================

export async function confirmHandover(
  orderId: number,
  remark?: string
): Promise<ActionResult<{ orderId: number; collectedAt: Date }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.depart.execute", "没有对账回收权限");
  if (denied) return denied;

  if (!Number.isInteger(orderId) || orderId <= 0) {
    return { success: false, error: "参数无效" };
  }

  try {
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      // 条件更新：仅待对账(PENDING)可回收，保证幂等/防并发
      const claim = await tx.handoverOrder.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: {
          status: "COLLECTED",
          confirmedById: user.id,
          confirmRemark: remark ?? null,
          confirmedAt: now,
          collectedAt: now,
        },
      });
      if (claim.count === 0) throw new Error("NOT_EXECUTABLE");

      const order = await tx.handoverOrder.findUniqueOrThrow({ where: { id: orderId } });

      // 回收离职员工名下全部设备：置闲置、归还人员、释放预占，逐台写 RETURNED 日志
      const assets = await tx.asset.findMany({
        where: { employeeId: order.employeeId },
        orderBy: { id: "asc" },
      });
      for (const asset of assets) {
        await tx.lifecycleLog.create({
          data: {
            assetId: asset.id,
            action: "RETURNED",
            fromStatus: asset.status,
            toStatus: "IDLE",
            employeeId: asset.employeeId,
            operator: user.username,
            operatorId: user.id,
            requestId: order.requestId ?? null,
            remark: "离职回收",
          },
        });
        await tx.asset.update({
          where: { id: asset.id },
          data: {
            status: "IDLE",
            employeeId: null,
            reservedByRequestId: null,
            reservedFromStatus: null,
          },
        });
      }

      return { orderId, collectedAt: now };
    });

    return { success: true, data: result };
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_EXECUTABLE") {
      return { success: false, error: "交接单不满足对账条件或已回收" };
    }
    return { success: false, error: "执行失败" };
  }
}