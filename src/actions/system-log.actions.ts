"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

const createSchema = z.object({
  module: z.string().min(1),
  action: z.string().min(1),
  detail: z.string(),
  operator: z.string().min(1),
});

const querySchema = z.object({
  module: z.string().optional(),
  operator: z.string().optional(),
  keyword: z.string().optional(),
});

export async function createSystemLog(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<{ id: number }>> {
  await requireAuth();

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const log = await prisma.systemLog.create({
    data: validated.data,
  });

  return { success: true, data: { id: log.id } };
}

export async function getSystemLogs(
  input: z.infer<typeof querySchema> = {}
): Promise<
  ActionResult<{
    id: number;
    module: string;
    action: string;
    detail: string;
    operator: string;
    createdAt: Date;
    /** 从详情文本中还原出的设备编号（SystemLog 无设备关联字段，故按编号文本比对） */
    assetNo: string | null;
  }[]>
> {
  await requireAuth();

  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { module, operator, keyword } = validated.data;

  const where: Record<string, unknown> = {};
  if (module) where.module = module;
  if (operator) where.operator = operator;
  if (keyword) {
    where.detail = { contains: keyword };
  }

  const logs = await prisma.systemLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  // 提取疑似设备编号（形如 DN-0001 / DT-7KF3WX），再用数据库确认，避免把
  // 型号名（如 DDR4-3200）误当成设备编号。
  const candidates = new Set<string>();
  for (const log of logs) {
    for (const token of extractAssetNoCandidates(log.detail)) candidates.add(token);
  }
  const validAssetNos = new Set<string>();
  if (candidates.size > 0) {
    const found = await prisma.asset.findMany({
      where: { assetNo: { in: [...candidates] } },
      select: { assetNo: true },
    });
    for (const a of found) validAssetNos.add(a.assetNo);
  }

  const data = logs.map((log) => {
    const hits = extractAssetNoCandidates(log.detail).filter((t) =>
      validAssetNos.has(t)
    );
    const unique = [...new Set(hits)];
    return {
      ...log,
      assetNo: unique.length > 0 ? unique.join("、") : null,
    };
  });

  return { success: true, data };
}

/** 匹配「前缀-编号」形态的候选串；真实设备编号由数据库二次校验 */
function extractAssetNoCandidates(detail: string): string[] {
  return detail.match(/\b[A-Z][A-Z0-9]{0,9}-[A-Z0-9]{2,10}\b/g) ?? [];
}
