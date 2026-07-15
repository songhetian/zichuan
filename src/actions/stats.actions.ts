"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ActionResult } from "@/lib/types";

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
  const statusGroups = await prisma.asset.groupBy({
    by: ["status"],
    _count: { id: true },
  });

  const byStatus: Record<string, number> = {
    IDLE: 0,
    IN_USE: 0,
    IN_MAINTENANCE: 0,
    SCRAPPED: 0,
  };
  for (const g of statusGroups) {
    byStatus[g.status] = g._count.id;
  }

  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const result: AssetStatsResult = { total, byStatus };

  if (input.groupBy === "category") {
    const catGroups = await prisma.asset.findMany({
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
      where: { employeeId: { not: null } },
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
      where: { employeeId: { not: null } },
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
  const months = input.months ?? 6;
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months + 1);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const logs = await prisma.lifecycleLog.findMany({
    where: { createdAt: { gte: startDate } },
    select: { action: true, createdAt: true },
  });

  const monthMap = new Map<string, { allocated: number; returned: number; transferred: number; scrapped: number }>();

  for (let i = 0; i < months; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - months + 1 + i);
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
