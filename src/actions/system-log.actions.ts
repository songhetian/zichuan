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
  requireAuth();
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
  }[]>
> {
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

  return { success: true, data: logs };
}
