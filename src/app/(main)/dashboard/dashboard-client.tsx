"use client";

import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Server,
  PackageOpen,
  MonitorCheck,
  Wrench,
  Trash2,
  Clock,
  AlertCircle,
  PieChart as PieChartIcon,
  BarChart3,
  CheckCircle2,
  Activity,
  CalendarDays,
  ChevronRight,
} from "lucide-react";
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
  IDLE: "#64748b",
  IN_USE: "#2563eb",
  IN_MAINTENANCE: "#f59e0b",
  SCRAPPED: "#ef4444",
  RESERVED: "#8b5cf6",
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

/** KPI 卡片：线性图标 + 大号数字 + 占比条形，克制专业、无图标色块、无上浮 */
function KpiCard({
  label,
  value,
  hint,
  accent,
  icon: Icon,
  share,
  index,
  visible,
  animated,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  accent: string;
  icon: typeof Server;
  share?: number;
  index: number;
  visible: boolean;
  animated: number;
  onClick: () => void;
}) {
  return (
    <Card
      className="group relative cursor-pointer overflow-hidden border-border/70 transition-colors hover:border-primary/45"
      onClick={onClick}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(10px)",
        transition: `opacity 0.4s ease-out ${index * 0.07}s, transform 0.45s cubic-bezier(0.22,1,0.36,1) ${index * 0.07}s`,
      }}
    >
      {/* 顶部状态色细线，替代表头 */}
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: accent }} />
      <CardContent className="p-5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium tracking-wide text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none tracking-tight tabular-nums">
            {animated}
          </span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
        {typeof share === "number" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">占比</span>
              <span className="tabular-nums text-muted-foreground">{share.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(share, 100)}%`, backgroundColor: accent }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PieChart({ data }: { data: DashboardData }) {
  const colors = useThemeColors();
  const chartData = Object.entries(data.byStatus)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: getStatusLabel(key),
      value,
      itemStyle: { color: STATUS_COLOR_MAP[key] ?? "#2455D9" },
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
        暂无数据
      </div>
    );
  }

  const total = chartData.reduce((sum, s) => sum + s.value, 0);

  const option = {
    tooltip: {
      trigger: "item",
      formatter: "{b}: <b>{c}</b> 台 · {d}%",
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: colors.foreground },
      padding: [10, 14],
      borderRadius: 8,
    },
    // 环形中心展示设备总数，形成「聚焦核心」的专业结构
    title: {
      text: String(total),
      subtext: "设备总数 · 台",
      left: "center",
      top: "40%",
      textAlign: "center",
      textStyle: { fontSize: 26, fontWeight: 700, color: colors.foreground, lineHeight: 30 },
      subtextStyle: { fontSize: 11, color: colors.muted, lineHeight: 16 },
    },
    legend: { show: false },
    series: [
      {
        type: "pie",
        radius: ["56%", "78%"],
        center: ["50%", "46%"],
        minAngle: 3,
        // 发丝级细分隔 + 微圆角：避免粗白描边带来的「饼干圈」感，更符合专业面板
        itemStyle: {
          borderRadius: 4,
          borderColor: colors.card,
          borderWidth: 1,
          borderJoin: "round",
        },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          label: { show: false },
          itemStyle: { shadowBlur: 16, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.16)" },
        },
        animationType: "scale",
        data: chartData.map((s) => ({ ...s, itemStyle: { ...s.itemStyle, borderRadius: 4, borderWidth: 1 } })),
      },
    ],
  };

  return (
    <div className="flex flex-col">
      <ReactECharts option={option} style={{ height: 200, width: "100%" }} />
      {/* 状态明细：网格化布局，突出数值与占比的层次关系 */}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {chartData.map((item) => {
          const percent = total > 0 ? (item.value / total) * 100 : 0;
          return (
            <div
              key={item.name}
              className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
              style={{ borderLeftWidth: 3, borderLeftColor: item.itemStyle.color }}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.itemStyle.color }}
                  />
                  {item.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {percent.toFixed(1)}%
                </span>
              </div>
              <span className="text-lg font-bold leading-none tabular-nums">
                {item.value}
                <span className="ml-1 text-xs font-normal text-muted-foreground">台</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardClient({ data }: DashboardClientProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [animatedValues, setAnimatedValues] = useState<Record<string, number>>({});

  const statusCards = [
    { label: "总设备数", value: data.total, status: "all", icon: Server, accent: "#2455D9" },
    { label: "在用", value: data.byStatus["IN_USE"] ?? 0, status: "IN_USE", icon: MonitorCheck, accent: "#2563eb" },
    { label: "闲置", value: data.byStatus["IDLE"] ?? 0, status: "IDLE", icon: PackageOpen, accent: "#64748b" },
    { label: "维修中", value: data.byStatus["IN_MAINTENANCE"] ?? 0, status: "IN_MAINTENANCE", icon: Wrench, accent: "#f59e0b" },
    { label: "报废", value: data.byStatus["SCRAPPED"] ?? 0, status: "SCRAPPED", icon: Trash2, accent: "#ef4444" },
  ];

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
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = data.total || 1;
  const inUse = data.byStatus["IN_USE"] ?? 0;
  const idle = data.byStatus["IDLE"] ?? 0;
  const inUseRate = (inUse / total) * 100;
  const pendingCount = data.pendingTasks.reduce((sum, t) => sum + (t.count ?? 0), 0);
  const visibleLogs = data.recentLogs.slice(0, 5);

  // 今日日期
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        timeZone: "Asia/Shanghai",
      }).format(new Date()),
    []
  );

  const handleCardClick = (status: string) => {
    if (status === "all") router.push("/assets");
    else router.push(`/assets?status=${status}`);
  };

  const handleTaskClick = (type: string) => {
    switch (type) {
      case "allocate": router.push("/assets?status=IDLE"); break;
      case "maintenance": router.push("/assets?status=IN_MAINTENANCE"); break;
      case "low_stock": router.push("/components"); break;
      case "warranty": router.push("/assets"); break;
    }
  };

  const TASK_META: Record<string, { badge: "destructive" | "secondary" | "outline"; tint: string; label: string }> = {
    allocate: { badge: "secondary", tint: "#2455D9", label: "待分配" },
    maintenance: { badge: "secondary", tint: "#d97706", label: "维修中" },
    low_stock: { badge: "destructive", tint: "#dc2626", label: "库存不足" },
    warranty: { badge: "secondary", tint: "#0d9488", label: "保修到期" },
  };

  return (
    <div className="space-y-5">
      {/* ===== 概览头部：驾驶舱式总览横幅 ===== */}
      <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card">
        {/* 左侧主色气息带 + 右上角极淡装饰色块 */}
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <span className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/5" />
        <span className="pointer-events-none absolute -right-1 -top-1 h-px w-1/3 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-7">
          <div className="max-w-2xl">
            <h1 className="flex items-center gap-2.5 font-display text-2xl tracking-tight md:text-3xl">
              <Activity className="h-6 w-6 text-primary" strokeWidth={1.75} />
              首页概览
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              实时掌握设备状态分布与运行健康度，及时响应待办事项。
            </p>
          </div>

          {/* 右侧核心指标：在用率 + 状态合计 */}
          <div className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3 md:min-w-[360px]">
            <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-border/70 bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">当前在用率</p>
              <p className="mt-2 text-2xl font-bold tabular-nums leading-none text-primary">
                {inUseRate.toFixed(1)}%
              </p>
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(inUseRate, 100)}%` }} />
              </div>
            </div>
            <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-border/70 bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">在用 / 闲置</p>
              <p className="mt-2 text-2xl font-bold tabular-nums leading-none">
                <span className="text-emerald-600">{inUse}</span>
                <span className="text-muted-foreground"> / </span>
                <span>{idle}</span>
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">单位：台</p>
            </div>
            <div className="flex min-h-[96px] flex-col justify-between rounded-lg border border-border/70 bg-muted/30 p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} />
                统计日期
              </p>
              <p className="mt-2 text-sm font-medium leading-snug">{today}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">数据实时同步</p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 状态统计 KPI 卡片 ===== */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {statusCards.map((card, idx) => {
          const share = (card.value / total) * 100;
          return (
            <KpiCard
              key={card.label}
              label={card.label}
              value={card.value}
              hint={card.status === "all" ? "台" : "台"}
              accent={card.accent}
              icon={card.icon}
              share={share}
              index={idx}
              visible={visible}
              animated={animatedValues[card.label] ?? card.value}
              onClick={() => handleCardClick(card.status)}
            />
          );
        })}
      </div>

      {/* ===== 概览主区：待办 / 状态分布 / 最近操作 ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* 待办任务 */}
        <Card className="flex flex-col border-border/70 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-amber-500" strokeWidth={1.75} />
              待办任务
            </CardTitle>
            {pendingCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {pendingCount} 项待处理
              </span>
            )}
          </CardHeader>
          <CardContent className="flex-1 p-5">
            {data.pendingTasks.length > 0 ? (
              <div className="space-y-2.5">
                {data.pendingTasks.map((task, idx) => {
                  const meta = TASK_META[task.type] ?? { badge: "secondary", tint: "#2455D9", label: "待办" };
                  return (
                    <div
                      key={`${task.type}-${idx}`}
                      className="group cursor-pointer rounded-lg border border-border/60 bg-muted/20 p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                      onClick={() => handleTaskClick(task.type)}
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meta.tint }} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={meta.badge}>{meta.label}</Badge>
                            {task.count && (
                              <span className="text-xs tabular-nums text-muted-foreground">{task.count} 项</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm font-medium">{task.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 self-start text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/25 bg-emerald-500/10">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" strokeWidth={1.75} />
                </span>
                <p className="text-sm text-muted-foreground">暂无待办，运行状况良好</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 设备状态分布 */}
        <Card className="border-border/70 lg:col-span-2">
          <CardHeader className="border-b border-border/50 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChartIcon className="h-4 w-4 text-primary" strokeWidth={1.75} />
              设备状态分布
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <PieChart data={data} />
          </CardContent>
        </Card>

        {/* 最近操作 */}
        <Card className="flex flex-col border-border/70 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-primary" strokeWidth={1.75} />
              最近操作
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => router.push("/logs?type=lifecycle")}>
              查看全部
              <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 p-5">
            {visibleLogs.length > 0 ? (
              <div className="space-y-2.5">
                {visibleLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{ACTION_LABEL_MAP[log.action] ?? log.action}</Badge>
                        <span className="text-xs font-mono text-muted-foreground">{log.assetNo}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{log.operator}</span>
                        <span className="tabular-nums">
                          {new Date(log.createdAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
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
        <Card className="border-border/70 lg:col-span-6">
          <CardHeader className="border-b border-border/50 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" strokeWidth={1.75} />
              各部门设备分类分布
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <CategoryByDepartmentChart data={data.categoryByDepartment} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}