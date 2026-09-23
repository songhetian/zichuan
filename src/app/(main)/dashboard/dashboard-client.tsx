"use client";

import { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, AlertCircle, ChevronRight, CheckCircle2, PieChart as PieChartIcon, BarChart3, Server, PackageOpen, MonitorCheck, Wrench, Trash2, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CategoryByDepartmentChart } from "@/components/features/category-by-department-chart";
import type { CategoryByDepartmentData } from "@/lib/category-by-department";
import { getStatusLabel } from "@/lib/status-labels";
import { useThemeColors } from "@/lib/use-theme-colors";

interface DashboardData {
  total: number;
  byStatus: Record<string, number>;
  categoryByDepartment: CategoryByDepartmentData;
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

const STATUS_COLOR_MAP: Record<string, string> = {
  IDLE: "#78716c",
  IN_USE: "#0d9488",
  IN_MAINTENANCE: "#d97706",
  SCRAPPED: "#dc2626",
  IN_STOCK: "#3b82f6",
  RESERVED: "#8b5cf6",
};

// 统计卡片图标与底色（暗色下用低透明着色，避免刺眼亮块）
const CARD_ICON: Record<
  string,
  { Icon: (typeof Server) | (typeof PackageOpen) | (typeof MonitorCheck) | (typeof Wrench) | (typeof Trash2) | (typeof Archive); chip: string }
> = {
  all: { Icon: Server, chip: "bg-primary/10 text-primary" },
  IDLE: { Icon: PackageOpen, chip: "bg-muted/50 text-muted-foreground" },
  IN_USE: { Icon: MonitorCheck, chip: "bg-primary/10 text-primary" },
  IN_STOCK: { Icon: Archive, chip: "bg-cyan-500/15 text-cyan-400" },
  IN_MAINTENANCE: { Icon: Wrench, chip: "bg-amber-500/15 text-amber-400" },
  SCRAPPED: { Icon: Trash2, chip: "bg-red-500/15 text-red-400" },
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
  const colors = useThemeColors();
  const chartData = Object.entries(data.byStatus)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: getStatusLabel(key),
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

  const total = chartData.reduce((sum, s) => sum + s.value, 0);

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{b}: {c} 台 ({d}%)",
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: colors.foreground },
      padding: [12, 16],
      borderRadius: 8,
    },
    // 不用扇区外侧标签，也不在图表内放图例——标签表下沉到图表下方独立渲染，
    // 避免百分比/数量相互遮挡
    legend: { show: false },
    series: [
      {
        type: "pie",
        radius: ["50%", "74%"],
        center: ["50%", "45%"],
        minAngle: 3,
        itemStyle: {
          borderRadius: 12,
          borderColor: "#fff",
          borderWidth: 3,
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          label: { show: false },
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

  return (
    <div className="flex flex-col">
      <ReactECharts option={option} style={{ height: 180 }} />
      <ul className="mt-2 flex flex-col space-y-1.5">
        {chartData.map((item) => {
          const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
          return (
            <li key={item.name} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: item.itemStyle.color }}
              />
              <span className="w-16 shrink-0 text-muted-foreground">{item.name}</span>
              <span className="flex-1 text-right tabular-nums font-medium">{item.value} 台</span>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {percent}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
    { label: "在库", value: data.byStatus["IN_STOCK"] ?? 0, status: "IN_STOCK" as const },
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

  const pendingCount = data.pendingTasks.reduce((sum, t) => sum + (t.count ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="首页概览" description="资产管理系统概览" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {statusCards.map((card, idx) => {
          const cardIcon = CARD_ICON[card.status];
          return (
            <Card
              key={card.label}
              className="group cursor-pointer relative hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-200 border-border/60 overflow-hidden"
              onClick={() => handleCardClick(card.status)}
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(12px)",
                transition: `opacity 0.4s ease-out ${idx * 0.08}s, transform 0.45s cubic-bezier(0.22,1,0.36,1) ${idx * 0.08}s`,
              }}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="pt-5 pb-5 px-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col justify-center gap-1.5">
                    <p className="text-3xl font-bold tracking-tight tabular-nums leading-none">
                      {animatedValues[card.label] ?? card.value}
                    </p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                  {cardIcon && (
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${cardIcon.chip}`}>
                      <cardIcon.Icon className="h-5 w-5" />
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 概览内容：同屏展示，无需 tab 切换 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* 待办任务 */}
        <Card className="lg:col-span-2 border-border/80 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                <AlertCircle className="h-4 w-4" />
              </span>
              待办任务
            </CardTitle>
            {pendingCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {pendingCount} 项待处理
              </span>
            )}
          </CardHeader>
          <CardContent className="pt-4 flex-1">
            {data.pendingTasks.length > 0 ? (
              <div className="space-y-3">
                {data.pendingTasks.map((task, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30 cursor-pointer hover:bg-accent/50 hover:border-accent transition-colors"
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
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <p className="text-sm text-muted-foreground">暂无待办任务</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 设备状态分布 */}
        <Card className="lg:col-span-2 border-border/80">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PieChartIcon className="h-4 w-4" />
              </span>
              设备状态分布
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <PieChart data={data} />
          </CardContent>
        </Card>

        {/* 最近操作 */}
        <Card className="lg:col-span-2 border-border/80 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-400">
                <Clock className="h-4 w-4" />
              </span>
              最近操作
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => router.push("/logs?type=lifecycle")}>
              显示更多
            </Button>
          </CardHeader>
          <CardContent className="pt-4 flex-1">
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
                        <span>{new Date(log.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center text-sm text-muted-foreground">
                暂无操作记录
              </div>
            )}
          </CardContent>
        </Card>

        {/* 各部门设备分类分布 */}
        <Card className="lg:col-span-6 border-border/80">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
                <BarChart3 className="h-4 w-4" />
              </span>
              各部门设备分类分布
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <CategoryByDepartmentChart data={data.categoryByDepartment} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}