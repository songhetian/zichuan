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
    remark: string | null;
    createdAt: Date;
    /** 分配/归还/调拨涉及的人员姓名（由 employeeId 反查得到，schema 中无关联关系） */
    employeeName: string | null;
    /** 调拨转出方姓名（由 fromEmployeeId 反查得到） */
    fromEmployeeName: string | null;
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

  let result = logs.map((log) => ({
    id: log.id,
    action: log.action,
    assetNo: log.asset?.assetNo ?? null,
    operator: log.operator,
    remark: log.remark,
    createdAt: log.createdAt,
    employeeId: log.employeeId,
    fromEmployeeId: log.fromEmployeeId,
  }));

  // 反查姓名：employeeId / fromEmployeeId 在 schema 里没有关联关系，只能按 id 批量回查
  const employeeIds = new Set<number>();
  for (const log of result) {
    if (log.employeeId != null) employeeIds.add(log.employeeId);
    if (log.fromEmployeeId != null) employeeIds.add(log.fromEmployeeId);
  }
  const nameMap = new Map<number, string>();
  if (employeeIds.size > 0) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: [...employeeIds] } },
      select: { id: true, name: true },
    });
    for (const e of emps) nameMap.set(e.id, e.name);
  }

  let withNames = result.map(({ employeeId, fromEmployeeId, ...rest }) => ({
    ...rest,
    employeeName: employeeId != null ? nameMap.get(employeeId) ?? null : null,
    fromEmployeeName:
      fromEmployeeId != null ? nameMap.get(fromEmployeeId) ?? null : null,
  }));

  if (keyword) {
    const lower = keyword.toLowerCase();
    withNames = withNames.filter(
      (log) =>
        log.action.toLowerCase().includes(lower) ||
        (log.assetNo?.toLowerCase() ?? "").includes(lower) ||
        log.operator.toLowerCase().includes(lower) ||
        (log.remark?.toLowerCase() ?? "").includes(lower) ||
        (log.employeeName?.toLowerCase() ?? "").includes(lower) ||
        (log.fromEmployeeName?.toLowerCase() ?? "").includes(lower)
    );
  }

  return { success: true, data: withNames };
}