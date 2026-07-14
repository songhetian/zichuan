"use client";

import ReactECharts from "echarts-for-react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Monitor, Package, Wrench, Trash2, Users } from "lucide-react";

interface AssetStats {
  total: number;
  byStatus: Record<string, number>;
  byCategory?: { categoryId: number; categoryName: string; count: number }[];
}

interface StockStat {
  modelId: number;
  modelName: string;
  brand: string | null;
  categoryName: string;
  quantity: number;
}

interface TrendData {
  month: string;
  allocated: number;
  returned: number;
  transferred: number;
  scrapped: number;
}

interface StatsClientProps {
  assetStats: AssetStats | null;
  stockStats: StockStat[];
  trendData: TrendData[];
}

const STATUS_LABEL_MAP: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
};

const STATUS_COLOR_MAP: Record<string, string> = {
  IDLE: "#94a3b8",
  IN_USE: "#22c55e",
  IN_MAINTENANCE: "#eab308",
  SCRAPPED: "#ef4444",
};

function NoData() {
  return (
    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
      暂无数据
    </div>
  );
}

function PieChart({ assetStats }: { assetStats: AssetStats | null }) {
  if (!assetStats) return <NoData />;

  const data = Object.entries(assetStats.byStatus)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: STATUS_LABEL_MAP[key] ?? key,
      value,
      itemStyle: { color: STATUS_COLOR_MAP[key] ?? "#3b82f6" },
    }));

  if (data.length === 0) return <NoData />;

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} ({d}%)",
    },
    legend: {
      bottom: "0%",
      left: "center",
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: "#fff",
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: "{b}\n{c} ({d}%)",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: "bold",
          },
        },
        data,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

function LineChart({ trendData }: { trendData: TrendData[] }) {
  if (trendData.length === 0) return <NoData />;

  const months = trendData.map((d) => d.month);

  const option = {
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: ["分配", "归还", "调拨", "报废"],
      bottom: "0%",
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: months,
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "分配",
        type: "line",
        smooth: true,
        data: trendData.map((d) => d.allocated),
        itemStyle: { color: "#3b82f6" },
      },
      {
        name: "归还",
        type: "line",
        smooth: true,
        data: trendData.map((d) => d.returned),
        itemStyle: { color: "#22c55e" },
      },
      {
        name: "调拨",
        type: "line",
        smooth: true,
        data: trendData.map((d) => d.transferred),
        itemStyle: { color: "#f59e0b" },
      },
      {
        name: "报废",
        type: "line",
        smooth: true,
        data: trendData.map((d) => d.scrapped),
        itemStyle: { color: "#ef4444" },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

function BarChart({ assetStats }: { assetStats: AssetStats | null }) {
  const categories = assetStats?.byCategory ?? [];
  if (categories.length === 0) return <NoData />;

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: categories.map((c) => c.categoryName),
      axisLabel: {
        interval: 0,
        rotate: categories.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        type: "bar",
        data: categories.map((c) => c.count),
        itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

function StockBarChart({ stockStats }: { stockStats: StockStat[] }) {
  if (stockStats.length === 0) return <NoData />;

  const sorted = [...stockStats]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 15);

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "value",
    },
    yAxis: {
      type: "category",
      data: sorted.map((s) => s.modelName).reverse(),
      axisLabel: {
        interval: 0,
      },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((s) => s.quantity).reverse(),
        itemStyle: { color: "#3b82f6", borderRadius: [0, 4, 4, 0] },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
}

export function StatsClient({ assetStats, stockStats, trendData }: StatsClientProps) {
  const statusCards = [
    { label: "总设备数", value: assetStats?.total ?? 0, icon: Monitor, color: "text-blue-600 bg-blue-100" },
    { label: "闲置", value: assetStats?.byStatus["IDLE"] ?? 0, icon: Package, color: "text-slate-600 bg-slate-100" },
    { label: "在用", value: assetStats?.byStatus["IN_USE"] ?? 0, icon: Users, color: "text-green-600 bg-green-100" },
    { label: "维修中", value: assetStats?.byStatus["IN_MAINTENANCE"] ?? 0, icon: Wrench, color: "text-yellow-600 bg-yellow-100" },
    { label: "报废", value: assetStats?.byStatus["SCRAPPED"] ?? 0, icon: Trash2, color: "text-red-600 bg-red-100" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="统计报表"
        description="设备资产统计与数据分析"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {statusCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{card.value}</p>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>设备状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart assetStats={assetStats} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>生命周期趋势（近6个月）</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart trendData={trendData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>分类统计</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart assetStats={assetStats} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>配件库存概览</CardTitle>
          </CardHeader>
          <CardContent>
            <StockBarChart stockStats={stockStats} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
