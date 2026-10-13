"use server";

import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";

const querySchema = z.object({
  action: z.string().optional(),
  operator: z.string().optional(),
  keyword: z.string().optional(),
});

export async function getLifecycleLogs(
  input: z.infer<typeof querySchema> = {}
): Promise<
  ActionResult<{
    id: number;
    action: string;
    assetNo: string | null;
    operator: string;
    employeeName: string | null;
    remark: string | null;
    createdAt: Date;
  }[]>
> {
  await requireAuth();

  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { action, operator, keyword } = validated.data;

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (operator) where.operator = operator;

  const logs = await prisma.lifecycleLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      asset: { select: { assetNo: true } },
    },
  });

  // 批量补全相关人员姓名（LifecycleLog.employeeId 为标量，无关联）
  const empIds = new Set<number>();
  for (const log of logs) {
    if (log.employeeId) empIds.add(log.employeeId);
  }
  const empRows = empIds.size
    ? await prisma.employee.findMany({
        where: { id: { in: [...empIds] } },
        select: { id: true, name: true },
      })
    : [];
  const empMap = new Map(empRows.map((e) => [e.id, e.name]));

  let result = logs.map((log) => ({
    id: log.id,
    action: log.action,
    assetNo: log.asset?.assetNo ?? null,
    operator: log.operator,
    employeeName: log.employeeId ? (empMap.get(log.employeeId) ?? null) : null,
    remark: log.remark,
    createdAt: log.createdAt,
  }));

  if (keyword) {
    const lower = keyword.toLowerCase();
    result = result.filter(
      (log) =>
        log.action.toLowerCase().includes(lower) ||
        (log.assetNo?.toLowerCase() ?? "").includes(lower) ||
        log.operator.toLowerCase().includes(lower) ||
        (log.employeeName?.toLowerCase() ?? "").includes(lower) ||
        (log.remark?.toLowerCase() ?? "").includes(lower)
    );
  }

  return { success: true, data: result };
}