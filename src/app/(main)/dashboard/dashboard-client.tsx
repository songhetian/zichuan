"use client";

import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, AlertCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DashboardData {
  total: number;
  byStatus: Record<string, number>;
  byCategory: { categoryId: number; categoryName: string; count: number }[];
  lowStockItems: { modelId: number; modelName: string; quantity: number }[];
  recentLogs: {
    id: number;
    action: string;
    assetNo: string;
    operator: string;
    createdAt: Date;
  }[];
  pendingTasks: {
    type: "allocate" | "maintenance" | "low_stock" | "warranty";
    title: string;
    description: string;
    count?: number;
  }[];
  stockStats: { modelId: number; modelName: string; brand: string | null; categoryName: string; quantity: number }[];
  trendData: { month: string; allocated: number; returned: number; transferred: number; scrapped: number }[];
}

interface DashboardClientProps {
  data: DashboardData;
}

const STATUS_LABEL_MAP: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
};

const STATUS_COLOR_MAP: Record<string, string> = {
  IDLE: "#78716c",
  IN_USE: "#0d9488",
  IN_MAINTENANCE: "#d97706",
  SCRAPPED: "#dc2626",
};

// 卡片左侧竖条颜色（Tailwind 类名）
const CARD_BAR_CLASS: Record<string, string> = {
  all: "bg-foreground",
  IDLE: "bg-muted-foreground",
  IN_USE: "bg-primary",
  IN_MAINTENANCE: "bg-amber-500",
  SCRAPPED: "bg-red-500",
};

const ACTION_LABEL_MAP: Record<string, string> = {
  CREATED: "创建",
  ALLOCATED: "分配",
  RETURNED: "归还",
  TRANSFERRED: "调拨",
  UPGRADED: "升级",
  SCRAPPED: "报废",
  MAINTENANCE_START: "送修",
  MAINTENANCE_DONE: "维修完成",
};

function PieChart({ data }: { data: DashboardData }) {
  const chartData = Object.entries(data.byStatus)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: STATUS_LABEL_MAP[key] ?? key,
      value,
      itemStyle: { color: STATUS_COLOR_MAP[key] ?? "#3b82f6" },
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} ({d}%)",
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: { color: "#1f2937" },
      padding: [12, 16],
      borderRadius: 8,
    },
    legend: {
      bottom: "0%",
      left: "center",
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 16,
      textStyle: { color: "#6b7280", fontSize: 12 },
    },
    series: [
      {
        type: "pie",
        radius: ["45%", "75%"],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 12,
          borderColor: "#fff",
          borderWidth: 3,
        },
        label: {
          show: true,
          formatter: "{b}\n{c} ({d}%)",
          fontSize: 12,
          color: "#4b5563",
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: "bold",
            color: "#1f2937",
          },
          itemStyle: {
            shadowBlur: 20,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.2)",
          },
        },
        data: chartData,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 250 }} />;
}

function BarChart({ data }: { data: DashboardData }) {
  if (data.byCategory.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  const option = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: { color: "#1f2937" },
      padding: [12, 16],
      borderRadius: 8,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: data.byCategory.map((c) => c.categoryName),
      axisLabel: {
        interval: 0,
        rotate: data.byCategory.length > 5 ? 30 : 0,
        color: "#6b7280",
        fontSize: 11,
      },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#6b7280", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    series: [
      {
        type: "bar",
        data: data.byCategory.map((c) => c.count),
        itemStyle: {
          color: "#0d9488",
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: "45%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 250 }} />;
}

function TrendLineChart({ trendData }: { trendData: DashboardData["trendData"] }) {
  if (trendData.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  const option = {
    tooltip: { 
      trigger: "axis",
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: { color: "#1f2937" },
      padding: [12, 16],
      borderRadius: 8,
    },
    legend: {
      data: ["分配", "归还", "调拨", "报废"],
      bottom: "0%",
      itemWidth: 12,
      itemHeight: 6,
      itemGap: 16,
      textStyle: { color: "#6b7280", fontSize: 11 },
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "15%",
      top: "10%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trendData.map((d) => d.month),
      axisLabel: { color: "#6b7280", fontSize: 11 },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      axisTick: { show: false },
    },
    yAxis: { 
      type: "value",
      axisLabel: { color: "#6b7280", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    series: [
      { 
        name: "分配", 
        type: "line", 
        smooth: true, 
        data: trendData.map((d) => d.allocated), 
        itemStyle: { color: "#0d9488" },
        lineStyle: { width: 2 },
        symbol: "circle",
        symbolSize: 5,
      },
      { 
        name: "归还", 
        type: "line", 
        smooth: true, 
        data: trendData.map((d) => d.returned), 
        itemStyle: { color: "#78716c" },
        lineStyle: { width: 2 },
        symbol: "circle",
        symbolSize: 5,
      },
      { 
        name: "调拨", 
        type: "line", 
        smooth: true, 
        data: trendData.map((d) => d.transferred), 
        itemStyle: { color: "#d97706" },
        lineStyle: { width: 2 },
        symbol: "circle",
        symbolSize: 5,
      },
      { 
        name: "报废", 
        type: "line", 
        smooth: true, 
        data: trendData.map((d) => d.scrapped), 
        itemStyle: { color: "#dc2626" },
        lineStyle: { width: 2 },
        symbol: "circle",
        symbolSize: 5,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 250 }} />;
}

function StockBarChart({ stockStats }: { stockStats: DashboardData["stockStats"] }) {
  if (stockStats.length === 0) {
    return (
      <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
        暂无数据
      </div>
    );
  }

  const sorted = [...stockStats].sort((a, b) => b.quantity - a.quantity).slice(0, 10);

  const option = {
    tooltip: { 
      trigger: "axis", 
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255, 255, 255, 0.95)",
      borderColor: "#e5e7eb",
      borderWidth: 1,
      textStyle: { color: "#1f2937" },
      padding: [12, 16],
      borderRadius: 8,
    },
    grid: { left: "3%", right: "4%", bottom: "3%", top: "10%", containLabel: true },
    xAxis: { 
      type: "value",
      axisLabel: { color: "#6b7280", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#f3f4f6", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((s) => s.modelName).reverse(),
      axisLabel: { interval: 0, color: "#6b7280", fontSize: 11 },
      axisLine: { lineStyle: { color: "#e5e7eb" } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((s) => s.quantity).reverse(),
        itemStyle: {
          color: "#0d9488",
          borderRadius: [0, 4, 4, 0],
        },
        barWidth: "45%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 250 }} />;
}

export function DashboardClient({ data }: DashboardClientProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [animatedValues, setAnimatedValues] = useState<Record<string, number>>({});

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      statusCards.forEach((card) => {
        const duration = 1000;
        const steps = 60;
        const increment = card.value / steps;
        let current = 0;
        const animate = () => {
          current += increment;
          if (current >= card.value) {
            setAnimatedValues((prev) => ({ ...prev, [card.label]: card.value }));
          } else {
            setAnimatedValues((prev) => ({ ...prev, [card.label]: Math.floor(current) }));
            requestAnimationFrame(animate);
          }
        };
        requestAnimationFrame(animate);
      });
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const statusCards = [
    { label: "总设备数", value: data.total, status: "all" as const },
    { label: "闲置", value: data.byStatus["IDLE"] ?? 0, status: "IDLE" as const },
    { label: "在用", value: data.byStatus["IN_USE"] ?? 0, status: "IN_USE" as const },
    { label: "维修中", value: data.byStatus["IN_MAINTENANCE"] ?? 0, status: "IN_MAINTENANCE" as const },
    { label: "报废", value: data.byStatus["SCRAPPED"] ?? 0, status: "SCRAPPED" as const },
  ];

  const handleCardClick = (status: string) => {
    if (status === "all") {
      router.push("/assets");
    } else {
      router.push(`/assets?status=${status}`);
    }
  };

  const handleTaskClick = (type: string) => {
    switch (type) {
      case "allocate":
        router.push("/assets?status=IDLE");
        break;
      case "maintenance":
        router.push("/assets?status=IN_MAINTENANCE");
        break;
      case "low_stock":
        router.push("/components");
        break;
      case "warranty":
        router.push("/assets");
        break;
    }
  };

  const visibleLogs = data.recentLogs.slice(0, 5);

  return (
    <div className="space-y-4">
      <PageHeader title="首页概览" description="资产管理系统概览" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {statusCards.map((card, idx) => (
          <Card
            key={card.label}
            className="cursor-pointer hover:shadow-md transition-all duration-200 border-border/60 overflow-hidden"
            onClick={() => handleCardClick(card.status)}
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(12px)",
              transition: `opacity 0.4s ease-out ${idx * 0.08}s, transform 0.4s ease-out ${idx * 0.08}s`,
            }}
          >
            <CardContent className="pt-5 pb-5">
              <div className="flex items-stretch gap-4">
                <div className={cn("w-1 rounded-full shrink-0", CARD_BAR_CLASS[card.status])} />
                <div className="flex flex-col justify-center">
                  <p className="text-3xl font-semibold tracking-tight tabular-nums leading-none">
                    {animatedValues[card.label] ?? card.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">{card.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 待办任务和最近操作 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 待办任务 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              待办任务
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.pendingTasks.length > 0 ? (
              <div className="space-y-3">
                {data.pendingTasks.map((task, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleTaskClick(task.type)}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={task.type === "low_stock" ? "destructive" : "secondary"}>
                          {task.type === "allocate" && "待分配"}
                          {task.type === "maintenance" && "维修中"}
                          {task.type === "low_stock" && "库存不足"}
                          {task.type === "warranty" && "保修到期"}
                        </Badge>
                        {task.count && (
                          <span className="text-xs text-muted-foreground">{task.count} 项</span>
                        )}
                      </div>
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground self-center" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                暂无待办任务
              </div>
            )}
          </CardContent>
        </Card>

        {/* 最近操作 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              最近操作
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => router.push("/logs?type=lifecycle")}>
              显示更多
            </Button>
          </CardHeader>
          <CardContent>
            {visibleLogs.length > 0 ? (
              <div className="space-y-3">
                {visibleLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{ACTION_LABEL_MAP[log.action] ?? log.action}</Badge>
                        <span className="text-xs text-muted-foreground">{log.assetNo}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{log.operator}</span>
                        <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                暂无操作记录
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>设备状态分布</CardTitle>
          </CardHeader>
          <CardContent>
            <PieChart data={data} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>分类分布</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>生命周期趋势（近6个月）</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart trendData={data.trendData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>配件库存概览（Top 10）</CardTitle>
          </CardHeader>
          <CardContent>
            <StockBarChart stockStats={data.stockStats} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}