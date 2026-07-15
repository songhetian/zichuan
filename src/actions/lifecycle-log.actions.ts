"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  action: z.string().optional(),
  operator: z.string().optional(),
  keyword: z.string().optional(),
});

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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
  }[]>
> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { action, operator, keyword } = validated.data;

  const where: any = {};
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
  }));

  if (keyword) {
    const lower = keyword.toLowerCase();
    result = result.filter(
      (log) =>
        log.action.toLowerCase().includes(lower) ||
        (log.assetNo?.toLowerCase() ?? "").includes(lower) ||
        log.operator.toLowerCase().includes(lower) ||
        (log.remark?.toLowerCase() ?? "").includes(lower)
    );
  }

  return { success: true, data: result };
}