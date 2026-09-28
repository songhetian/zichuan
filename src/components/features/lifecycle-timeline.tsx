"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Wrench,
  Trash2,
  ArrowRightLeft,
  ArrowUpCircle,
  ArrowDownCircle,
  Package,
  UserCheck,
  RotateCcw,
  Clock,
} from "lucide-react";
import { getStatusLabel } from "@/lib/status-labels";

interface LifecycleLog {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string;
  remark: string | null;
  createdAt: Date;
}

interface LifecycleTimelineProps {
  logs: LifecycleLog[];
}

const actionConfig: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bgColor: string;
  }
> = {
  CREATED: {
    label: "创建",
    icon: Package,
    color: "text-slate-600",
    bgColor: "bg-slate-100/80 border-slate-300/60",
  },
  ALLOCATED: {
    label: "分配",
    icon: UserCheck,
    color: "text-emerald-700",
    bgColor: "bg-emerald-100/70 border-emerald-300/60",
  },
  RETURNED: {
    label: "归还",
    icon: RotateCcw,
    color: "text-amber-700",
    bgColor: "bg-amber-100/80 border-amber-300/60",
  },
  TRANSFERRED: {
    label: "调拨",
    icon: ArrowRightLeft,
    color: "text-purple-700",
    bgColor: "bg-purple-100/70 border-purple-300/60",
  },
  UPGRADED: {
    label: "升级",
    icon: ArrowUpCircle,
    color: "text-indigo-700",
    bgColor: "bg-indigo-100/70 border-indigo-300/60",
  },
  DOWNGRADED: {
    label: "降级",
    icon: ArrowDownCircle,
    color: "text-indigo-700",
    bgColor: "bg-indigo-100/70 border-indigo-300/60",
  },
  SCRAPPED: {
    label: "报废",
    icon: Trash2,
    color: "text-red-700",
    bgColor: "bg-red-100/80 border-red-300/60",
  },
  MAINTENANCE_START: {
    label: "送修",
    icon: Wrench,
    color: "text-amber-700",
    bgColor: "bg-amber-100/80 border-amber-300/60",
  },
  MAINTENANCE_DONE: {
    label: "维修完成",
    icon: CheckCircle2,
    color: "text-emerald-700",
    bgColor: "bg-emerald-100/70 border-emerald-300/60",
  },
};

export function LifecycleTimeline({ logs }: LifecycleTimelineProps) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock className="h-12 w-12 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">暂无操作记录</p>
      </div>
    );
  }

  // 按时间倒序排列
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="relative">
      {/* 时间线竖线 */}
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-6">
        {sortedLogs.map((log, index) => {
          const config = actionConfig[log.action] || {
            label: log.action,
            icon: Clock,
            color: "text-muted-foreground",
            bgColor: "bg-muted/60 border-border/60",
          };
          const Icon = config.icon;
          const isFirst = index === 0;

          return (
            <div key={log.id} className="relative flex gap-4">
              {/* 时间线节点 */}
              <div
                className={`relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 ${config.bgColor} ${
                  isFirst ? "ring-4 ring-primary/10" : ""
                }`}
              >
                <Icon className={`h-5 w-5 ${config.color}`} />
              </div>

              {/* 内容卡片 */}
              <Card
                className={`flex-1 p-4 ${
                  isFirst ? "border-primary/30 bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={config.color}>
                        {config.label}
                      </Badge>
                      {/* 仅当状态确实变化时显示流转；升降级等不改变资产状态的记录不展示 */}
                      {log.fromStatus &&
                        log.toStatus &&
                        log.fromStatus !== log.toStatus && (
                          <div className="flex items-center gap-1 text-sm">
                            <span className="text-muted-foreground">
                              {getStatusLabel(log.fromStatus)}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium">
                              {getStatusLabel(log.toStatus)}
                            </span>
                          </div>
                        )}
                      {!log.fromStatus && log.toStatus && (
                        <span className="text-sm font-medium">
                          {getStatusLabel(log.toStatus)}
                        </span>
                      )}
                    </div>

                    {log.remark && (
                      <p className="text-sm text-muted-foreground">
                        {log.remark}
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(log.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
                      </span>
                      <span>操作人: {log.operator}</span>
                    </div>
                  </div>

                  {isFirst && (
                    <Badge variant="default" className="text-xs">
                      最新
                    </Badge>
                  )}
                </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
