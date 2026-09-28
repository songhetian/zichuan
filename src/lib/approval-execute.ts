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

// ============================================================
// 加购配件（ASSET_PURCHASE）：申请加购 → 多级审批 → 终审通过自动入库
// ============================================================

/** 加购申请 payload：必须且只能提供 modelId（选现有型号）或 newModelName（全新，登记新型号），二选一 */
export const purchasePayloadSchema = z
  .object({
    componentCategoryId: z
      .number({ required_error: "配件分类不能为空" })
      .int()
      .positive("配件分类不能为空"),
    modelId: z.number().int().positive().nullable().optional(), // 选现有配件型号
    newModelName: z.string().trim().min(1, "新型号名称不能为空").optional(), // 全新配件型号
    brand: z.string().trim().optional(), // 品牌（仅全新配件登记型号时使用，缺省为空串，与「新建配件型号」一致）
    quantity: z.number({ required_error: "加购数量不能为空" }).int().positive("加购数量必须为正整数"),
    unitPrice: z.number().nonnegative().optional(), // 单价（可空缺）
    reason: z.string().min(1, "申请原由不能为空"),
  })
  .refine((d) => Boolean(d.modelId) !== Boolean(d.newModelName), {
    message: "请选择现有配件型号，或填写全新配件型号（二选一）",
  });

/** 解析加购 payload（兼容历史 JSON 字符串存储），无效返回 null */
function parsePurchasePayload(raw: unknown): z.infer<typeof purchasePayloadSchema> | null {
  let data: unknown = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const parsed = purchasePayloadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** 依据请求单号计算加购单号：PU-YYYYMM-NNNN（同月最大序号 +1） */
async function nextPurchaseNo(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `PU-${ym}-`;
  const last = await tx.purchaseRecord.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const seq = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * 审批通过后系统自动执行「加购入库」（ASSET_PURCHASE）。
 * 单事务内完成：累加配件库存 → 写 PURCHASE_IN 流水 → 登记采购留痕。
 * - 全新型号：自动登记为新型号（ComponentModel）并重建库存。
 * - 幂等：requestId 唯一（PurchaseRecord.requestId）为幂等键，重复执行直接返回，绝不重复入库。
 * - 任何失败抛异常，由调用方（approveTask）记 EXECUTE_FAILED，中断入库阻断审批。
 */
export async function executePurchaseOnApproval(
  tx: Prisma.TransactionClient,
  requestId: number,
  raw: Prisma.JsonValue
): Promise<void> {
  const p = parsePurchasePayload(raw);
  if (!p) throw new Error("申请内容格式错误");

  // 幂等：该单已入库过（留痕 requestId 唯一），直接跳过
  const existing = await tx.purchaseRecord.findUnique({ where: { requestId } });
  if (existing) return;

  const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error("申请单不存在");

  const initiatorId = request.initiatorId;
  const brand = p.brand ?? "";

  // 解析目标型号：全新则登记新型号；已有则取现有
  // 型号唯一约束为「分类 + 型号 + 品牌」，与「新建配件型号」保持一致；同名同品牌直接复用
  let model = p.modelId
    ? await tx.componentModel.findFirst({
        where: { id: p.modelId, categoryId: p.componentCategoryId },
      })
    : await tx.componentModel.findFirst({
        where: { categoryId: p.componentCategoryId, name: p.newModelName!, brand },
      });
  if (!model && p.newModelName) {
    model = await tx.componentModel.create({
      data: { name: p.newModelName!, brand, categoryId: p.componentCategoryId },
    });
  }
  if (!model) throw new Error("所选配件型号不存在");

  // 库存原子累加（不存在则创建），避免并发两单读改写丢失累加
  const stock = await tx.componentStock.findUnique({ where: { modelId: model.id } });
  if (stock) {
    await tx.componentStock.update({
      where: { id: stock.id },
      data: { quantity: { increment: p.quantity } },
    });
  } else {
    await tx.componentStock.create({ data: { modelId: model.id, quantity: p.quantity } });
  }

  // 加购入库流水
  const orderNo = await nextPurchaseNo(tx);
  await tx.componentStockLog.create({
    data: {
      modelId: model.id,
      type: "PURCHASE_IN",
      quantity: p.quantity,
      operator: "系统",
      remark: `加购入库 ${orderNo}（${request.requestNo}）${p.reason ? `：${p.reason}` : ""}`,
    },
  });

  // 采购留痕（requestId 唯一幂等键）
  const unitPrice = p.unitPrice ?? null;
  await tx.purchaseRecord.create({
    data: {
      orderNo,
      requestId,
      modelId: model.id,
      modelName: model.name,
      quantity: p.quantity,
      unitPrice,
      amount: unitPrice != null ? p.unitPrice! * p.quantity : null,
      initiatorId,
    },
  });
}

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

  const asset = await tx.asset.findUnique({
    where: { id: assetId },
    include: { template: { select: { name: true } } },
  });
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
  // 硬不变量：IDLE ⟺ 无归属 ∧ 名称为模板名（归还即回到型号池）
  await tx.asset.update({
    where: { id: assetId },
    data: {
      status: "IDLE",
      employeeId: null,
      name: asset.template.name,
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
