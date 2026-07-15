"use client";

import ReactECharts from "echarts-for-react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Monitor, Package, Wrench, Trash2, Users, Clock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  IDLE: "#94a3b8",
  IN_USE: "#22c55e",
  IN_MAINTENANCE: "#eab308",
  SCRAPPED: "#ef4444",
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
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: data.byCategory.map((c) => c.categoryName),
      axisLabel: {
        interval: 0,
        rotate: data.byCategory.length > 5 ? 30 : 0,
      },
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        type: "bar",
        data: data.byCategory.map((c) => c.count),
        itemStyle: { color: "#3b82f6", borderRadius: [4, 4, 0, 0] },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 250 }} />;
}

export function DashboardClient({ data }: DashboardClientProps) {
  const statusCards = [
    { label: "总设备数", value: data.total, icon: Monitor, color: "text-blue-600 bg-blue-100" },
    { label: "闲置", value: data.byStatus["IDLE"] ?? 0, icon: Package, color: "text-slate-600 bg-slate-100" },
    { label: "在用", value: data.byStatus["IN_USE"] ?? 0, icon: Users, color: "text-green-600 bg-green-100" },
    { label: "维修中", value: data.byStatus["IN_MAINTENANCE"] ?? 0, icon: Wrench, color: "text-yellow-600 bg-yellow-100" },
    { label: "报废", value: data.byStatus["SCRAPPED"] ?? 0, icon: Trash2, color: "text-red-600 bg-red-100" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" description="资产管理系统概览" />

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
      </div>

      {/* 待办任务和时间线 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              最近操作
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentLogs.length > 0 ? (
              <div className="space-y-3">
                {data.recentLogs.map((log) => (
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
    </div>
  );
}
