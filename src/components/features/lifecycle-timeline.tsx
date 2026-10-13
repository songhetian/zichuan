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
import {
  LIFECYCLE_ACTION_TONE,
  TONE_SOFT_BORDER,
  TONE_TEXT,
  type Tone,
} from "@/lib/status-styles";

interface LifecycleLog {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string;
  remark: string | null;
  createdAt: Date;
  /** 相关人员（分配/归还/调拨时）；由服务端批量补全姓名 */
  employeeName?: string | null;
}

interface LifecycleTimelineProps {
  logs: LifecycleLog[];
}

/** 语义角色 → 节点配色。角色一律取自 @/lib/status-styles，避免与其它页面各写一套。 */
function nodeTone(tone: Tone) {
  return { color: TONE_TEXT[tone], bgColor: TONE_SOFT_BORDER[tone] };
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
  CREATED: { label: "创建", icon: Package, ...nodeTone(LIFECYCLE_ACTION_TONE.CREATED) },
  ALLOCATED: { label: "分配", icon: UserCheck, ...nodeTone(LIFECYCLE_ACTION_TONE.ALLOCATED) },
  RETURNED: { label: "归还", icon: RotateCcw, ...nodeTone(LIFECYCLE_ACTION_TONE.RETURNED) },
  TRANSFERRED: {
    label: "调拨",
    icon: ArrowRightLeft,
    ...nodeTone(LIFECYCLE_ACTION_TONE.TRANSFERRED),
  },
  UPGRADED: {
    label: "升级",
    icon: ArrowUpCircle,
    ...nodeTone(LIFECYCLE_ACTION_TONE.UPGRADED),
  },
  DOWNGRADED: {
    label: "降级",
    icon: ArrowDownCircle,
    ...nodeTone(LIFECYCLE_ACTION_TONE.DOWNGRADED),
  },
  SCRAPPED: { label: "报废", icon: Trash2, ...nodeTone(LIFECYCLE_ACTION_TONE.SCRAPPED) },
  MAINTENANCE_START: {
    label: "送修",
    icon: Wrench,
    ...nodeTone(LIFECYCLE_ACTION_TONE.MAINTENANCE_START),
  },
  MAINTENANCE_DONE: {
    label: "维修完成",
    icon: CheckCircle2,
    ...nodeTone(LIFECYCLE_ACTION_TONE.MAINTENANCE_DONE),
  },
};

/** 生命周期动作 → 相关人员展示前缀（分配/归还/调拨等带人员语义的动作） */
const PERSON_LABEL: Record<string, string> = {
  ALLOCATED: "分配给",
  TRANSFERRED: "调拨给",
  RETURNED: "归还人",
  REPLACED: "回收自",
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
            color: TONE_TEXT.neutral,
            bgColor: TONE_SOFT_BORDER.neutral,
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

                    {log.employeeName && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">
                          {PERSON_LABEL[log.action] ?? "相关人员"}：
                        </span>
                        <span className="font-medium">{log.employeeName}</span>
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
