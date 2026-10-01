"use client";

import { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import { getStatusLabel } from "@/lib/status-labels";
import {
  getDepartureHandover,
  type DepartureHandoverInfo,
} from "@/actions/approval-depart.actions";
import { confirmHandover } from "@/actions/approval-execute.actions";

const STATUS_TEXT: Record<string, string> = {
  PENDING: "待对账",
  COLLECTED: "已回收",
};

/**
 * 离职交接单「对账确认回收」。
 *
 * 终审通过只生成 PENDING 交接单，**设备并没有回收**——必须资产管理员核对实物无误后
 * 确认，才真正回收（见 confirmHandover）。此前这块 UI 完全缺失：
 * action 有实现、权限点有 `asset.depart.execute`、测试也全绿，但前端零调用，
 * 流程在最后一公里是断的。
 *
 * 只展示交接单快照（生成时冻结的应回收清单），这是对账依据；
 * 「实时设备明细」由上方 DepartureCheckPanel 负责，两者互补不重复请求。
 */
export function DepartureHandoverPanel({
  requestId,
  onCollected,
}: {
  requestId: number;
  onCollected?: () => void;
}) {
  const { toast } = useToast();
  const [order, setOrder] = useState<DepartureHandoverInfo | null>(null);
  const [remark, setRemark] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDepartureHandover(requestId)
      .then((res) => {
        if (cancelled) return;
        // 失败时按「没有交接单」处理：这一块是补充信息，不该把单据页搞成报错页
        setOrder(res.success ? res.data : null);
      })
      .catch(() => {
        if (!cancelled) setOrder(null);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const runConfirm = async () => {
    if (!order) return;
    setConfirmError(null);
    const res = await confirmHandover(order.orderId, remark.trim() || undefined);
    if (res.success) {
      setConfirmOpen(false);
      setRemark("");
      toast({ variant: "success", title: "已回收", description: `${order.assetCount} 台设备已置为闲置` });
      onCollected?.();
    } else {
      // 失败保持弹窗打开并把原因写进描述，用户能直接看到为什么没成功
      setConfirmError(res.error ?? "对账回收失败");
    }
  };

  // 没有交接单（还在审批中 / 非离职单）就整块不渲染，不占位
  if (!order) return null;

  const collected = order.status === "COLLECTED";

  return (
    <div className="space-y-3 rounded-md border border-info/30 bg-info/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <PackageCheck className="h-4 w-4 shrink-0 text-info" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          交接单 <span className="font-mono">{order.orderNo}</span>
        </p>
        <span className="text-sm text-muted-foreground">·</span>
        <span className="text-sm font-medium text-info">{STATUS_TEXT[order.status] ?? order.status}</span>
        {collected && order.collectedAt && (
          <span className="text-xs text-muted-foreground">
            {formatTime(order.collectedAt)} 回收
          </span>
        )}
      </div>

      <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card">
        {order.items.map((item) => (
          <li key={item.assetId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.assetNo}</span>
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {getStatusLabel(item.status)}
            </span>
          </li>
        ))}
      </ul>

      {collected ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          应回收设备已全部回收至闲置池，人员绑定已解除。
        </p>
      ) : order.canConfirm ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="handover-remark" className="text-xs text-muted-foreground">
              对账备注
            </Label>
            <Textarea
              id="handover-remark"
              rows={2}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="选填，如：两台均已在库"
            />
          </div>
          <Button type="button" className="shrink-0" onClick={() => setConfirmOpen(true)}>
            核对无误，回收 {order.assetCount} 台设备
          </Button>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          设备将在资产管理员对账确认后自动回收至闲置池。
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!v) setConfirmError(null);
          setConfirmOpen(v);
        }}
        title="确认回收设备"
        description={
          confirmError ??
          `将回收交接单内 ${order.assetCount} 台设备：置为闲置并解除人员绑定，回到可分配池。此操作不可撤销。`
        }
        confirmText="确认回收"
        onConfirm={runConfirm}
      />
    </div>
  );
}
