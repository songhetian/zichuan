"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AssetStatus, StocktakeResult } from "@prisma/client";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { parseStocktakeExcel, normalizeResult, buildStocktakeAbnormalExcel, StocktakeAbnormalRow } from "@/lib/stocktake-excel";

const createSchema = z.object({
  name: z.string().min(1, "盘点名称不能为空"),
  description: z.string().optional(),
  statusFilter: z.enum(["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED"], {
    message: "状态筛选不合法",
  }).optional(),
  categoryId: z.number().optional(),
  departmentId: z.number().optional(),
  operator: z.string().min(1),
});

const updateRecordSchema = z.object({
  actualStatus: z.enum(["NORMAL", "MISSING", "EXTRA"], {
    message: "盘点结果状态不合法",
  }),
  remark: z.string().optional(),
});

export async function createStocktakeSession(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string; description: string | null; status: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, description, statusFilter, categoryId, departmentId, operator } = validated.data;

  const where: Record<string, unknown> = {};
  if (statusFilter) where.status = statusFilter;

  if (categoryId) {
    where.template = { categoryId };
  }

  if (departmentId) {
    where.employee = { departmentId };
  }

  const assets = await prisma.asset.findMany({
    where,
    select: { id: true, status: true },
  });

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.stocktakeSession.create({
      data: { name, description: description ?? null },
    });

    if (assets.length > 0) {
      await tx.stocktakeRecord.createMany({
        data: assets.map((a) => ({
          sessionId: created.id,
          assetId: a.id,
          expectedStatus: a.status as AssetStatus,
          actualStatus: "NORMAL" as StocktakeResult,
        })),
      });
    }

    return created;
  });

  return {
    success: true,
    data: {
      id: session.id,
      name: session.name,
      description: session.description,
      status: session.status,
    },
  };
}

export async function getStocktakeSessions(): Promise<
  ActionResult<{ id: number; name: string; description: string | null; status: string; startedAt: Date; completedAt: Date | null }[]>
> {
  await requireAuth();

  const sessions = await prisma.stocktakeSession.findMany({
    orderBy: { id: "desc" },
  });
  return { success: true, data: sessions };
}

export async function getStocktakeSessionById(
  id: number
): Promise<
  ActionResult<{
    id: number;
    name: string;
    description: string | null;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    records: {
      id: number;
      assetId: number;
      assetNo: string;
      assetName: string;
      expectedStatus: string;
      actualStatus: string;
      remark: string | null;
    }[];
  }>
> {
  await requireAuth();

  const session = await prisma.stocktakeSession.findUnique({
    where: { id },
  });
  if (!session) {
    return { success: false, error: "盘点任务不存在" };
  }

  const records = await prisma.stocktakeRecord.findMany({
    where: { sessionId: id },
    include: { asset: { select: { assetNo: true, name: true } } },
    orderBy: { assetId: "asc" },
  });

  return {
    success: true,
    data: {
      id: session.id,
      name: session.name,
      description: session.description,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      records: records.map((r) => ({
        id: r.id,
        assetId: r.assetId,
        assetNo: r.asset.assetNo,
        assetName: r.asset.name,
        expectedStatus: r.expectedStatus,
        actualStatus: r.actualStatus,
        remark: r.remark,
      })),
    },
  };
}

export async function updateStocktakeRecord(
  recordId: number,
  input: z.infer<typeof updateRecordSchema>
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const validated = updateRecordSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const record = await prisma.stocktakeRecord.findUnique({ where: { id: recordId } });
  if (!record) {
    return { success: false, error: "盘点记录不存在" };
  }

  const session = await prisma.stocktakeSession.findUnique({
    where: { id: record.sessionId },
  });
  if (!session || session.status === "COMPLETED") {
    return { success: false, error: "盘点任务已完成，无法修改" };
  }

  await prisma.stocktakeRecord.update({
    where: { id: recordId },
    data: {
      actualStatus: validated.data.actualStatus,
      remark: validated.data.remark ?? null,
    },
  });

  return { success: true, data: { id: recordId } };
}

export async function completeStocktakeSession(
  sessionId: number
): Promise<ActionResult<{ id: number; normal: number; missing: number; extra: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    return { success: false, error: "盘点任务不存在" };
  }
  if (session.status === "COMPLETED") {
    return { success: false, error: "盘点任务已完成" };
  }

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  const records = await prisma.stocktakeRecord.findMany({
    where: { sessionId },
  });

  return {
    success: true,
    data: {
      id: sessionId,
      normal: records.filter((r) => r.actualStatus === "NORMAL").length,
      missing: records.filter((r) => r.actualStatus === "MISSING").length,
      extra: records.filter((r) => r.actualStatus === "EXTRA").length,
    },
  };
}

// ============================================================
// Excel 盘点对账（Seam1 importStocktakeRows / Seam3 importStocktakeFile）
// ============================================================

/** 导入行：assetNo；result 为中文或枚举（内部经 normalizeResult 归一化）；remark 可选 */
export interface StocktakeImportRow {
  assetNo: string;
  result: string;
  remark?: string;
}

/**
 * 核心对账逻辑：按 assetNo 匹配任务内记录。
 * - 匹配且 result ≠ NORMAL 或有备注 → 更新 actualStatus + remark，计入 updated
 * - 匹配且 NORMAL 无备注 → 无变更
 * - 表里有但任务里没有的编号 → 计入 unknown（不建记录，仅报告）
 */
export async function importStocktakeRows(
  sessionId: number,
  rows: StocktakeImportRow[]
): Promise<ActionResult<{ updated: number; unknown: string[] }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    return { success: false, error: "盘点任务不存在" };
  }
  if (session.status === "COMPLETED") {
    return { success: false, error: "盘点任务已完成" };
  }

  const records = await prisma.stocktakeRecord.findMany({
    where: { sessionId },
    include: { asset: { select: { assetNo: true } } },
  });
  const byAssetNo = new Map<string, number>(); // assetNo -> record.id
  for (const r of records) byAssetNo.set(r.asset.assetNo, r.id);

  let updated = 0;
  const unknown: string[] = [];
  const ops: Promise<unknown>[] = [];

  for (const row of rows) {
    const recordId = byAssetNo.get(row.assetNo);
    if (!recordId) {
      unknown.push(row.assetNo);
      continue;
    }
    // 归一化结果值：非 MISSING/EXTRA 一律按 NORMAL（无变更）处理
    const norm = normalizeResult(row.result);
    const result: StocktakeResult = norm === "MISSING" || norm === "EXTRA" ? (norm as StocktakeResult) : "NORMAL";
    const hasRemark = !!(row.remark && row.remark.trim());
    if (result !== "NORMAL" || hasRemark) {
      ops.push(
        prisma.stocktakeRecord.update({
          where: { id: recordId },
          data: { actualStatus: result, remark: hasRemark ? row.remark!.trim() : null },
        })
      );
      updated++;
    }
  }

  await Promise.all(ops);
  return { success: true, data: { updated, unknown } };
}

/** 组合 action：解析上传 Excel 字节 → 对账，返回 updated / unknown / 解析行数 */
export async function importStocktakeFile(
  sessionId: number,
  uploadBuffer: ArrayBuffer | Uint8Array
): Promise<ActionResult<{ updated: number; unknown: string[]; rows: number }>> {
  const bytes =
    uploadBuffer instanceof ArrayBuffer ? new Uint8Array(uploadBuffer) : uploadBuffer;
  const buffer = Buffer.from(bytes as Uint8Array);
  const parsed = parseStocktakeExcel(buffer);
  const res = await importStocktakeRows(sessionId, parsed);
  if (!res.success) return res;
  return { success: true, data: { ...res.data, rows: parsed.length } };
}

/**
 * 导出异常报告：把任务内「异常记录」生成 xlsx 并返回 base64。
 * 异常记录 = actualStatus 为 MISSING/盘亏、EXTRA/盘盈，或带 remark 备注（与对账判定一致）。
 * 返回 base64 便于 server action 序列化，前端转 Blob 触发下载。
 */
export async function exportStocktakeAbnormal(
  sessionId: number,
  selectedFields?: (keyof StocktakeAbnormalRow)[]
): Promise<ActionResult<{ base64: string }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    return { success: false, error: "盘点任务不存在" };
  }

  const records = await prisma.stocktakeRecord.findMany({
    where: { sessionId },
    include: { asset: { select: { assetNo: true, name: true } } },
    orderBy: { assetId: "asc" },
  });

  const abnormal = records
    .filter((r) => r.actualStatus !== "NORMAL" || !!r.remark)
    .map((r) => ({
      assetNo: r.asset.assetNo,
      assetName: r.asset.name,
      expectedStatus: r.expectedStatus,
      actualStatus: r.actualStatus,
      remark: r.remark,
    }));

  const buffer = buildStocktakeAbnormalExcel(
    abnormal,
    selectedFields?.length ? selectedFields : undefined
  );
  return { success: true, data: { base64: buffer.toString("base64") } };
}
