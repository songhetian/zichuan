"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import {
  getApprovalRequestById,
  getMyTodoTasks,
  approveTask,
  rejectTask,
} from "@/actions/approval.actions";

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  PENDING: { label: "审批中", variant: "default" },
  APPROVED: { label: "已通过", variant: "outline" },
  REJECTED: { label: "已驳回", variant: "destructive" },
  CANCELLED: { label: "已撤销", variant: "secondary" },
};

const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "提交申请",
  APPROVE: "审批通过",
  REJECT: "驳回",
  CANCEL: "撤销",
  EXECUTE: "系统执行",
  EXECUTE_FAILED: "执行失败",
};

/** 流转时间轴的节点状态 */
type FlowTone = "start" | "ok" | "fail" | "wait" | "end";

/** 时间轴上每个圆点的配色 */
function flowDot(tone: FlowTone): string {
  switch (tone) {
    case "start":
      return "border-primary bg-primary-foreground ring-primary/20";
    case "ok":
      return "border-emerald-500 bg-emerald-50 ring-emerald-500/20";
    case "fail":
      return "border-red-500 bg-red-50 ring-red-500/20";
    case "end":
      return "border-primary bg-primary ring-primary/20";
    default:
      return "border-amber-400 bg-amber-50 ring-amber-400/20";
  }
}

/** 流转中的一个步骤（提交 / 各节点 / 终态） */
function FlowStep({
  tone,
  title,
  by,
  time,
  comment,
  isLast,
}: {
  tone: FlowTone;
  title: string;
  by?: string;
  time?: string | Date | null;
  comment?: string | null;
  isLast?: boolean;
}) {
  return (
    <li className="relative flex gap-3">
      <div className="relative flex flex-col items-center">
        <span className={`z-10 mt-2 h-3 w-3 rounded-full border-[3px] ${flowDot(tone)}`} />
        {!isLast && (
          <span className="absolute top-6 bottom-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        )}
      </div>
      <div
        className={`mb-1 min-w-0 flex-1 rounded-md border px-3 py-2.5 ${
          isLast ? "border-primary/30 bg-primary/[0.03]" : "border-border/70 bg-card"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{title}</span>
            {by && (
              <span className="shrink-0 text-xs font-normal text-muted-foreground">· {by}</span>
            )}
          </p>
          {time && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatTime(time)}
            </span>
          )}
        </div>
        {comment && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {comment}
          </p>
        )}
      </div>
    </li>
  );
}

/** 申请单流转记录 → 时间轴步骤 */
function buildDetailSteps(logs: Detail["logs"]): {
  tone: FlowTone;
  title: string;
  time: string | null;
  comment: string | null;
  isLast: boolean;
}[] {
  return logs.map((log, index) => {
    let tone: FlowTone = "wait";
    let title = ACTION_LABEL[log.action] ?? log.action;
    if (log.action === "SUBMIT") tone = "start";
    else if (log.action === "APPROVE") tone = "ok";
    else if (log.action === "REJECT") tone = "fail";
    else if (log.action === "EXECUTE") tone = "end";
    else if (log.action === "EXECUTE_FAILED") tone = "fail";
    else if (log.action === "CANCEL") tone = "wait";
    return {
      tone,
      title,
      time: log.createdAt ?? null,
      comment: log.comment ?? null,
      isLast: index === logs.length - 1,
    };
  });
}

type Detail = {
  id: number;
  requestNo: string;
  title: string;
  status: string;
  businessType: string;
  version: number;
  initiatorName: string;
  currentNodeName: string | null;
  payload: unknown;
  submittedAt: string;
  finishedAt: string | null;
  logs: {
    action: string;
    comment: string | null;
    fromNodeKey: string | null;
    toNodeKey: string | null;
    createdAt: string;
  }[];
};

export function ApprovalDetailClient({ requestId }: { requestId: number }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [myTaskId, setMyTaskId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, todo] = await Promise.all([
        getApprovalRequestById(requestId),
        getMyTodoTasks(),
      ]);
      if (!d.success) {
        setError(d.error);
        return;
      }
      setDetail({
        ...d.data,
        submittedAt:
          d.data.submittedAt instanceof Date
            ? d.data.submittedAt.toISOString()
            : d.data.submittedAt,
        finishedAt:
          d.data.finishedAt instanceof Date
            ? d.data.finishedAt.toISOString()
            : d.data.finishedAt,
        logs: d.data.logs.map((l) => ({
          ...l,
          createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
        })),
      } as Detail);
      if (todo.success) {
        const mine = todo.data.find(
          (t) => t.requestId === requestId && t.status === "PENDING"
        );
        setMyTaskId(mine?.id ?? null);
      }
    } catch {
      setError("加载异常，请稍后重试");
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "approve" | "reject") => {
    if (myTaskId === null) return;
    setActing(true);
    try {
      const result =
        action === "approve"
          ? await approveTask({ taskId: myTaskId, comment: comment.trim() || undefined })
          : await rejectTask({ taskId: myTaskId, comment: comment.trim() || undefined });
      if (result.success) {
        toast({ title: action === "approve" ? "已通过" : "已驳回" });
        setComment("");
        await load();
      } else {
        toast({ title: "操作失败", description: result.error, variant: "destructive" });
      }
    } catch (e) {
      // 审批动作抛异常（如自动执行失败）时也必须有反馈，否则用户看不到任何提示
      toast({ title: "操作失败", description: "审批请求异常，请稍后重试", variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="申请单详情" description="审批进度与流转记录" />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <PageHeader title="申请单详情" description="审批进度与流转记录" />
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            加载中...
          </CardContent>
        </Card>
      </div>
    );
  }

  const payload = detail.payload as {
    assetId?: number;
    assetNo?: string;
    assetName?: string;
    componentCategoryId?: number;
    categoryName?: string;
    action?: string;
    reason?: string;
    modelId?: number;
    newModelName?: string;
    brand?: string;
    modelName?: string;
    quantity?: number;
    unitPrice?: number;
  };

  return (
    <div className="space-y-4">
      <PageHeader title="申请单详情" description="审批进度与流转记录" />

      <Card className="overflow-hidden">
        {/* 顶部专业状态条 */}
        <div className="flex items-center justify-between gap-4 border-b border-border/50 bg-primary/[0.02] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              detail.status === "APPROVED"
                ? "bg-emerald-500"
                : detail.status === "REJECTED"
                  ? "bg-red-500"
                  : "bg-primary"
            }`} />
            <div className="min-w-0">
              <p className="truncate font-display text-base text-foreground">{detail.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {detail.requestNo} · 发起人 {detail.initiatorName}
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <Badge variant={STATUS_BADGE[detail.status]?.variant ?? "secondary"}>
              {STATUS_BADGE[detail.status]?.label ?? detail.status}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">流程版本 v{detail.version}</p>
          </div>
        </div>
        <CardContent className="space-y-4 p-5">
          <dl className="divide-y divide-border/60 rounded-md border border-border/60 text-sm">
            {detail.businessType === "ASSET_PURCHASE" ? (
              <>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">配件分类</dt>
                  <dd className="font-medium">
                    {payload.categoryName ?? `#${payload.componentCategoryId ?? "-"}`}
                  </dd>
                </div>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">型号</dt>
                  <dd className="font-medium">
                    {payload.newModelName ??
                      payload.modelName ??
                      (payload.modelId ? `#${payload.modelId}` : "-")}
                    {payload.brand ? `（${payload.brand}）` : ""}
                  </dd>
                </div>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">数量</dt>
                  <dd className="font-medium">{payload.quantity ?? "-"}</dd>
                </div>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">单价（元）</dt>
                  <dd className="font-medium">
                    {payload.unitPrice != null ? Number(payload.unitPrice) : "-"}
                  </dd>
                </div>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">总价（元）</dt>
                  <dd className="font-semibold tabular-nums text-primary">
                    {payload.unitPrice != null && payload.quantity != null
                      ? (Number(payload.unitPrice) * Number(payload.quantity)).toFixed(2)
                      : "-"}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-4 px-4 py-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">设备</dt>
                  <dd className="font-medium">
                    {payload.assetNo
                      ? `${payload.assetNo}${payload.assetName ? ` · ${payload.assetName}` : ""}`
                      : `#${payload.assetId ?? "-"}`}
                  </dd>
                </div>
                {detail.businessType === "ASSET_UPGRADE" ? (
                  <>
                    <div className="flex gap-4 px-4 py-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">配件类别</dt>
                      <dd className="font-medium">
                        {payload.categoryName ?? `#${payload.componentCategoryId ?? "-"}`}
                      </dd>
                    </div>
                    <div className="flex gap-4 px-4 py-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">动作</dt>
                      <dd className="font-medium">
                        {payload.action === "UPGRADE"
                          ? "升级"
                          : payload.action === "DOWNGRADE"
                            ? "降级"
                            : "-"}
                      </dd>
                    </div>
                  </>
                ) : null}
              </>
            )}
            <div className="flex gap-4 px-4 py-2">
              <dt className="w-24 shrink-0 text-muted-foreground">当前节点</dt>
              <dd className="font-medium">{detail.currentNodeName ?? "-"}</dd>
            </div>
            <div className="flex gap-4 px-4 py-2">
              <dt className="w-24 shrink-0 text-muted-foreground">提交时间</dt>
              <dd className="font-medium">{formatTime(detail.submittedAt)}</dd>
            </div>
            <div className="flex gap-4 px-4 py-2">
              <dt className="w-24 shrink-0 text-muted-foreground">申请原因</dt>
              <dd className="whitespace-pre-wrap font-medium">{payload.reason || "-"}</dd>
            </div>
          </dl>

          {detail.status === "PENDING" && myTaskId !== null && (
            <div className="space-y-3 rounded-md border border-primary/20 bg-primary/[0.02] p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <p className="text-sm font-medium text-foreground">
                  待你审批 · 当前节点：{detail.currentNodeName ?? "-"}
                </p>
              </div>
              <Label htmlFor="act-comment">审批意见</Label>
              <Textarea
                id="act-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="填写审批意见（选填）"
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={acting}
                  onClick={() => act("reject")}
                >
                  驳回
                </Button>
                <Button type="button" disabled={acting} onClick={() => act("approve")}>
                  通过
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>审批流转记录</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1">
            {buildDetailSteps(detail.logs).map((step, index) => (
              <FlowStep
                key={index}
                tone={step.tone}
                title={step.title}
                time={step.time}
                comment={step.comment}
                isLast={step.isLast}
              />
            ))}
            {detail.logs.length === 0 && (
              <li className="text-sm text-muted-foreground">暂无流转记录</li>
            )}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
