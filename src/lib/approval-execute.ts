import { z } from "zod";
import type { Prisma } from "@prisma/client";

// ============================================================
// 审批通过后的业务执行（M4/M5）：资产报废。
// 升级/降级配件已改为完全手动执行（见 approval-execute.actions.ts），不再在此自动执行。
// 与审批引擎分离，避免「改业务规则」和「改审批流程」互相牵扯。
// 任何失败抛异常，由调用方（approveTask）记 EXECUTE_FAILED，资产保持预占待人工介入。
// ============================================================

/** 申请升级/降级配件的 payload 结构（assetId 设备 / componentCategoryId 配件类别 / action 动作） */
export const upgradePayloadSchema = z.object({
  assetId: z.number().int().positive(),
  componentCategoryId: z
    .number({ required_error: "配件类别不能为空" })
    .int()
    .positive("配件类别不能为空"),
  action: z.enum(["UPGRADE", "DOWNGRADE"], {
    message: "动作不合法，仅支持升级或降级",
  }),
  reason: z.string().min(1, "申请理由不能为空"),
});

/** 申请资产报废的 payload 结构（assetId 设备 / reason 报废理由） */
export const scrapPayloadSchema = z.object({
  assetId: z.number().int().positive(),
  reason: z.string().min(1, "报废理由不能为空"),
});

/** 申请设备退回的 payload 结构（assetId 设备 / reason 退回理由） */
export const returnPayloadSchema = z.object({
  assetId: z.number().int().positive(),
  reason: z.string().min(1, "退回理由不能为空"),
});

/** 申请设备更换的 payload 结构（assetId 旧机 / reason 更换理由；新机由资产管理员执行时选择） */
export const replacePayloadSchema = z.object({
  assetId: z.number().int().positive(),
  reason: z.string().min(1, "更换理由不能为空"),
});

/** 申请设备维修的 payload 结构（assetId 旧机 / reason 维修理由；替换机由资产管理员执行时选择） */
export const repairPayloadSchema = z.object({
  assetId: z.number().int().positive(),
  reason: z.string().min(1, "维修理由不能为空"),
});

/** 申请员工离职的 payload 结构（targetEmployeeId 离职员工 / reason 离职原因） */
export const departPayloadSchema = z.object({
  targetEmployeeId: z.number().int().positive(),
  reason: z.string().min(1, "离职原因不能为空"),
});

/**
 * 审批通过后系统自动执行「资产报废」。
 * 将设备状态置为 SCRAPPED，写生命周期日志，释放预占。
 */
export async function executeScrapOnApproval(
  tx: Prisma.TransactionClient,
  requestId: number,
  payload: Prisma.JsonValue
): Promise<void> {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("申请内容格式错误");
    }
  }
  const parsed = scrapPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new Error("申请内容格式错误");
  const { assetId, reason } = parsed.data;

  const asset = await tx.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("设备不存在");
  if (asset.status === "SCRAPPED") return;

  // 生命周期日志：运行中 → 报废
  await tx.lifecycleLog.create({
    data: {
      assetId,
      action: "SCRAPPED",
      fromStatus: asset.status,
      toStatus: "SCRAPPED",
      operator: "系统",
      operatorId: null,
      requestId,
      remark: reason ?? null,
    },
  });

  // 报废并释放预占
  await tx.asset.update({
    where: { id: assetId },
    data: { status: "SCRAPPED", reservedByRequestId: null, reservedFromStatus: null },
  });
}

/**
 * 审批通过后系统自动执行「设备退回」。
 * 将设备置为闲置(IDLE)、归还人员、释放预占，写 RETURNED 生命周期日志。
 */
export async function executeReturnOnApproval(
  tx: Prisma.TransactionClient,
  requestId: number,
  payload: Prisma.JsonValue
): Promise<void> {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("申请内容格式错误");
    }
  }
  const parsed = returnPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new Error("申请内容格式错误");
  const { assetId, reason } = parsed.data;

  const asset = await tx.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error("设备不存在");
  if (asset.status === "IDLE") return;

  // 生命周期日志：预占中 → 闲置（归还）
  await tx.lifecycleLog.create({
    data: {
      assetId,
      action: "RETURNED",
      fromStatus: asset.status,
      toStatus: "IDLE",
      operator: "系统",
      operatorId: null,
      requestId,
      remark: reason ?? null,
    },
  });

  // 置闲置、归还人员（退回即交还资产）、释放预占
  await tx.asset.update({
    where: { id: assetId },
    data: {
      status: "IDLE",
      employeeId: null,
      reservedByRequestId: null,
      reservedFromStatus: null,
    },
  });
}

// ============================================================
// 员工离职（ASSET_DEPART）：终审通过后生成「交接单」待对账
// 对账确认（见 approval-execute.actions.ts confirmHandover）无误后自动回收全部设备。
// ============================================================

/** 生成下一交接单号：HO-YYYYMM-NNNN（同月最大序号 +1） */
async function nextHandoverNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `HO-${ym}-`;
  const last = await tx.handoverOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const seq = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * 审批通过后生成「离职交接单」：记录离职员工名下设备清单快照（对账单），状态置待对账(PENDING)。
 * 不在此回收设备 —— 由资产管理员对账确认后统一自动回收。
 */
export async function executeDepartOnApproval(
  tx: Prisma.TransactionClient,
  requestId: number,
  payload: Prisma.JsonValue
): Promise<void> {
  let raw: unknown = payload;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error("申请内容格式错误");
    }
  }
  const parsed = departPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new Error("申请内容格式错误");
  const { targetEmployeeId } = parsed.data;

  const employee = await tx.employee.findUnique({ where: { id: targetEmployeeId } });
  if (!employee) throw new Error("离职员工不存在");

  // 离职员工名下设备清单快照（含预占中的设备，供资产管理员对账）
  const assets = await tx.asset.findMany({
    where: { employeeId: targetEmployeeId },
    orderBy: { id: "asc" },
    select: { id: true, assetNo: true, name: true, status: true },
  });
  const snapshot = assets.map((a) => ({ assetId: a.id, assetNo: a.assetNo, name: a.name, status: a.status }));

  const orderNo = await nextHandoverNo(tx);
  await tx.handoverOrder.create({
    data: {
      orderNo,
      employeeId: targetEmployeeId,
      requestId,
      status: "PENDING",
      assetSnapshot: snapshot as Prisma.InputJsonValue,
    },
  });
}
