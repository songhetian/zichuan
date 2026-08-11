export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import { DashboardClient } from "./dashboard-client";
import { buildCategoryByDepartmentData } from "@/lib/category-by-department";

export default async function DashboardPage() {
  // 并行执行所有独立查询，避免串行等待
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const [
    statusGroups,
    assetsWithCategory,
    lowStockItems,
    recentLogs,
    allAssetsWithWarranty,
  ] = await Promise.all([
    // 获取设备统计数据
    prisma.asset.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    // 获取分类分布 + 部门维度（用于「部门 × 分类」堆叠柱状图）
    prisma.asset.findMany({
      include: {
        template: {
          select: {
            categoryId: true,
            category: { select: { name: true } },
          },
        },
        employee: {
          select: {
            department: { select: { name: true } },
          },
        },
      },
    }),
    // 获取低库存配件（库存 < 5）
    prisma.componentStock.findMany({
      where: { quantity: { lt: 5 } },
      include: {
        model: { select: { name: true } },
      },
      take: 5,
    }),
    // 获取最近操作记录
    prisma.lifecycleLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        asset: { select: { assetNo: true } },
      },
    }),
    // 保修即将到期设备（30天内）
    prisma.asset.findMany({
      where: {
        purchaseDate: { not: null },
        warrantyMonths: { not: null },
        status: { in: ["IDLE", "IN_USE"] },
      },
      select: {
        purchaseDate: true,
        warrantyMonths: true,
      },
    }),
  ]);

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

  // 「部门 × 分类」设备分布（供堆叠柱状图）
  const categoryByDepartment = buildCategoryByDepartmentData(
    assetsWithCategory.map((a) => ({
      categoryName: a.template?.category?.name ?? null,
      departmentName: a.employee?.department?.name ?? null,
    }))
  );

  // 构建待办任务
  const pendingTasks: {
    type: "allocate" | "maintenance" | "low_stock" | "warranty";
    title: string;
    description: string;
    count?: number;
  }[] = [];

  if (byStatus.IDLE > 0) {
    pendingTasks.push({
      type: "allocate",
      title: "待分配设备",
      description: "有闲置设备待分配给员工",
      count: byStatus.IDLE,
    });
  }

  if (byStatus.IN_MAINTENANCE > 0) {
    pendingTasks.push({
      type: "maintenance",
      title: "维修中设备",
      description: "有设备正在维修中",
      count: byStatus.IN_MAINTENANCE,
    });
  }

  if (lowStockItems.length > 0) {
    pendingTasks.push({
      type: "low_stock",
      title: "库存不足配件",
      description: `有 ${lowStockItems.length} 种配件库存不足 5 件`,
      count: lowStockItems.length,
    });
  }

  let expiringSoonCount = 0;
  for (const asset of allAssetsWithWarranty) {
    if (asset.purchaseDate && asset.warrantyMonths) {
      const warrantyEndDate = new Date(asset.purchaseDate);
      warrantyEndDate.setMonth(warrantyEndDate.getMonth() + asset.warrantyMonths);
      if (warrantyEndDate <= thirtyDaysFromNow && warrantyEndDate >= new Date()) {
        expiringSoonCount++;
      }
    }
  }

  if (expiringSoonCount > 0) {
    pendingTasks.push({
      type: "warranty",
      title: "保修即将到期",
      description: "有设备保修期将在30天内到期",
      count: expiringSoonCount,
    });
  }

  return (
    <DashboardClient
      data={{
        total,
        byStatus,
        categoryByDepartment,
        recentLogs: recentLogs.map((log) => ({
          id: log.id,
          action: log.action,
          assetNo: log.asset?.assetNo ?? "",
          operator: log.operator,
          createdAt: log.createdAt,
        })),
        pendingTasks,
      }}
    />
  );
}