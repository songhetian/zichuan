"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AssetStatus, StocktakeResult } from "@prisma/client";

const createSchema = z.object({
  name: z.string().min(1, "盘点名称不能为空"),
  description: z.string().optional(),
  statusFilter: z.enum(["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED"]).optional(),
  categoryId: z.number().optional(),
  departmentId: z.number().optional(),
  operator: z.string().min(1),
});

const updateRecordSchema = z.object({
  actualStatus: z.enum(["NORMAL", "MISSING", "EXTRA"]),
  remark: z.string().optional(),
});

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function createStocktakeSession(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number; name: string; description: string | null; status: string }>> {
  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const { name, description, statusFilter, categoryId, departmentId, operator } = validated.data;

  const where: any = {};
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
      expectedStatus: string;
      actualStatus: string;
      remark: string | null;
    }[];
  }>
> {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id },
  });
  if (!session) {
    return { success: false, error: "盘点任务不存在" };
  }

  const records = await prisma.stocktakeRecord.findMany({
    where: { sessionId: id },
    include: { asset: { select: { assetNo: true } } },
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
