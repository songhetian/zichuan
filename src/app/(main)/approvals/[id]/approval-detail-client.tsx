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
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "approve" | "reject") => {
    if (myTaskId === null) return;
    setActing(true);
    const result =
      action === "approve"
        ? await approveTask({ taskId: myTaskId, comment: comment.trim() || undefined })
        : await rejectTask({ taskId: myTaskId, comment: comment.trim() || undefined });
    setActing(false);
    if (result.success) {
      toast({ title: action === "approve" ? "已通过" : "已驳回" });
      setComment("");
      await load();
    } else {
      toast({ title: "操作失败", description: result.error, variant: "destructive" });
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
  };

  return (
    <div className="space-y-4">
      <PageHeader title="申请单详情" description="审批进度与流转记录" />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{detail.title}</CardTitle>
            <Badge variant={STATUS_BADGE[detail.status]?.variant ?? "secondary"}>
              {STATUS_BADGE[detail.status]?.label ?? detail.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.requestNo} · 流程版本 v{detail.version} · 发起人：{detail.initiatorName}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">设备</p>
              <p className="font-medium">
                {payload.assetNo
                  ? `${payload.assetNo}${payload.assetName ? ` · ${payload.assetName}` : ""}`
                  : `#${payload.assetId ?? "-"}`}
              </p>
            </div>
            {detail.businessType === "ASSET_UPGRADE" ? (
              <>
                <div>
                  <p className="text-muted-foreground">配件类别</p>
                  <p className="font-medium">
                    {payload.categoryName ?? `#${payload.componentCategoryId ?? "-"}`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">动作</p>
                  <p className="font-medium">
                    {payload.action === "UPGRADE"
                      ? "升级"
                      : payload.action === "DOWNGRADE"
                        ? "降级"
                        : "-"}
                  </p>
                </div>
              </>
            ) : (
              <div aria-hidden="true" />
            )}
            <div className="col-span-2">
              <p className="text-muted-foreground">申请原因</p>
              <p className="whitespace-pre-wrap">{payload.reason || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">当前节点</p>
              <p className="font-medium">{detail.currentNodeName ?? "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">提交时间</p>
              <p className="font-medium">{formatTime(detail.submittedAt)}</p>
            </div>
          </div>

          {detail.status === "PENDING" && myTaskId !== null && (
            <div className="space-y-2 rounded-md border p-3">
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
          <CardTitle>流转记录</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {detail.logs.map((log, index) => (
              <li key={index} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {ACTION_LABEL[log.action] ?? log.action}
                    </p>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {formatTime(log.createdAt)}
                    </p>
                  </div>
                  {log.comment && <p className="text-muted-foreground">{log.comment}</p>}
                </div>
              </li>
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
