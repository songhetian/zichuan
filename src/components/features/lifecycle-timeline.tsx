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
  Package,
  UserCheck,
  RotateCcw,
  Clock,
} from "lucide-react";

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
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200",
  },
  ALLOCATED: {
    label: "分配",
    icon: UserCheck,
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200",
  },
  RETURNED: {
    label: "归还",
    icon: RotateCcw,
    color: "text-orange-600",
    bgColor: "bg-orange-50 border-orange-200",
  },
  TRANSFERRED: {
    label: "调拨",
    icon: ArrowRightLeft,
    color: "text-purple-600",
    bgColor: "bg-purple-50 border-purple-200",
  },
  UPGRADED: {
    label: "升级",
    icon: ArrowUpCircle,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50 border-indigo-200",
  },
  SCRAPPED: {
    label: "报废",
    icon: Trash2,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200",
  },
  MAINTENANCE_START: {
    label: "送修",
    icon: Wrench,
    color: "text-yellow-600",
    bgColor: "bg-yellow-50 border-yellow-200",
  },
  MAINTENANCE_DONE: {
    label: "维修完成",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 border-emerald-200",
  },
};

const statusLabelMap: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "报废",
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
            color: "text-gray-600",
            bgColor: "bg-gray-50 border-gray-200",
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
                      {log.fromStatus && log.toStatus && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-muted-foreground">
                            {statusLabelMap[log.fromStatus] ?? log.fromStatus}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">
                            {statusLabelMap[log.toStatus] ?? log.toStatus}
                          </span>
                        </div>
                      )}
                      {!log.fromStatus && log.toStatus && (
                        <span className="text-sm font-medium">
                          {statusLabelMap[log.toStatus] ?? log.toStatus}
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
                        {new Date(log.createdAt).toLocaleString("zh-CN")}
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
