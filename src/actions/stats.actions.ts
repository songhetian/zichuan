"use server";

import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { resolveAssetScope } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";
import type { Prisma } from "@prisma/client";

type AssetStatsResult = {
  total: number;
  byStatus: Record<string, number>;
  byCategory?: { categoryId: number; categoryName: string; count: number }[];
  byDepartment?: { departmentId: number; departmentName: string; count: number }[];
  byEmployee?: { employeeId: number; employeeName: string; departmentName: string; count: number }[];
};

export async function getAssetStats(
  input: { groupBy?: "category" | "department" | "employee" } = {}
): Promise<ActionResult<AssetStatsResult>> {
  const user = await requireAuth();
  // 数据范围过滤（统一口径）：asset.manage 走账号级部门范围；dept.data.view → 本部门；否则仅本人名下
  const scope = await resolveAssetScope(user.id);
  const scoped = (extra: Prisma.AssetWhereInput = {}): Prisma.AssetWhereInput =>
    scope ? { AND: [scope, extra] } : extra;

  const statusGroups = await prisma.asset.groupBy({
    by: ["status"],
    where: scope,
    _count: { id: true },
  });

  const byStatus: Record<string, number> = {
    IDLE: 0,
    IN_USE: 0,
    IN_MAINTENANCE: 0,
    SCRAPPED: 0,
    RESERVED: 0,
  };
  for (const g of statusGroups) {
    byStatus[g.status] = g._count.id;
  }

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const result: AssetStatsResult = { total, byStatus };

  if (input.groupBy === "category") {
    const catGroups = await prisma.asset.findMany({
      where: scope,
      include: {
        template: {
          select: {
            categoryId: true,
            category: { select: { name: true } },
          },
        },
      },
    });

    const catMap = new Map<number, { name: string; count: number }>();
    for (const a of catGroups) {
      const catId = a.template?.categoryId;
      const catName = a.template?.category?.name ?? "未知";
      if (catId != null) {
        const existing = catMap.get(catId) ?? { name: catName, count: 0 };
        existing.count++;
        catMap.set(catId, existing);
      }
    }
    result.byCategory = Array.from(catMap.entries()).map(([id, v]) => ({
      categoryId: id,
      categoryName: v.name,
      count: v.count,
    }));
  }

  if (input.groupBy === "department") {
    const empGroups = await prisma.asset.findMany({
      where: scoped({ employeeId: { not: null } }),
      include: {
        employee: {
          select: {
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const deptMap = new Map<number, { name: string; count: number }>();
    for (const a of empGroups) {
      const deptId = a.employee?.departmentId;
      const deptName = a.employee?.department?.name ?? "未知";
      if (deptId != null) {
        const existing = deptMap.get(deptId) ?? { name: deptName, count: 0 };
        existing.count++;
        deptMap.set(deptId, existing);
      }
    }
    result.byDepartment = Array.from(deptMap.entries()).map(([id, v]) => ({
      departmentId: id,
      departmentName: v.name,
      count: v.count,
    }));
  }

  if (input.groupBy === "employee") {
    const empAssets = await prisma.asset.findMany({
      where: scoped({ employeeId: { not: null } }),
      include: {
        employee: {
          select: {
            id: true,
            name: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    const empMap = new Map<number, { name: string; deptName: string; count: number }>();
    for (const a of empAssets) {
      const empId = a.employeeId!;
      const empName = a.employee?.name ?? "未知";
      const deptName = a.employee?.department?.name ?? "未知";
      const existing = empMap.get(empId) ?? { name: empName, deptName, count: 0 };
      existing.count++;
      empMap.set(empId, existing);
    }
    result.byEmployee = Array.from(empMap.entries()).map(([id, v]) => ({
      employeeId: id,
      employeeName: v.name,
      departmentName: v.deptName,
      count: v.count,
    }));
  }

  return { success: true, data: result };
}

export async function getStockStats(): Promise<
  ActionResult<{
    modelId: number;
    modelName: string;
    brand: string | null;
    categoryName: string;
    quantity: number;
  }[]>
> {
  await requireAuth();

  const stocks = await prisma.componentStock.findMany({
    where: { quantity: { gt: 0 } },
    include: {
      model: {
        include: {
          category: { select: { name: true } },
        },
      },
    },
    orderBy: { quantity: "desc" },
  });

  const data = stocks.map((s) => ({
    modelId: s.modelId,
    modelName: s.model?.name ?? "",
    brand: s.model?.brand ?? null,
    categoryName: s.model?.category?.name ?? "",
    quantity: s.quantity,
  }));

  return { success: true, data };
}

/** 呆滞判定阈值（天）：闲置态超过该时长即视为呆滞资产。 */
const STAGNANT_THRESHOLD_DAYS = 90;

/** 出入库流水对账：按型号汇总流水签量，与实际结存对比，暴露账面与实存差异。 */
export async function getStockReconciliation(): Promise<
  ActionResult<{
    matchedCount: number;
    discrepantCount: number;
    rows: {
      modelId: number;
      modelName: string;
      brand: string;
      categoryName: string;
      stockQuantity: number;
      loggedBalance: number;
      difference: number;
      isBalanced: boolean;
    }[];
  }>
> {
  await requireAuth();

  const stocks = await prisma.componentStock.findMany({
    include: {
      model: {
        include: { category: { select: { name: true } } },
      },
    },
  });
  const logs = await prisma.componentStockLog.groupBy({
    by: ["modelId"],
    _sum: { quantity: true },
  });
  const balanceMap = new Map(logs.map((l) => [l.modelId, l._sum.quantity ?? 0]));

  let matchedCount = 0;
  let discrepantCount = 0;
  const rows = stocks.map((s) => {
    const stockQuantity = s.quantity;
    const loggedBalance = balanceMap.get(s.modelId) ?? 0;
    const isBalanced = stockQuantity === loggedBalance;
    if (isBalanced) matchedCount++;
    else discrepantCount++;
    return {
      modelId: s.modelId,
      modelName: s.model?.name ?? "",
      brand: s.model?.brand ?? "",
      categoryName: s.model?.category?.name ?? "",
      stockQuantity,
      loggedBalance,
      difference: stockQuantity - loggedBalance,
      isBalanced,
    };
  });

  return { success: true, data: { matchedCount, discrepantCount, rows } };
}

/** 分配建议 FIFO：仅返回可分配（闲置）资产，按建档时间先进先出排序。 */
export async function suggestAllocation(input: { categoryId?: number } = {}): Promise<
  ActionResult<{
    total: number;
    rows: {
      id: number;
      assetNo: string;
      name: string;
      status: string;
      createdAt: Date;
      categoryName: string;
    }[];
  }>
> {
  const user = await requireAuth();
  // 数据范围过滤（统一口径）：与设备列表一致
  const scope = await resolveAssetScope(user.id);

  const assets = await prisma.asset.findMany({
    where: {
      status: "IDLE",
      ...(scope ?? {}),
      template: input.categoryId ? { categoryId: input.categoryId } : undefined,
    },
    select: {
      id: true,
      assetNo: true,
      name: true,
      status: true,
      createdAt: true,
      template: { select: { category: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" }, // FIFO：先建档优先
  });

  const rows = assets.map((a) => ({
    id: a.id,
    assetNo: a.assetNo,
    name: a.name,
    status: a.status,
    createdAt: a.createdAt,
    categoryName: a.template?.category?.name ?? "",
  }));

  return { success: true, data: { total: rows.length, rows } };
}

/** 库龄/呆滞统计：库龄按建档日期计；呆滞仅对当前闲置态设备，按最近活动（无则建档）距今天数判定。 */
export async function getAssetAgeStats(
  input: { thresholdDays?: number } = {}
): Promise<
  ActionResult<{
    thresholdDays: number;
    total: number;
    stagnantCount: number;
    rows: {
      id: number;
      assetNo: string;
      name: string;
      status: string;
      ageDays: number;
      idleDays: number | null;
      isStagnant: boolean;
      categoryName: string;
    }[];
  }>
> {
  const user = await requireAuth();
  // 数据范围过滤（统一口径）：与设备列表一致
  const scope = await resolveAssetScope(user.id);
  const assets = await prisma.asset.findMany({
    where: scope,
    select: {
      id: true,
      assetNo: true,
      name: true,
      status: true,
      createdAt: true,
      template: { select: { category: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 每台设备最近一次生命周期动作时间（无动作则没有记录）
  const lastEvents = await prisma.lifecycleLog.groupBy({
    by: ["assetId"],
    _max: { createdAt: true },
  });
  const lastEventMap = new Map(lastEvents.map((e) => [e.assetId, e._max.createdAt]));

  const DAY = 86400000;
  const now = Date.now();
  const thresholdDays = input.thresholdDays ?? STAGNANT_THRESHOLD_DAYS;

  let stagnantCount = 0;
  const rows = assets.map((a) => {
    const ageDays = Math.floor((now - a.createdAt.getTime()) / DAY);

    // 只有闲置态才有「闲置天数」：呆滞基线 = 最近活动时间，无活动则用建档日
    // 非闲置设备（在用/维修中/报废）不计呆滞，idleDays 为 null
    const baseline = lastEventMap.get(a.id) ?? a.createdAt;
    const idleDays = a.status === "IDLE" ? Math.floor((now - baseline.getTime()) / DAY) : null;
    const isStagnant = idleDays != null && idleDays >= thresholdDays;
    if (isStagnant) stagnantCount++;

    return {
      id: a.id,
      assetNo: a.assetNo,
      name: a.name,
      status: a.status,
      ageDays,
      idleDays,
      isStagnant,
      categoryName: a.template?.category?.name ?? "",
    };
  });

  return { success: true, data: { thresholdDays, total: rows.length, stagnantCount, rows } };
}

export async function getLifecycleTrend(
  input: { months?: number } = {}
): Promise<
  ActionResult<{
    month: string;
    allocated: number;
    returned: number;
    transferred: number;
    scrapped: number;
  }[]>
> {
  const user = await requireAuth();

  const months = input.months ?? 6;
  const now = new Date();
  // 以「当月 1 日」为基准回退：若以今天为基准 setMonth，当天为 29–31 日时会月份溢出，
  // 导致起始月偏移、月份桶 key 重复甚至少一个桶。
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1, 0, 0, 0, 0);

  // 数据范围过滤（统一口径）：仅统计可见资产的流水
  const scope = await resolveAssetScope(user.id);
  const logs = await prisma.lifecycleLog.findMany({
    where: { createdAt: { gte: startDate }, ...(scope ? { asset: scope } : {}) },
    select: { action: true, createdAt: true },
  });

  const monthMap = new Map<string, { allocated: number; returned: number; transferred: number; scrapped: number }>();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { allocated: 0, returned: 0, transferred: 0, scrapped: 0 });
  }

  for (const log of logs) {
    const d = log.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthMap.get(key);
    if (entry) {
      switch (log.action) {
        case "ALLOCATED": entry.allocated++; break;
        case "RETURNED": entry.returned++; break;
        case "TRANSFERRED": entry.transferred++; break;
        case "SCRAPPED": entry.scrapped++; break;
      }
    }
  }

  const data = Array.from(monthMap.entries()).map(([month, counts]) => ({
    month,
    ...counts,
  }));

  return { success: true, data };
}
