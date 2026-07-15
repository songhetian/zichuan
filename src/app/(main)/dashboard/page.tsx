import { prisma } from "@/lib/prisma";
import { DashboardClient } from "./dashboard-client";
import { getStockStats, getLifecycleTrend } from "@/actions/stats.actions";

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
    stockResult,
    trendResult,
  ] = await Promise.all([
    // 获取设备统计数据
    prisma.asset.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    // 获取分类分布
    prisma.asset.findMany({
      include: {
        template: {
          select: {
            categoryId: true,
            category: { select: { name: true } },
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
    // 配件库存统计
    getStockStats(),
    // 生命周期趋势
    getLifecycleTrend({ months: 6 }),
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

  const catMap = new Map<number, { name: string; count: number }>();
  for (const a of assetsWithCategory) {
    const catId = a.template?.categoryId;
    const catName = a.template?.category?.name ?? "未知";
    if (catId != null) {
      const existing = catMap.get(catId) ?? { name: catName, count: 0 };
      existing.count++;
      catMap.set(catId, existing);
    }
  }
  const byCategory = Array.from(catMap.entries()).map(([id, v]) => ({
    categoryId: id,
    categoryName: v.name,
    count: v.count,
  }));

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
        byCategory,
        lowStockItems: lowStockItems.map((s) => ({
          modelId: s.modelId,
          modelName: s.model?.name ?? "",
          quantity: s.quantity,
        })),
        recentLogs: recentLogs.map((log) => ({
          id: log.id,
          action: log.action,
          assetNo: log.asset?.assetNo ?? "",
          operator: log.operator,
          createdAt: log.createdAt,
        })),
        pendingTasks,
        stockStats: stockResult.success ? stockResult.data : [],
        trendData: trendResult.success ? trendResult.data : [],
      }}
    />
  );
}